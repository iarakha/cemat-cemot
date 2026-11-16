import assert from "node:assert/strict";
import { statusIntentUpdate } from "./store-status";

assert.deepEqual(statusIntentUpdate("CLOSED", "CLOSED", true), { status: "CLOSED", refreshTimestamp: true });
assert.deepEqual(statusIntentUpdate("CLOSED", "OPEN", true), { status: "OPEN", refreshTimestamp: true });
assert.deepEqual(statusIntentUpdate("CLOSED", "OPEN", false), { status: "CLOSED", refreshTimestamp: false });
console.log("store status intent checks passed");
