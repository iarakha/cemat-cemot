import { requireAdmin } from "@/server/admin-auth";
import { listOrders } from "@/server/admin-orders";
import { handle, json } from "@/server/http";
export const GET = handle(async (req) => {
  await requireAdmin(req);
  return json(await listOrders(new URL(req.url).searchParams));
});
