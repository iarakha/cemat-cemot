import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { brands, menuItems, menuItemChoices, optionGroups, optionChoices, outlets, orders, payments, partnerCompanies, paymentAccounts, promoPrices, storeSettings } from "@/db/schema";
import { ApiError, bad, Input, NOT_FOUND, asInput, isUuid } from "./http";
import { normalizePhone } from "@/lib/order-rules";
import { getMenuOptions } from "@/lib/menu-options";
import { saveImage, removeStored } from "./files";

const moneyMax = 2_147_483_647;
const entities = ["brands", "menu", "option-groups", "option-choices", "outlets", "partners", "payment-accounts", "settings"] as const;
export function assertEntity(e: string) { if (!(entities as readonly string[]).includes(e)) throw NOT_FOUND; }

export async function listData(entity: string, sp: URLSearchParams) {
  assertEntity(entity);
  const b = new Input(Object.fromEntries(sp));
  const limit = b.has("limit") ? b.int("limit", 1, 100) : 50;
  const offset = b.has("offset") ? b.int("offset", 0, 1_000_000) : 0;
  const brand = b.has("brandId") ? b.uuid("brandId") : null;
  if (entity === "settings") return (await db.select().from(storeSettings).where(eq(storeSettings.id, 1)))[0];
  if (entity === "brands") return db.select().from(brands).orderBy(asc(brands.sortOrder), asc(brands.id));
  if (entity === "menu") {
    const rows = await db.select({ menu: menuItems, promoPrice: promoPrices.promoPrice }).from(menuItems).leftJoin(promoPrices, eq(promoPrices.menuItemId, menuItems.id))
      .where(brand ? eq(menuItems.brandId, brand) : undefined).orderBy(asc(menuItems.name), asc(menuItems.id)).limit(limit).offset(offset);
    return Promise.all(rows.map(async r => ({ ...r.menu, promoPrice: r.promoPrice, options: await getMenuOptions(r.menu.id) })));
  }
  if (entity === "outlets") return db.select().from(outlets).where(brand ? eq(outlets.brandId, brand) : undefined).orderBy(asc(outlets.name), asc(outlets.id)).limit(limit).offset(offset);
  if (entity === "partners") return db.select().from(partnerCompanies).orderBy(asc(partnerCompanies.name), asc(partnerCompanies.id)).limit(limit).offset(offset);
  if (entity === "option-groups") return db.select().from(optionGroups).orderBy(asc(optionGroups.sortOrder), asc(optionGroups.id));
  if (entity === "option-choices") return db.select().from(optionChoices).orderBy(asc(optionChoices.sortOrder), asc(optionChoices.id));
  const rows = await db.select().from(paymentAccounts).orderBy(asc(paymentAccounts.sortOrder), asc(paymentAccounts.id));
  return rows.map(a => ({ ...a, qrisImagePath: undefined, hasQris: !!a.qrisImagePath, accountNo: a.accountNo ? "••••" + a.accountNo.slice(-4) : null }));
}

