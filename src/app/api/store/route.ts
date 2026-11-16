import { STORE_STATUS_LABEL } from "@/lib/config";
import { handle, json } from "@/server/http";
import { effectiveStore, getSettings } from "@/server/store";

// Status toko publik (layar S00b–S00e): status, jam, fee, batas.
export const GET = handle(async () => {
  const s = await getSettings();
  const e = await effectiveStore(s);
  return json({
    status: e.status, statusLabel: STORE_STATUS_LABEL[e.status], message: s.closedMessage,
    openAt: e.openAt.slice(0, 5), closeAt: e.closeAt.slice(0, 5), closedToday: e.closedToday, serviceFee: s.serviceFee, maxCups: s.maxCups,
    paymentWindowMin: s.paymentWindowMin, checkoutCutoffMin: s.checkoutCutoffMin, verifyEtaMin: s.verifyEtaMin, adminWa: s.adminWa,
  });
});
