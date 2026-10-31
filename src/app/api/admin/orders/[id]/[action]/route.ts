import { requireAdmin } from "@/server/admin-auth";
import { orderAction } from "@/server/admin-orders";
import { assertBodySize } from "@/server/files";
import { handle, isUuid, json, NOT_FOUND, readBody, bad } from "@/server/http";
import { submitPaymentProof } from "@/server/order-flow";
export const POST = handle<{ params: Promise<{ id: string; action: string }> }>(async (req, { params }) => {
  const admin = await requireAdmin(req);
  const { id, action } = await params;
  if (!isUuid(id)) throw NOT_FOUND;
  assertBodySize(req);
  const b = await readBody(req);
  if (action === "payment-proof") {
    const file = b.file("file");
    if (!file) throw bad("file", "wajib");
    await submitPaymentProof({ id }, file, "admin", admin.id);
    return json({ ok: true });
  }
  return json(await orderAction(id, action, b, admin.id));
});
