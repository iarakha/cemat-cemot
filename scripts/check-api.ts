// HTTP smoke check read-only. Jalankan saat server hidup: API_BASE_URL=http://localhost:3000 npm run api:check.
import assert from "node:assert/strict";

const base = process.env.API_BASE_URL ?? "http://localhost:3000";
const request = (path: string, init?: RequestInit) => fetch(base + path, init);
async function expect(path: string, status: number, init?: RequestInit) {
  const r = await request(path, init);
  assert.equal(r.status, status, `${init?.method ?? "GET"} ${path}: ${r.status}, expected ${status}`);
  return r;
}
async function main() {
  const health = await expect("/api/health", 200);
  assert.equal((await health.json()).ok, true);
  await expect("/api/store", 200);
  const catalog = await (await expect("/api/catalog", 200)).json();
  assert.ok(catalog.brands.length > 0);
  assert.ok(catalog.brands[0].items[0].options.length > 0);
  await expect("/api/outlets?brand=fore&lat=-6.2&lng=106.8", 200);
  await expect("/api/outlets?brand=fore", 400);
  await expect("/api/pesanan/not-a-token", 404);
  await expect("/api/admin/session", 401);
  await expect("/api/admin/orders", 401);
  await expect("/api/cron/expire-orders", 401, { method: "POST" });
  await expect("/api/cron/osm-sync", 401, { method: "POST" });
  await expect("/api/customer/orders", 401);
  console.log("api read-only checks passed");
}
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
