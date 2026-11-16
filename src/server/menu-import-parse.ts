// Parser impor massal menu (RND 16.2): CSV UTF-8 atau XLSX lembar pertama. Murni (tanpa DB) agar bisa dites di `npm run check`.
// Tidak mengevaluasi formula/makro; semua batas dicek sebelum/selama parsing agar berkas bomb ditolak.
import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";
import { ApiError, bad } from "./http";

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 1000;
export const IMPORT_MAX_UNZIPPED = 50 * 1024 * 1024;
const MAX_CELLS = 20_000, MAX_CELL_LEN = 500, MAX_COLS = 30, MAX_RECORDS = 5000;
export const HEADERS = ["brand", "nama", "kategori", "harga_app", "harga_titip", "addons", "tersedia"] as const;
const REQUIRED = ["brand", "nama", "kategori", "harga_app"] as const;
const tooBig = (m = "Berkas terlalu besar atau terlalu banyak baris/sel") => new ApiError(413, "TOO_LARGE", m);

export type RawRow = { row: number; cells: Record<string, string> };

export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const first = text.split(/\r?\n/, 1)[0];
  const d = first.includes(",") || !first.includes(";") ? "," : ";"; // Excel Indonesia mengekspor titik koma
  const out: string[][] = [];
  let row: string[] = [], cur = "", q = false, cells = 0;
  const cell = () => {
    if (cur.length > MAX_CELL_LEN) throw tooBig(`Isi sel melebihi ${MAX_CELL_LEN} karakter`);
    if (++cells > MAX_CELLS || row.length >= MAX_COLS) throw tooBig();
    row.push(cur); cur = "";
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"' && cur === "") q = true;
    else if (c === d) cell();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      cell(); out.push(row); row = [];
      if (out.length > MAX_RECORDS) throw tooBig();
    } else cur += c;
  }
  if (q) throw bad("berkas", "Tanda kutip tidak ditutup");
  if (cur !== "" || row.length) { cell(); out.push(row); }
  return out;
}

const decodeXml = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp);/gi, (_, e: string) => {
  const l = e.toLowerCase();
  if (l === "lt") return "<"; if (l === "gt") return ">"; if (l === "quot") return '"'; if (l === "apos") return "'"; if (l === "amp") return "&";
  const n = l[1] === "x" ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
  return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
});
const attr = (s: string, name: string) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(s)?.[1];
const textOf = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => decodeXml(m[1])).join("");
const colIndex = (ref: string) => { let n = 0; for (const ch of /^[A-Z]+/i.exec(ref)?.[0] ?? "") n = n * 26 + ch.toUpperCase().charCodeAt(0) - 64; return n - 1; };

function unzipWanted(buf: Uint8Array): Map<string, string> {
  const files = new Map<string, Uint8Array[]>();
  let total = 0, fail: ApiError | null = null;
  try {
    const u = new Unzip();
    u.register(UnzipInflate);
    u.register(UnzipPassThrough);
    u.onfile = f => {
      if (/vbaProject|\.bin$/i.test(f.name)) throw bad("berkas", "Makro tidak diizinkan");
      if (!/^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(f.name)) return; // entri lain tidak pernah di-inflate
      const parts: Uint8Array[] = [];
      files.set(f.name, parts);
      f.ondata = (err, d) => {
        if (fail) return; // fflate meneruskan error lemparan kita lewat callback ini; simpan yang pertama
        if (err) { fail = bad("berkas", "XLSX rusak"); return; }
        total += d.length;
        if (total > IMPORT_MAX_UNZIPPED) { fail = tooBig("Isi XLSX terlalu besar setelah didekompresi"); f.terminate(); return; }
        parts.push(d);
      };
      f.start();
    };
    u.push(buf, true);
  } catch (e) {
    if (fail) throw fail;
    if (e instanceof ApiError) throw e;
    throw bad("berkas", "XLSX rusak");
  }
  if (fail) throw fail;
  const dec = new TextDecoder("utf-8");
  return new Map([...files].map(([n, ps]) => [n, dec.decode(Buffer.concat(ps))]));
}