export async function saveData(entity: string, id: string | null, b: Input) {
  assertEntity(entity);
  if (id && !isUuid(id)) throw NOT_FOUND;
  if (entity === "brands") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Brand hanya baca dalam fase ini");
  if (entity === "settings") return saveSettings(b);
  if (entity === "menu") return saveMenu(id, b);
  if (entity === "option-groups" || entity === "option-choices") return saveMaster(entity, id, b);
  if (entity === "partners") {
    const name = b.str("name", 1, 120);
    const raw = b.optStr("phone", 20);
    let phone: string | null = null;
    if (raw) { try { phone = normalizePhone(raw); } catch { throw bad("phone", "Nomor HP tidak valid"); } }
    const website = b.optStr("website", 500);
    if (website) {
      try { if (!["http:", "https:"].includes(new URL(website).protocol)) throw new Error(); } catch { throw bad("website", "URL http(s) wajib"); }
    }
    const values = { name, phone, website, isActive: b.optBool("isActive") ?? true };
    return db.transaction(async tx => {
      if (id) {
        const [p] = await tx.select().from(partnerCompanies).where(eq(partnerCompanies.id, id)).for("update");
        if (!p) throw NOT_FOUND;
        return (await tx.update(partnerCompanies).set(values).where(eq(partnerCompanies.id, id)).returning())[0];
      }
      return (await tx.insert(partnerCompanies).values(values).returning())[0];
    });
  }
  if (entity === "outlets") {
    const brandId = b.uuid("brandId"), name = b.str("name", 1, 200), address = b.str("address", 1, 500), city = b.optStr("city", 120);
    const lat = Number(b.o.lat), lng = Number(b.o.lng);
    if (!b.has("lat") || !b.has("lng") || !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) throw bad("coordinates", "Koordinat tidak valid");
    return db.transaction(async tx => {
      if (id) {
        const [o] = await tx.select().from(outlets).where(eq(outlets.id, id)).for("update");
        if (!o) throw NOT_FOUND;
        if (o.source !== "MANUAL" && (o.brandId !== brandId || o.name !== name || o.address !== address || o.city !== city || o.lat !== lat || o.lng !== lng)) throw new ApiError(409, "OSM_MANAGED", "Data OSM tidak boleh diedit bebas; status aktif dapat diubah");
        if (o.brandId !== brandId && (await tx.select({ id: orders.id }).from(orders).where(eq(orders.outletId, id)).limit(1)).length) throw new ApiError(409, "IN_USE", "Brand outlet terpakai tidak boleh berubah");
        return (await tx.update(outlets).set({ brandId, name, address, city, lat, lng, isActive: b.optBool("isActive") ?? o.isActive }).where(eq(outlets.id, id)).returning())[0];
      }
      return (await tx.insert(outlets).values({ brandId, name, address, city, lat, lng, source: "MANUAL", isActive: b.optBool("isActive") ?? true }).returning())[0];
    });
  }
  return savePaymentAccount(id, b);
}

