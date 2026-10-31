import assert from "node:assert/strict";
import { type OptionGroup, orderTotal, resolveOptions, pickUniqueCode, rupiah, savingPercent, unitPrice } from "./pricing";

assert.equal(savingPercent(30000, 24000), 20);
assert.equal(savingPercent(29000, 23200), 20);
assert.equal(savingPercent(24000, 23999), null); // <1% tidak ditampilkan
assert.equal(savingPercent(29000, 23201), 19); // floor
assert.equal(savingPercent(24000, 24000), null);
assert.equal(savingPercent(24000, 30000), null);
assert.equal(savingPercent(0, 0), null);

assert.equal(rupiah(24000), "Rp24.000");
// BR-04: promo hanya ke harga dasar, delta opsi tidak ikut didiskon
assert.equal(unitPrice(29000, 23200, [4000, 0]), 27200);
assert.equal(unitPrice(29000, null, [-1000]), 28000);
assert.equal(unitPrice(29000, 30000, []), 29000); // promo lebih mahal diabaikan
assert.equal(unitPrice(1000, null, [-5000]), 0);
// BR-03: validasi opsi di server
const G: OptionGroup[] = [
  { id: "g1", name: "Ukuran", required: true, maxSelect: 1, choices: [{ id: "a", label: "Regular", priceDelta: 0, isDefault: true }, { id: "b", label: "Large", priceDelta: 5000, isDefault: false }] },
  { id: "g2", name: "Add-on", required: false, maxSelect: 2, choices: [{ id: "c", label: "Shot", priceDelta: 3000, isDefault: false }, { id: "d", label: "Boba", priceDelta: 4000, isDefault: false }, { id: "e", label: "Jelly", priceDelta: 2000, isDefault: false }] },
];
assert.deepEqual(resolveOptions(G, ["b", "c", "d"]).deltas, [5000, 3000, 4000]);
assert.deepEqual(resolveOptions(G, ["a"]).snapshot, [{ group: "Ukuran", label: "Regular", priceDelta: 0 }]);
assert.equal(unitPrice(29000, 23200, resolveOptions(G, ["b", "c"]).deltas), 31200);
assert.throws(() => resolveOptions(G, []), /wajib/); // grup wajib kosong
assert.throws(() => resolveOptions(G, ["a", "b"]), /maksimal 1/);
assert.throws(() => resolveOptions(G, ["a", "c", "d", "e"]), /maksimal 2/);
assert.throws(() => resolveOptions(G, ["a", "zzz"]), /tidak berlaku/);
assert.throws(() => resolveOptions(G, ["a", "a"]), /duplikat/);
// BR-06
assert.equal(orderTotal([{ unitPrice: 27200, qty: 2 }, { unitPrice: 24000, qty: 1 }], 5000, 37), 83437);
// BR-24
assert.equal(pickUniqueCode([], () => 0), 1);
assert.equal(pickUniqueCode([1, 2, 3], () => 0), 4);
assert.equal(pickUniqueCode(Array.from({ length: 98 }, (_, i) => i + 1)), 99);
assert.equal(pickUniqueCode(Array.from({ length: 99 }, (_, i) => i + 1)), null);
console.log("pricing ok");
