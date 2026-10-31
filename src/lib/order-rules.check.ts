import assert from "node:assert/strict";
import { bookingCode, historyPage, normalizePhone, ORDER_PHASES } from "./order-rules";

assert.equal(normalizePhone("081234567890"), "6281234567890");
assert.equal(normalizePhone("6281234567890"), "6281234567890");
for (const phone of ["081", "621234567890", "08123456789012", "+6281234567890", "0812x4567890"]) {
  assert.throws(() => normalizePhone(phone));
}
assert.equal(bookingCode("2026-10-30", 120, "fore"), "CC301020260120F");
assert.equal(bookingCode("2027-10-30", 120, "kopi-kenangan"), "CC301020270120K");
assert.equal(bookingCode("2026-10-30", 10000, "cotti"), "CC3010202610000C");
assert.throws(() => bookingCode("2026-02-30", 1, "fore"));
assert.throws(() => bookingCode("2026-10-30", 0, "fore"));
assert.throws(() => bookingCode("2026-10-30", 1, "unknown"));
assert.deepEqual(historyPage(), { limit: 10, offset: 0 });
for (const [limit, offset] of [[0, 0], [51, 0], [10, -1], [10, 0.5]]) assert.throws(() => historyPage(limit, offset));
assert.deepEqual(ORDER_PHASES.map(([status]) => status), ["PENDING_PAYMENT", "PROOF_SENT", "VERIFYING", "PAID", "PROCESSING", "READY", "DONE"]);
console.log("order rules ok");
