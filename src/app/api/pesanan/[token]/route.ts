import { handle, json, NOT_FOUND } from "@/server/http";
import { trackingView } from "@/server/order-flow";

// API-03 (polling 10 detik). 404 sama untuk token salah/tidak pernah ada (6.9 step 4).
export const GET = handle<{ params: Promise<{ token: string }> }>(async (_req, { params }) => {
  const view = await trackingView((await params).token);
  if (!view) throw NOT_FOUND;
  return json(view);
});
