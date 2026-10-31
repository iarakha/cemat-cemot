// Fondasi route handler: bentuk error seragam (RND 9), validasi input tulis tangan (SC-04), HMAC, IP, cek origin.
import { createHmac } from "node:crypto";

export class ApiError extends Error {
  constructor(
    readonly status: number, readonly code: string, message: string,
    readonly extra?: Record<string, unknown>, readonly headers?: Record<string, string>,
  ) { super(message); }
}
export const bad = (field: string, msg: string) => new ApiError(400, "INVALID_INPUT", `${field}: ${msg}`, { field });

type Ctx = { params: Promise<Record<string, string>> };
export const NOT_FOUND = new ApiError(404, "NOT_FOUND", "Tidak ditemukan");

/** Bungkus handler: ApiError -> {error:{code,message}}; deadlock/serialization -> 503 BUSY; sisanya 500 tanpa data pribadi (BR-23). */
export function handle<C = Ctx>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) {
        return Response.json({ error: { code: e.code, message: e.message, ...e.extra } }, { status: e.status, headers: e.headers });
      }
      const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
      if (code === "23503" || code === "23505" || code === "23514") {
        return Response.json({ error: { code: "DATA_CONFLICT", message: "Data bertentangan, sudah dipakai, atau melanggar aturan" } }, { status: 409 });
      }
      if (code === "40001" || code === "40P01") {
        return Response.json({ error: { code: "BUSY", message: "Server sibuk, coba lagi" } }, { status: 503, headers: { "Retry-After": "2" } });
      }
      console.error(JSON.stringify({ level: "error", event: "unhandled", name: e instanceof Error ? e.name : "unknown", code }));
      return Response.json({ error: { code: "INTERNAL", message: "Terjadi kesalahan server" } }, { status: 500 });
    }
  };
}

const hasCtrl = (s: string, allowNewline: boolean) =>
  [...s].some((c) => { const n = c.charCodeAt(0); return (n < 32 && !(allowNewline && (n === 10 || n === 9))) || n === 127; });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Pembaca field bertipe. Menerima JSON atau multipart (nilai string diubah ke angka/boolean bila perlu). */
export class Input {
  constructor(readonly o: Record<string, unknown>) {}
  static async json(req: Request) {
    let v: unknown;
    try { v = await req.json(); } catch { throw bad("body", "JSON tidak valid"); }
    if (!v || typeof v !== "object" || Array.isArray(v)) throw bad("body", "harus objek JSON");
    return new Input(v as Record<string, unknown>);
  }
  static form(fd: FormData) {
    const o: Record<string, unknown> = {};
    for (const [k, v] of fd.entries()) o[k] = v;
    return new Input(o);
  }
  has(k: string) { return this.o[k] !== undefined && this.o[k] !== null && this.o[k] !== ""; }
  str(k: string, min: number, max: number, allowNewline = false) {
    const v = this.o[k];
    if (typeof v !== "string") throw bad(k, "wajib berupa teks");
    const t = v.trim();
    if (t.length < min || t.length > max || hasCtrl(t, allowNewline)) throw bad(k, `${min}–${max} karakter tanpa karakter kontrol`);
    return t;
  }
  optStr(k: string, max: number, allowNewline = false) { return this.has(k) ? this.str(k, 1, max, allowNewline) : null; }
  int(k: string, min: number, max: number) {
    const raw = this.o[k];
    const v = typeof raw === "string" && /^-?\d+$/.test(raw.trim()) ? Number(raw) : raw;
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) throw bad(k, `bilangan bulat ${min}–${max}`);
    return v;
  }
  optInt(k: string, min: number, max: number) { return this.has(k) ? this.int(k, min, max) : null; }
  bool(k: string) {
    const v = this.o[k];
    if (v === true || v === "true") return true;
    if (v === false || v === "false") return false;
    throw bad(k, "wajib true/false");
  }
  optBool(k: string) { return this.has(k) ? this.bool(k) : undefined; }
  uuid(k: string) { const v = this.o[k]; if (!isUuid(v)) throw bad(k, "UUID tidak valid"); return v; }
  oneOf<T extends string>(k: string, list: readonly T[]): T {
    const v = this.o[k];
    if (typeof v !== "string" || !(list as readonly string[]).includes(v)) throw bad(k, `salah satu dari ${list.join(", ")}`);
    return v as T;
  }
  arr(k: string, max: number): unknown[] {
    const v = this.o[k];
    if (!Array.isArray(v) || v.length > max) throw bad(k, `daftar maksimal ${max} elemen`);
    return v;
  }
  file(k: string): File | null { const v = this.o[k]; return v instanceof File && v.size > 0 ? v : null; }
}
export const asInput = (v: unknown, field: string) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw bad(field, "harus objek");
  return new Input(v as Record<string, unknown>);
};

/** Body JSON atau multipart, sesuai Content-Type. */
export async function readBody(req: Request) {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.startsWith("multipart/form-data")) {
    let fd: FormData;
    try { fd = await req.formData(); } catch { throw bad("body", "multipart tidak valid"); }
    return Input.form(fd);
  }
  return Input.json(req);
}

export function hmac(data: string) {
  const s = process.env.OTP_HMAC_SECRET;
  if (!s || s.length < 32) throw new ApiError(503, "NOT_CONFIGURED", "Konfigurasi server belum lengkap");
  return createHmac("sha256", s).update(data).digest("hex");
}

// ponytail: x-forwarded-for dipercaya apa adanya; di produksi Caddy harus menimpa header ini.
export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

/** Cegah CSRF lintas situs untuk mutasi berbasis cookie: Origin (jika ada) harus sama dengan Host. */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return;
  let host: string;
  try { host = new URL(origin).host; } catch { throw new ApiError(403, "FORBIDDEN", "Origin tidak valid"); }
  if (host !== req.headers.get("host")) throw new ApiError(403, "FORBIDDEN", "Origin tidak diizinkan");
}

export const noContent = () => new Response(null, { status: 204 });
export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** Kode/nama constraint Postgres dari error driver (dibungkus Drizzle di `.cause`). */
export function pgErr(e: unknown) {
  const c = ((e as { cause?: unknown })?.cause ?? e) as { code?: string; constraint_name?: string };
  return { code: c?.code, constraint: c?.constraint_name };
}
