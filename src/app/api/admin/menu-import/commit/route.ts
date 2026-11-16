import { requireAdmin } from "@/server/admin-auth";
import { assertBodySize } from "@/server/files";
import { handle, json, readBody } from "@/server/http";
import { commitImport } from "@/server/menu-import";
export const POST = handle(async req => {
  const admin = await requireAdmin(req);
  assertBodySize(req);
  const b = await readBody(req);
  return json(await commitImport(admin.id, b.file("file"), b.str("token", 1, 300), b.optBool("skipErrors") ?? false));
});
