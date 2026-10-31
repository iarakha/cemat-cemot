// MD-05: npm run admin:create -- username email. Password diketik tersembunyi, bukan argumen shell.
import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { db } from "../src/db";
import { adminUsers } from "../src/db/schema";

async function main() {
  const [rawUsername, rawEmail, ...extra] = process.argv.slice(2);
  const username = rawUsername?.trim().toLowerCase();
  const email = rawEmail?.trim().toLowerCase();
  if (extra.length || !username || !/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username) ||
      !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Pakai: npm run admin:create -- username email (username 3–32 karakter: a-z, 0-9, _, ., -)");
  }
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("Pembuatan admin remote perlu persetujuan terpisah");
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Jalankan di terminal interaktif untuk input password tersembunyi");
  const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  rl.on("SIGINT", () => rl.close());
  let password: string;
  try {
    process.stdout.write("Password (min 8 karakter, tersembunyi): ");
    password = await rl.question("");
    process.stdout.write("\nUlangi password: ");
    const confirmation = await rl.question("");
    process.stdout.write("\n");
    if (password.length < 8 || password.length > 1024 || password !== confirmation) {
      throw new Error("Password harus 8–1024 karakter dan konfirmasi harus sama");
    }
  } finally {
    rl.close();
  }
  const salt = randomBytes(16);
  const passwordHash = `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`;
  // Insert saja: konflik username/email tidak boleh diam-diam mengganti password akun lama.
  await db.insert(adminUsers).values({ username, email, passwordHash });
  console.log("admin dibuat:", username);
}

main().then(() => process.exit(0), (error: unknown) => {
  console.error(error instanceof Error && !Object.hasOwn(error, "query") && !Object.hasOwn(error, "code") ? error.message : "Gagal membuat admin; username/email mungkin sudah dipakai");
  process.exit(1);
});
