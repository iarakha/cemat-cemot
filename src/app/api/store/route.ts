import { STORE_STATUS_LABEL } from "@/lib/config";
import { handle, json } from "@/server/http";
import { getSettings } from "@/server/store";

// Status toko publik (layar S00b–S00e): status, jam, fee, batas.
export const GET = handle(async () => {
  const s = await getSettings();
  return json({
    status: s.status, statusLabel: STORE_STATUS_LABEL[s.status], message: s.closedMessage,
    openAt: s.openAt.slice(0, 5), closeAt: s.closeAt.slice(0, 5), serviceFee: s.serviceFee, maxCups: s.maxCups,
    paymentWindowMin: s.paymentWindowMin, checkoutCutoffMin: s.checkoutCutoffMin, verifyEtaMin: s.verifyEtaMin, adminWa: s.adminWa,
  });
});
