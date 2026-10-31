import { ApiError, assertSameOrigin, clientIp, handle, Input } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
// Provider OTP belum dipilih (BR-41). Fail closed: tidak menerbitkan challenge/cookie dummy.
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  await rateLimit("otp-request-ip", clientIp(req), 5, 900);
  const b = await Input.json(req);
  b.str("challenge", 1, 200);
  throw new ApiError(503, "OTP_UNAVAILABLE", "Layanan verifikasi nomor belum tersedia");
});
