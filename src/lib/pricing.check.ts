import assert from "node:assert/strict";
import { applyPromo, bestPromo, orderTotal, pickUniqueCode, rupiah, unitPrice } from "./pricing";

assert.equal(applyPromo(29000, { type: "PERCENT", value: 20 }), 23200);
assert.equal(applyPromo(3000, { type: "AMOUNT_OFF", value: 5000 }), 0);
assert.equal(applyPromo(8000, { type: "FIXED_PRICE", value: 9900 }), 8000);
assert.equal(bestPromo(10000, [{ type: "FIXED_PRICE", value: 12000 }]), null);
assert.equal(bestPromo(20000, [{ type: "PERCENT", value: 10 }, { type: "AMOUNT_OFF", value: 5000 }])?.final, 15000);
assert.equal(rupiah(24000), "Rp24.000");
// BR-04: promo hanya ke harga dasar, delta opsi tidak ikut didiskon
assert.equal(unitPrice(29000, [{ type: "PERCENT", value: 20 }], [4000, 0]), 27200);
assert.equal(unitPrice(29000, [], [-1000]), 28000);
assert.equal(unitPrice(1000, [], [-5000]), 0);
// BR-06
assert.equal(orderTotal([{ unitPrice: 27200, qty: 2 }, { unitPrice: 24000, qty: 1 }], 5000, 37), 83437);
// BR-24
assert.equal(pickUniqueCode([], () => 0), 1);
assert.equal(pickUniqueCode([1, 2, 3], () => 0), 4);
assert.equal(pickUniqueCode(Array.from({ length: 98 }, (_, i) => i + 1)), 99);
assert.equal(pickUniqueCode(Array.from({ length: 99 }, (_, i) => i + 1)), null);
console.log("pricing ok");
