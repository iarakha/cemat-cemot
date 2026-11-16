import { requireAdmin } from "@/server/admin-auth";
import { assertBodySize } from "@/server/files";
import { handle, json, readBody } from "@/server/http";
import { previewImport } from "@/server/menu-import";
export const POST = handle(async req => {
  const admin = await requireAdmin(req);
  assertBodySize(req);
  return json(await previewImport(admin.id, (await readBody(req)).file("file")));
});