export function parseXlsx(buf: Uint8Array): string[][] {
  const f = unzipWanted(buf);
  const wb = f.get("xl/workbook.xml");
  if (!wb) throw bad("berkas", "Bukan berkas XLSX yang valid");
  let sheetPath: string | undefined;
  const rid = attr(/<sheet\b[^>]*>/.exec(wb)?.[0] ?? "", "r:id");
  if (rid) {
    for (const m of (f.get("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
      if (attr(m[0], "Id") === rid) { const t = attr(m[0], "Target") ?? ""; sheetPath = t.startsWith("/") ? t.slice(1) : "xl/" + t; }
    }
  }
  const sheet = (sheetPath && f.get(sheetPath)) || f.get("xl/worksheets/sheet1.xml");
  if (!sheet) throw bad("berkas", "Lembar pertama tidak ditemukan");
  const shared = [...(f.get("xl/sharedStrings.xml") ?? "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m => textOf(m[1]));
  const out: string[][] = [];
  let cells = 0, seq = 0;
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const no = Number(attr(rm[1], "r")) || seq + 1;
    seq = no;
    if (no > MAX_RECORDS) throw tooBig();
    const row: string[] = [];
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const idx = colIndex(attr(cm[1], "r") ?? "");
      if (idx < 0 || idx >= MAX_COLS) { if (idx >= MAX_COLS) throw tooBig(); continue; }
      if (++cells > MAX_CELLS) throw tooBig();
      const inner = cm[2] ?? "", t = attr(cm[1], "t");
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let val = t === "s" ? shared[Number(v)] ?? "" : t === "inlineStr" ? textOf(inner) : t === "b" ? (v === "1" ? "true" : "false") : decodeXml(v ?? "");
      if (/<f\b/.test(inner)) val = "=" + val; // formula ditolak validator, nilai cache tidak dipercaya
      if (val.length > MAX_CELL_LEN) throw tooBig(`Isi sel melebihi ${MAX_CELL_LEN} karakter`);
      row[idx] = val;
    }
    out[no - 1] = Array.from(row, c => c ?? "");
  }
  return Array.from(out, r => r ?? []);
}

/** Byte berkas -> baris bernomor (nomor baris = baris di berkas, header = 1). */
export function readRows(bytes: Uint8Array): RawRow[] {
  if (bytes.length > IMPORT_MAX_BYTES) throw tooBig("Berkas maksimal 10 MB");
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  let table: string[][];
  if (isZip) table = parseXlsx(bytes);
  else {
    if (bytes.includes(0)) throw bad("berkas", "Gunakan CSV UTF-8 atau XLSX");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw bad("berkas", "CSV harus UTF-8"); }
    table = parseCsv(text);
  }
  const blank = (r?: string[]) => !r || r.every(c => c.trim() === "");
  const hi = table.findIndex(r => !blank(r));
  if (hi < 0) throw bad("berkas", "Berkas kosong");
  const header = table[hi].map(h => h.trim().toLowerCase());
  if (new Set(header.filter(Boolean)).size !== header.filter(Boolean).length) throw bad("berkas", "Header kolom duplikat");
  const missing = REQUIRED.filter(c => !header.includes(c));
  if (missing.length) throw bad("berkas", `Kolom wajib tidak ada: ${missing.join(", ")}`);
  const rows: RawRow[] = [];
  for (let i = hi + 1; i < table.length; i++) {
    if (blank(table[i])) continue;
    if (rows.length >= IMPORT_MAX_ROWS) throw tooBig(`Maksimal ${IMPORT_MAX_ROWS} baris data`);
    const cells: Record<string, string> = {};
    for (const c of HEADERS) { const k = header.indexOf(c); cells[c] = k >= 0 ? (table[i][k] ?? "").trim() : ""; }
    rows.push({ row: i + 1, cells });
  }
  if (!rows.length) throw bad("berkas", "Tidak ada baris data");
  return rows;
}
