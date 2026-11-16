import { requireAdmin } from "@/server/admin-auth";
import { handle } from "@/server/http";
import { TEMPLATE_CSV } from "@/server/menu-import";
export const GET = handle(async req => {
  await requireAdmin(req);
  return new Response(TEMPLATE_CSV, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="templat-impor-menu.csv"', "Cache-Control": "no-store" } });
});
