import { requireCron } from "@/server/cron-auth";
import { handle, json } from "@/server/http";
import { syncOsm } from "@/server/osm-sync";
export const POST = handle(async (req) => {
  requireCron(req);
  return json(await syncOsm());
});