async function saveSettings(b: Input) {
  const status = b.oneOf("status", ["OPEN", "CLOSED", "BREAK", "PRAYER", "LEAVE"] as const);
  const openAt = b.str("openAt", 5, 8), closeAt = b.str("closeAt", 5, 8);
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(openAt) || !/^([01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(closeAt) || openAt >= closeAt) throw bad("hours", "Jam HH:mm valid, buka sebelum tutup");
  let adminWa: string;
  try { adminWa = normalizePhone(b.str("adminWa", 10, 15)); } catch { throw bad("adminWa", "Nomor tidak valid"); }
  const values = { status, openAt, closeAt, adminWa, serviceFee: b.int("serviceFee", 0, moneyMax), maxCups: b.int("maxCups", 1, 20), paymentWindowMin: b.int("paymentWindowMin", 5, 120), checkoutCutoffMin: b.int("checkoutCutoffMin", 0, 120), verifyEtaMin: b.int("verifyEtaMin", 1, 60), closedMessage: b.optStr("closedMessage", 500), useUniqueCode: false };
  return db.transaction(async tx => {
    // Same lock as QRIS activation/deactivation: cannot open store with no active QRIS.
    await tx.execute(sql`select pg_advisory_xact_lock(9473102)`);
    if (status === "OPEN" && !(await tx.select().from(paymentAccounts).where(and(eq(paymentAccounts.isActive, true), eq(paymentAccounts.type, "QRIS_STATIC"))).limit(1)).length) throw new ApiError(422, "PAYMENT_NOT_READY", "QRIS aktif wajib sebelum toko buka");
    const [row] = await tx.update(storeSettings).set(values).where(eq(storeSettings.id, 1)).returning();
    if (!row) throw NOT_FOUND;
    return row;
  });
}

async function saveMenu(id: string | null, b: Input) {
  const brandId = b.uuid("brandId"), name = b.str("name", 1, 120), category = b.str("category", 1, 120), description = b.optStr("description", 1000, true);
  const normalPrice = b.int("normalPrice", 0, moneyMax), promoPrice = b.optInt("promoPrice", 1, moneyMax);
  if (promoPrice !== null && promoPrice >= normalPrice) throw bad("promoPrice", "Harus lebih kecil dari harga normal");
  const links = b.arr("choices", 100).map(raw => {
    const c = asInput(raw, "choices");
    return { choiceId: c.uuid("choiceId"), priceDelta: c.int("priceDelta", -moneyMax, moneyMax), isDefault: c.bool("isDefault") };
  });
  if (new Set(links.map(l => l.choiceId)).size !== links.length) throw bad("choices", "Pilihan duplikat");
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(9473103)`);
    const masters = links.length ? await tx.select({ choiceId: optionChoices.id, groupId: optionGroups.id, required: optionGroups.required }).from(optionChoices).innerJoin(optionGroups, eq(optionGroups.id, optionChoices.groupId)).where(inArray(optionChoices.id, links.map(l => l.choiceId))) : [];
    if (masters.length !== links.length) throw bad("choices", "Pilihan master tidak ditemukan");
    for (const gid of new Set(masters.map(m => m.groupId))) {
      const members = masters.filter(m => m.groupId === gid);
      const defaults = links.filter(l => l.isDefault && members.some(m => m.choiceId === l.choiceId));
      if (defaults.length > 1 || (members[0].required && defaults.length !== 1)) throw bad("choices", "Grup wajib tepat satu default; grup opsional maksimal satu default");
    }
    const base = promoPrice ?? normalPrice;
    // Conservative validation: no combination of negative deltas may create negative unit price.
    if (base + links.filter(l => l.priceDelta < 0).reduce((n, l) => n + l.priceDelta, 0) < 0) throw bad("choices", "Harga akhir tidak boleh negatif");
    const values = { brandId, name, category, description, normalPrice, isAvailable: b.optBool("isAvailable") ?? true, sortOrder: b.has("sortOrder") ? b.int("sortOrder", 0, 10000) : 0 };
    if (id) {
      const [old] = await tx.select().from(menuItems).where(eq(menuItems.id, id)).for("update");
      if (!old) throw NOT_FOUND;
      if (old.brandId !== brandId) throw bad("brandId", "Brand menu existing tidak boleh diubah");
    }
    const [row] = id ? await tx.update(menuItems).set(values).where(eq(menuItems.id, id)).returning() : await tx.insert(menuItems).values(values).returning();
    await tx.delete(promoPrices).where(eq(promoPrices.menuItemId, row.id));
    if (promoPrice !== null) await tx.insert(promoPrices).values({ menuItemId: row.id, promoPrice });
    await tx.delete(menuItemChoices).where(eq(menuItemChoices.menuItemId, row.id));
    if (links.length) await tx.insert(menuItemChoices).values(links.map(l => ({ ...l, menuItemId: row.id, groupId: masters.find(m => m.choiceId === l.choiceId)!.groupId })));
    return row;
  });
}

async function saveMaster(entity: string, id: string | null, b: Input) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(9473103)`);
    const sortOrder = b.has("sortOrder") ? b.int("sortOrder", 0, 10000) : 0;
    if (entity === "option-groups") {
      const name = b.str("name", 1, 120), required = b.bool("required"), maxSelect = b.int("maxSelect", 1, 20);
      if (id) {
        const [old] = await tx.select().from(optionGroups).where(eq(optionGroups.id, id)).for("update");
        if (!old) throw NOT_FOUND;
        if (required) {
          const invalid = await tx.execute(sql`select menu_item_id from menu_item_choices where group_id=${id} group by menu_item_id having count(*) filter (where is_default) <> 1`);
          if (invalid.length) throw new ApiError(409, "INVALID_DEFAULT", "Menu tertaut wajib default sebelum grup menjadi wajib");
        }
        return (await tx.update(optionGroups).set({ name, required, maxSelect, sortOrder }).where(eq(optionGroups.id, id)).returning())[0];
      }
      return (await tx.insert(optionGroups).values({ name, required, maxSelect, sortOrder }).returning())[0];
    }
    const groupId = b.uuid("groupId"), label = b.str("label", 1, 120);
    if (id) {
      const [old] = await tx.select().from(optionChoices).where(eq(optionChoices.id, id)).for("update");
      if (!old) throw NOT_FOUND;
      if (old.groupId !== groupId) throw bad("groupId", "Grup pilihan existing tidak boleh berubah");
      return (await tx.update(optionChoices).set({ label, sortOrder }).where(eq(optionChoices.id, id)).returning())[0];
    }
    return (await tx.insert(optionChoices).values({ groupId, label, sortOrder }).returning())[0];
  });
}

