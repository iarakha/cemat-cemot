// Create isolated local DB; migrate + seed; run production HTTP flow; remove only owned test DB/files.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import postgres from "postgres";

const source = new URL(process.env.DATABASE_URL!);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(source.hostname), "Local DB only");
const name = `cemat_cemot_api_test_${randomBytes(6).toString("hex")}`;
const adminUrl = new URL(source); adminUrl.pathname = "/postgres";
const admin = postgres(adminUrl.toString(), { max: 1 });
const testUrl = new URL(source); testUrl.pathname = "/" + name;
const scratch = process.env.TMPDIR;
assert.ok(scratch, "TMPDIR required");
let dir: string | undefined;
let server: ReturnType<typeof spawn> | undefined;
async function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${command} failed (${code})`)));
  });
}
async function main() {
try {
  await admin.unsafe(`CREATE DATABASE "${name}"`); // server-generated identifier, no user input
  dir = await mkdtemp(path.join(scratch!, "cc-api-test-"));
  const port = "3211";
  const env = { ...process.env, DATABASE_URL: testUrl.toString(), UPLOAD_DIR: dir, OTP_HMAC_SECRET: randomBytes(32).toString("hex"), CRON_SECRET: randomBytes(32).toString("hex"), APP_URL: `http://localhost:${port}`, API_BASE_URL: `http://localhost:${port}` };
  await run(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "migrate"], env);
  await run("npx", ["tsx", "src/db/seed.ts"], { ...env, NODE_ENV: "development" });
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", port], { env: { ...env, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
  // Do not log request URL containing private tracking tokens; keep bounded server diagnostics for failure.
  let log = "";
  server.stdout?.on("data", b => { log = (log + b.toString()).slice(-8000); });
  server.stderr?.on("data", b => { log = (log + b.toString()).slice(-8000); });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error("API server exited");
    try { const r = await fetch(env.API_BASE_URL + "/api/health"); if (r.ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  assert.ok(ready, "API server did not become healthy");
  try { await run("npx", ["tsx", "scripts/check-api-flow.ts"], env); }
  catch (e) {
    // Logs never print tokens; only application structured error lines.
    console.error(log.split("\n").filter(line => line.startsWith('{"level":')).join("\n"));
    throw e;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : "API test failed"); process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise<void>(resolve => { server!.once("exit", () => resolve()); setTimeout(resolve, 5000); });
  }
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
  if (dir) await rm(dir, { recursive: true, force: true });
}
}
main().catch(() => { console.error("API test cleanup failed"); process.exitCode = 1; });
