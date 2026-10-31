import { ApiError, assertSameOrigin, clientIp, handle, Input, bad } from "@/server/http";
import { rateLimit } from "@/server/rate-limit";
export const POST = handle(async (req) => {
  assertSameOrigin(req);
  await rateLimit("otp-verify-ip", clientIp(req), 5, 900);
  const b = await Input.json(req);
  b.uuid("challengeId");
  const code = b.str("otp", 6, 6);
  if (!/^[0-9]{6}$/.test(code)) throw bad("otp", "6 digit wajib");
  throw new ApiError(503, "OTP_UNAVAILABLE", "Layanan verifikasi nomor belum tersedia");
});
