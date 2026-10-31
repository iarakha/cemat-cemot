import { requireAdmin } from "@/server/admin-auth";
import { adminOrderView } from "@/server/admin-orders";
import { handle, isUuid, json, NOT_FOUND } from "@/server/http";
export const GET = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  await requireAdmin(req);
  const { id } = await params;
  if (!isUuid(id)) throw NOT_FOUND;
  return json(await adminOrderView(id));
});