async function savePaymentAccount(id: string | null, b: Input) {
  const type = b.oneOf("type", ["QRIS_STATIC", "BANK", "EWALLET"] as const);
  const provider = b.str("provider", 1, 120), accountName = b.str("accountName", 1, 120), accountNo = b.optStr("accountNo", 40);
  if (type !== "QRIS_STATIC" && (!accountNo || !/^\d+$/.test(accountNo))) throw bad("accountNo", "Nomor digit wajib");
  const isActive = b.bool("isActive");
  if (type !== "QRIS_STATIC" && isActive) throw bad("isActive", "BANK/EWALLET hanya cadangan nonaktif");
  const file = b.file("file");
  const rel = file ? await saveImage(file, "qris") : null;
  let committed = false;
  try {
    const result = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(9473102)`);
      const old = id ? (await tx.select().from(paymentAccounts).where(eq(paymentAccounts.id, id)).for("update"))[0] : null;
      if (id && !old) throw NOT_FOUND;
      const referenced = id ? (await tx.select().from(payments).where(eq(payments.paymentAccountId, id)).limit(1)).length > 0 : false;
      if (referenced && (rel || type !== old!.type || provider !== old!.provider || accountName !== old!.accountName || accountNo !== old!.accountNo)) throw new ApiError(409, "IN_USE", "Tujuan terpakai tidak ditimpa; buat tujuan pengganti agar riwayat aman");
      const qrisImagePath = rel ?? old?.qrisImagePath ?? null;
      if (type === "QRIS_STATIC" && !qrisImagePath) throw bad("file", "QRIS wajib gambar");
      const values = { type, provider, accountName, accountNo, qrisImagePath, isActive, sortOrder: b.has("sortOrder") ? b.int("sortOrder", 0, 10000) : 0 };
      const [row] = id ? await tx.update(paymentAccounts).set(values).where(eq(paymentAccounts.id, id)).returning() : await tx.insert(paymentAccounts).values(values).returning();
      if (!(await tx.select().from(paymentAccounts).where(and(eq(paymentAccounts.type, "QRIS_STATIC"), eq(paymentAccounts.isActive, true))).limit(1)).length) throw new ApiError(409, "LAST_QRIS", "QRIS aktif terakhir tidak boleh dinonaktifkan");
      return { ...row, qrisImagePath: undefined, hasQris: !!row.qrisImagePath };
    });
    committed = true;
    return result;
  } finally { if (rel && !committed) await removeStored(rel); }
}

export async function deleteData(entity: string, id: string, b: Input) {
  assertEntity(entity);
  if (!isUuid(id)) throw NOT_FOUND;
  if (b.o.confirm !== true) throw bad("confirm", "Konfirmasi eksplisit wajib");
  if (entity === "outlets") throw new ApiError(409, "PROTECTED", "Outlet tidak dihapus; nonaktifkan untuk menjaga data");
  if (["brands", "settings"].includes(entity)) throw new ApiError(405, "METHOD_NOT_ALLOWED", "Tidak dapat dihapus");
  return db.transaction(async tx => {
    if (entity === "menu" || entity.startsWith("option-")) await tx.execute(sql`select pg_advisory_xact_lock(9473103)`);
    if (entity === "payment-accounts") await tx.execute(sql`select pg_advisory_xact_lock(9473102)`);
    if (entity === "menu") { await tx.delete(menuItems).where(eq(menuItems.id, id)); return; }
    if (entity === "partners") { await tx.delete(partnerCompanies).where(eq(partnerCompanies.id, id)); return; }
    if (entity === "payment-accounts") {
      const [old] = await tx.select().from(paymentAccounts).where(eq(paymentAccounts.id, id)).for("update");
      if (!old) throw NOT_FOUND;
      if (old.isActive) throw new ApiError(409, "ACTIVE_ACCOUNT", "Nonaktifkan sebelum menghapus");
      await tx.delete(paymentAccounts).where(eq(paymentAccounts.id, id)); return;
    }
    const affected = await tx.select().from(menuItemChoices).where(entity === "option-groups" ? eq(menuItemChoices.groupId, id) : eq(menuItemChoices.choiceId, id));
    // No cascades exposed: unlink explicitly via menu editor before deleting masters.
    if (affected.length) throw new ApiError(409, "IN_USE", "Lepaskan semua tautan menu sebelum menghapus master", { affectedMenus: [...new Set(affected.map(r => r.menuItemId))] });
    if (entity === "option-groups") await tx.delete(optionGroups).where(eq(optionGroups.id, id));
    else await tx.delete(optionChoices).where(eq(optionChoices.id, id));
  });
}
