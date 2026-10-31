import { ApiError, assertSameOrigin, bad, clientIp, handle, Input, noContent } from "@/server/http";
import { assertBodySize } from "@/server/files";
import { isToken, submitPaymentProof } from "@/server/order-flow";
import { rateLimit } from "@/server/rate-limit";

// API-05: multipart, field `file`. 204; 409 LOCKED saat VERIFYING; 410 EXPIRED; 413/415 berkas salah.
export const POST = handle<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  assertSameOrigin(req);
  const { token } = await params;
  if (!isToken(token)) throw new ApiError(404, "NOT_FOUND", "Pesanan tidak ditemukan");
  assertBodySize(req);
  await rateLimit("proof-ip", clientIp(req), 20, 600);
  if (!(req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) throw bad("body", "harus multipart/form-data");
  let fd: FormData;
  try { fd = await req.formData(); } catch { throw bad("body", "multipart tidak valid"); }
  const file = Input.form(fd).file("file");
  if (!file) throw bad("file", "wajib");
  await submitPaymentProof({ token }, file, "buyer");
  return noContent();
});
