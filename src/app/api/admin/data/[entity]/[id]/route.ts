import { requireAdmin } from "@/server/admin-auth";
import { deleteData, saveData } from "@/server/admin-data";
import { assertBodySize } from "@/server/files";
import { handle, Input, json, noContent, readBody } from "@/server/http";
type Ctx = { params: Promise<{ entity: string; id: string }> };
export const PUT = handle<Ctx>(async (req, { params }) => {
  await requireAdmin(req);
  assertBodySize(req);
  const { entity, id } = await params;
  return json(await saveData(entity, id, await readBody(req)));
});
export const DELETE = handle<Ctx>(async (req, { params }) => {
  await requireAdmin(req);
  const { entity, id } = await params;
  await deleteData(entity, id, await Input.json(req));
  return noContent();
});
