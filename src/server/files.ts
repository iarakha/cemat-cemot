// BR-33 / SC-15 / SC-16: unggahan gambar. Disimpan di UPLOAD_DIR (di luar public/), nama acak, tipe dari isi berkas.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { ApiError } from "./http";

export const MAX_UPLOAD = 10 * 1024 * 1024;
const ROOT = () => path.resolve(/*turbopackIgnore: true*/ process.env.UPLOAD_DIR ?? ".uploads");
export type UploadDir = "payment-proofs" | "order-proofs" | "qris";

function sniff(b: Buffer): { ext: "jpg" | "png" | "webp"; type: string } | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", type: "image/jpeg" };
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", type: "image/png" };
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return { ext: "webp", type: "image/webp" };
  return null;
}

/** Validasi di memori lebih dulu (413/415), baru tulis ke disk. Mengembalikan path relatif untuk DB. */
export async function saveImage(file: File, dir: UploadDir): Promise<string> {
  if (file.size > MAX_UPLOAD) throw new ApiError(413, "TOO_LARGE", "Berkas maksimal 10 MB");
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = sniff(buf);
  if (!kind) throw new ApiError(415, "UNSUPPORTED_TYPE", "Berkas harus gambar JPEG, PNG, atau WebP");
  try {
    // Fully decode, not metadata-only: reject corrupted images and decompression bombs.
    await sharp(buf, { limitInputPixels: 40_000_000, failOn: "warning" }).raw().toBuffer();
  } catch { throw new ApiError(415, "UNSUPPORTED_TYPE", "Gambar rusak atau dimensi terlalu besar"); }
  const rel = `${dir}/${randomBytes(16).toString("hex")}.${kind.ext}`;
  await mkdir(path.join(ROOT(), dir), { recursive: true });
  await writeFile(path.join(ROOT(), rel), buf, { mode: 0o600 });
  return rel;
}

function resolveSafe(rel: string) {
  if (!/^[a-z-]+\/[A-Za-z0-9_.-]+$/.test(rel) || rel.includes("..")) return null;
  const full = path.resolve(ROOT(), rel);
  return full.startsWith(ROOT() + path.sep) ? full : null;
}

export async function removeStored(rel: string | null | undefined) {
  const full = rel ? resolveSafe(rel) : null;
  if (full) await rm(full, { force: true });
}

/** Layani berkas tersimpan; null jika hilang (EC-16). Tipe ditentukan ulang dari isi. */
export async function fileResponse(rel: string | null | undefined): Promise<Response | null> {
  const full = rel ? resolveSafe(rel) : null;
  if (!full) return null;
  let buf: Buffer;
  try { buf = await readFile(full); } catch { return null; }
  const kind = sniff(buf);
  if (!kind) return null;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": kind.type, "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store", "Content-Length": String(buf.length),
    },
  });
}

export function assertBodySize(req: Request) {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD + 64 * 1024) throw new ApiError(413, "TOO_LARGE", "Berkas maksimal 10 MB");
}
