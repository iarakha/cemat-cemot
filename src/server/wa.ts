// Template pesan WhatsApp (RND 6.15). Dibuat di server; sistem tidak mengirim WA (BR-30).
import { waLink } from "@/lib/config";
import { appUrl } from "./http";

const rp = (n: number) => new Intl.NumberFormat("id-ID").format(n);
const MAX = 1000;
const cut = (s: string) => (s.length > MAX ? s.slice(0, MAX - 1) + "…" : s);

export function itemSummary(items: { name: string; qty: number }[]) {
  const head = items.slice(0, 5).map((i) => `${i.name} x${i.qty}`);
  const rest = items.length - head.length;
  return head.join(", ") + (rest > 0 ? `, ...dan ${rest} item lain` : "");
}

export type WaOrder = {
  orderCode: string; customerName: string; customerPhone: string; total: number; trackingToken: string;
  brand: string; outlet: string; items: { name: string; qty: number }[];
};
const url = (o: WaOrder) => `${appUrl()}/pesanan/${o.trackingToken}`;

// A / A2: pembeli -> admin
export const waNotifyAdmin = (adminWa: string, o: WaOrder) => waLink(adminWa, cut(
  `Halo admin CematCemot, saya sudah bayar dan unggah bukti.\nPesanan: ${o.orderCode}\nNama: ${o.customerName}\nWA: ${o.customerPhone}\n` +
  `Outlet: ${o.brand} ${o.outlet}\nItem: ${itemSummary(o.items)}\nTotal: Rp${rp(o.total)}\nLink: ${url(o)}`));
export const waHelpAdmin = (adminWa: string, o: WaOrder) => waLink(adminWa, cut(
  `Halo admin CematCemot. Saya ${o.customerName}, pesanan ${o.orderCode} sebesar Rp${rp(o.total)}. Link pesanan: ${url(o)}. Saya tidak bisa mengunggah bukti, ini bukti pembayaran saya.`));
// B / C / D: admin -> pembeli
export const waConfirmed = (o: WaOrder) => waLink(o.customerPhone, cut(
  `Halo ${o.customerName}, pembayaran pesanan ${o.orderCode} sebesar Rp${rp(o.total)} sudah kami terima. Pesananmu masuk proses. Pantau di ${url(o)}`));
export const waRejected = (o: WaOrder, reason: string, deadline: string) => waLink(o.customerPhone, cut(
  `Halo ${o.customerName}, pembayaran pesanan ${o.orderCode} belum bisa kami konfirmasi: ${reason}. Mohon unggah bukti yang benar di link pesanan sebelum ${deadline}. ${url(o)}`));
export const waReady = (o: WaOrder, queueNumber: string) => waLink(o.customerPhone, cut(
  `Halo ${o.customerName}, pesanan ${o.orderCode} siap diambil di ${o.outlet}. Nomor antrian: ${queueNumber}. Tunjukkan ke kasir. Foto bukti pesanan ada di ${url(o)}`));
