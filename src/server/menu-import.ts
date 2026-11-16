// Impor massal menu (RND 16.2): preview murni baca, commit atomik. Token stateless (HMAC) terikat admin + berkas + hash rencana.
import { createHash, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { brands, menuItemChoices, menuItems, optionChoices, optionGroups, promoPrices } from "@/db/schema";
import { ApiError, bad, hmac } from "./http";
import { IMPORT_MAX_BYTES, readRows, type RawRow } from "./menu-import-parse";

const MONEY_MAX = 2_147_483_647, TTL_MS = 15 * 60_000, LOCK = 9473103; // LOCK sama dengan saveMenu/saveMaster
type Q = Pick<typeof db, "select">;
type Err = { field: string; message: string };
type Link = { choiceId: string; groupId: string; isDefault: boolean };
export type Item = {
  row: number; brand: string; name: string; category: string; action: "create" | "update" | null; targetId: string | null; brandId: string | null;
  normalPrice: number | null; promoPrice: number | null | undefined; isAvailable: boolean | undefined; newLinks: Link[]; errors: Err[];
};

const sha = (b: string | Uint8Array) => createHash("sha256").update(b).digest("hex");
const hasCtrl = (s: string) => [...s].some(c => { const n = c.charCodeAt(0); return n < 32 || n === 127; });
const formulaStart = (s: string) => /^[=+\-@]/.test(s);

export async function buildPlan(q: Q, rows: RawRow[]): Promise<Item[]> {
  const [bs, gs, cs, ms, ps, ls] = await Promise.all([
    q.select().from(brands), q.select().from(optionGroups), q.select().from(optionChoices),
    q.select({ id: menuItems.id, brandId: menuItems.brandId, name: menuItems.name }).from(menuItems),
    q.select().from(promoPrices), q.select({ menuItemId: menuItemChoices.menuItemId, groupId: menuItemChoices.groupId, priceDelta: menuItemChoices.priceDelta }).from(menuItemChoices),
  ]);
  const brandBy = new Map<string, (typeof bs)[number]>();
  for (const b of bs) { brandBy.set(b.slug.toLowerCase(), b); brandBy.set(b.name.toLowerCase(), b); }
  const groupBy = new Map(gs.map(g => [g.name.toLowerCase(), g]));
  const choicesOf = (gid: string) => cs.filter(c => c.groupId === gid).sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  const key = (brandId: string, name: string) => brandId + "\0" + name.toLowerCase();
  const existing = new Map<string, string[]>();
  for (const m of ms) existing.set(key(m.brandId, m.name.trim()), [...(existing.get(key(m.brandId, m.name.trim())) ?? []), m.id]);
  const promoOf = new Map(ps.map(p => [p.menuItemId, p.promoPrice]));

  const seen = new Map<string, number>();
  for (const r of rows) {
    const b = brandBy.get(r.cells.brand.toLowerCase());
    if (b && r.cells.nama) seen.set(key(b.id, r.cells.nama), (seen.get(key(b.id, r.cells.nama)) ?? 0) + 1);
  }

  return rows.map(({ row, cells }) => {
    const errors: Err[] = [];
    const e = (field: string, message: string) => errors.push({ field, message });
    const text = (field: string, v: string) => {
      if (!v) e(field, "Wajib diisi");
      else if (v.length > 120) e(field, "Maksimal 120 karakter");
      else if (hasCtrl(v)) e(field, "Karakter kontrol tidak diizinkan");
      else if (formulaStart(v)) e(field, "Awalan = + - @ ditolak (formula)");
    };
    text("nama", cells.nama); text("kategori", cells.kategori);
    const brand = cells.brand ? brandBy.get(cells.brand.toLowerCase()) : undefined;
    if (!cells.brand) e("brand", "Wajib diisi"); else if (!brand) e("brand", `Brand "${cells.brand.slice(0, 40)}" tidak dikenal`);
    const money = (field: string, v: string, min: number) => {
      if (!/^\d{1,10}$/.test(v) || Number(v) < min || Number(v) > MONEY_MAX) { e(field, `Bilangan bulat ${min}–${MONEY_MAX} tanpa Rp, pemisah, atau desimal`); return null; }
      return Number(v);
    };
    const normalPrice = cells.harga_app ? money("harga_app", cells.harga_app, 0) : (e("harga_app", "Wajib diisi"), null);
    let promoPrice: number | null | undefined; // undefined = pertahankan / tanpa promo
    if (cells.harga_titip) {
      promoPrice = money("harga_titip", cells.harga_titip, 1);
      if (promoPrice !== null && normalPrice !== null && promoPrice >= normalPrice) e("harga_titip", "Harus lebih kecil dari harga app");
    }
    let isAvailable: boolean | undefined;
    if (cells.tersedia) {
      const t = cells.tersedia.toLowerCase();
      if (t === "true") isAvailable = true; else if (t === "false") isAvailable = false; else e("tersedia", "Hanya true atau false");
    }
    let action: Item["action"] = null, targetId: string | null = null;
    if (brand && cells.nama && !errors.some(x => x.field === "nama")) {
      const k = key(brand.id, cells.nama), ids = existing.get(k) ?? [];
      if ((seen.get(k) ?? 0) > 1) e("nama", "Duplikat dalam berkas (ambigu)");
      else if (ids.length > 1) e("nama", `Ambigu: ${ids.length} menu bernama sama di brand ini`);
      else if (ids.length === 1) { action = "update"; targetId = ids[0]; } else action = "create";
    }
    const linked = new Set(targetId ? ls.filter(l => l.menuItemId === targetId).map(l => l.groupId) : []);
    const newLinks: Link[] = [];
    if (cells.addons) {
      if (formulaStart(cells.addons) || hasCtrl(cells.addons)) e("addons", "Karakter/awalan tidak diizinkan");
      else {
        const used = new Set<string>();
        for (const tok of cells.addons.split("|").map(t => t.trim())) {
          const [gName, ...rest] = tok.split("="), label = rest.join("=").trim();
          const g = groupBy.get(gName.trim().toLowerCase());
          if (!gName.trim() || !g) { e("addons", `Grup "${gName.trim().slice(0, 40)}" tidak dikenal`); continue; }
          if (used.has(g.id)) { e("addons", `Grup "${g.name}" disebut dua kali`); continue; }
          used.add(g.id);
          if (linked.has(g.id)) continue; // grup yang sudah tertaut dipertahankan; ubah lewat form menu
          const all = choicesOf(g.id);
          if (!all.length) { e("addons", `Grup "${g.name}" belum punya pilihan`); continue; }
          let def: string | null = null;
          if (label) {
            const c = all.find(x => x.label.toLowerCase() === label.toLowerCase());
            if (!c) { e("addons", `Pilihan "${label.slice(0, 40)}" tidak ada di grup "${g.name}"`); continue; }
            def = c.id;
          } else if (g.required) {
            if (all.length === 1) def = all[0].id;
            else { e("addons", `Default grup wajib "${g.name}" belum ditentukan (tulis ${g.name}=Pilihan)`); continue; }
          }
          for (const c of all) newLinks.push({ choiceId: c.id, groupId: g.id, isDefault: c.id === def });
        }
      }
    }
    if (targetId && normalPrice !== null) {
      const promo = promoPrice !== undefined ? promoPrice : promoOf.get(targetId) ?? null;
      if (promoPrice === undefined && promo !== null && promo >= normalPrice) e("harga_app", "Harga titip lama harus tetap lebih kecil dari harga app baru");
      const neg = ls.filter(l => l.menuItemId === targetId && l.priceDelta < 0).reduce((n, l) => n + l.priceDelta, 0);
      if ((promo ?? normalPrice) + neg < 0) e("harga_app", "Harga akhir tidak boleh negatif");
    }
    return { row, brand: cells.brand, name: cells.nama, category: cells.kategori, action, targetId, brandId: brand?.id ?? null, normalPrice, promoPrice, isAvailable, newLinks, errors };
  });
}

const planHash = (items: Item[]) => sha(JSON.stringify(items));
const summary = (items: Item[]) => {
  const ready = items.filter(i => !i.errors.length);
  return { read: items.length, ready: ready.length, errors: items.length - ready.length, created: ready.filter(i => i.action === "create").length, updated: ready.filter(i => i.action === "update").length };
};
const sign = (adminId: string, fileHash: string, exp: number, ph: string) => hmac(`menu-import|${adminId}|${fileHash}|${exp}|${ph}`);

async function load(file: File | null) {
  if (!file) throw bad("file", "Berkas wajib diunggah");
  if (file.size > IMPORT_MAX_BYTES) throw new ApiError(413, "TOO_LARGE", "Berkas maksimal 10 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { bytes, rows: readRows(bytes), fileHash: sha(bytes) };
}

export async function previewImport(adminId: string, file: File | null) {
  const { rows, fileHash } = await load(file);
  const items = await buildPlan(db, rows);
  const ph = planHash(items), exp = Date.now() + TTL_MS;
  return {
    token: `${exp}.${ph}.${sign(adminId, fileHash, exp, ph)}`, expiresAt: new Date(exp).toISOString(), summary: summary(items),
    rows: items.map(i => ({ row: i.row, action: i.action, brand: i.brand, name: i.name, category: i.category, normalPrice: i.normalPrice, promoPrice: i.promoPrice ?? null, isAvailable: i.isAvailable ?? null, addonLinks: i.newLinks.length, errors: i.errors })),
  };
}

export async function commitImport(adminId: string, file: File | null, token: string, skipErrors: boolean) {
  const { rows, fileHash } = await load(file);
  const [expS, ph, sig] = token.split(".");
  const exp = Number(expS);
  const good = Number.isSafeInteger(exp) && /^[0-9a-f]{64}$/.test(ph ?? "") && /^[0-9a-f]{64}$/.test(sig ?? "") &&
    timingSafeEqual(Buffer.from(sig), Buffer.from(sign(adminId, fileHash, exp, ph)));
  if (!good) throw new ApiError(400, "INVALID_TOKEN", "Token pratinjau tidak valid untuk berkas ini");
  if (Date.now() > exp) throw new ApiError(400, "TOKEN_EXPIRED", "Pratinjau kedaluwarsa, buat ulang");
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK})`);
    const items = await buildPlan(tx, rows);
    // Data berubah sejak pratinjau (termasuk impor yang sama sudah dijalankan): tolak, tidak menggandakan.
    if (planHash(items) !== ph) throw new ApiError(409, "BATCH_CHANGED", "Data berubah sejak pratinjau atau impor sudah dijalankan; buat pratinjau ulang");
    const s = summary(items);
    if (s.errors && !skipErrors) throw new ApiError(409, "HAS_ERRORS", `${s.errors} baris galat; konfirmasi untuk melewatinya`, { summary: s });
    if (!s.ready) throw bad("berkas", "Tidak ada baris siap diimpor");
    for (const i of items.filter(x => !x.errors.length)) {
      let id = i.targetId!;
      if (i.action === "create") {
        id = (await tx.insert(menuItems).values({ brandId: i.brandId!, name: i.name, category: i.category, normalPrice: i.normalPrice!, isAvailable: i.isAvailable ?? true }).returning({ id: menuItems.id }))[0].id;
      } else {
        await tx.update(menuItems).set({ category: i.category, normalPrice: i.normalPrice!, ...(i.isAvailable === undefined ? {} : { isAvailable: i.isAvailable }) }).where(eq(menuItems.id, id));
      }
      if (i.promoPrice != null) {
        await tx.delete(promoPrices).where(eq(promoPrices.menuItemId, id));
        await tx.insert(promoPrices).values({ menuItemId: id, promoPrice: i.promoPrice });
      }
      if (i.newLinks.length) await tx.insert(menuItemChoices).values(i.newLinks.map(l => ({ ...l, menuItemId: id, priceDelta: 0 })));
    }
    return { ...s, skipped: s.errors };
  });
}

export const TEMPLATE_CSV = "brand,nama,kategori,harga_app,harga_titip,addons,tersedia\r\n";
