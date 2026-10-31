import { assertSameOrigin, handle, Input, noContent } from "@/server/http";
import { setRefundAccount } from "@/server/order-flow";

// API-04
export const POST = handle<{ params: Promise<{ token: string }> }>(async (req, { params }) => {
  assertSameOrigin(req);
  await setRefundAccount((await params).token, await Input.json(req));
  return noContent();
});
