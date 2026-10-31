import { requireCron } from "@/server/cron-auth";
import { handle, json } from "@/server/http";
import { expireOrders } from "@/server/order-flow";
export const POST = handle(async (req) => {
  requireCron(req);
  return json({ expired: await expireOrders() });
});
