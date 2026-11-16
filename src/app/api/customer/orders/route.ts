import { getBuyerHash } from "@/lib/buyer";
import { getCustomerHistory } from "@/lib/customer-session";
import { handle, Input, json } from "@/server/http";
// Riwayat pesanan perangkat ini (cookie) + nomor HP ber-OTP bila ada. Tanpa identitas: daftar kosong, bukan 401.
export const GET = handle(async (req) => {
  const b = new Input(Object.fromEntries(new URL(req.url).searchParams));
  const limit = b.has("limit") ? b.int("limit", 1, 50) : 10;
  const offset = b.has("offset") ? b.int("offset", 0, 1_000_000) : 0;
  return json({ orders: await getCustomerHistory(await getBuyerHash(), limit, offset), limit, offset });
});
