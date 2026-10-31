import { requireAdmin } from "@/server/admin-auth";
import { listData, saveData } from "@/server/admin-data";
import { assertBodySize } from "@/server/files";
import { handle, json, readBody } from "@/server/http";
type Ctx = { params: Promise<{ entity: string }> };
export const GET = handle<Ctx>(async (req, { params }) => {
  await requireAdmin(req);
  return json(await listData((await params).entity, new URL(req.url).searchParams));
});
export const POST = handle<Ctx>(async (req, { params }) => {
  await requireAdmin(req);
  assertBodySize(req);
  const entity = (await params).entity;
  return json(await saveData(entity, null, await readBody(req)), entity === "settings" ? 200 : 201);
});
