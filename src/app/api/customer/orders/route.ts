import { getCustomerHistory, getCustomerSession } from "@/lib/customer-session";
import { ApiError, handle, Input, json } from "@/server/http";
export const GET = handle(async (req) => {
  if (!(await getCustomerSession())) throw new ApiError(401, "OTP_REQUIRED", "Verifikasi nomor diperlukan");
  const b = new Input(Object.fromEntries(new URL(req.url).searchParams));
  const limit = b.has("limit") ? b.int("limit", 1, 50) : 10;
  const offset = b.has("offset") ? b.int("offset", 0, 1_000_000) : 0;
  return json({ orders: await getCustomerHistory(limit, offset), limit, offset });
});
