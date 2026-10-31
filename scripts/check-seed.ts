// Jalankan pada DB lokal yang sudah berisi katalog. Membuktikan seed ulang tidak mengubah data.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import postgres from "postgres";

const url = new URL(process.env.DATABASE_URL!);
assert(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Hanya DB lokal");
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

async function snapshot() {
  return sql.begin("isolation level repeatable read read only", async (tx) => {
    const tables = await tx`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
    const result: Record<string, { count: number; hash: string }> = {};
    for (const { tablename } of tables) {
      const rows = await tx`SELECT to_jsonb(t)::text AS row FROM ${tx(tablename)} t ORDER BY to_jsonb(t)::text`;
      result[tablename] = { count: rows.length, hash: createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
    }
    return result;
  });
}

async function main() {
  const before = await snapshot();
  assert(before.brands.count >= 5 && before.menu_items.count > 0, "Butuh katalog terisi sebelum cek seed ulang");
  for (let i = 0; i < 2; i++) {
    const run = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/db/seed.ts"], { env: process.env, timeout: 30000, encoding: "utf8" });
    assert.equal(run.status, 0, "Seed gagal");
    assert.deepEqual(await snapshot(), before, "Seed mengubah data yang sudah ada");
  }
  console.log(`Seed check ok: 2 runs, ${before.outlets.count} outlets dan seluruh tabel publik tidak berubah`);
}

main().catch(() => { console.error("Seed check gagal; periksa seed dan kondisi DB"); process.exitCode = 1; }).finally(() => sql.end());
