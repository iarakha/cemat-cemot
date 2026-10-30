// MD-05: buat/ganti akun admin. Pakai: npm run admin:create -- email@x.com 'password-min-12-karakter'
import { randomBytes, scryptSync } from "node:crypto";
import { db } from "../src/db";
import { adminUsers } from "../src/db/schema";

const [email, password] = process.argv.slice(2);
if (!email?.includes("@") || !password || password.length < 12) {
  console.error("Pakai: npm run admin:create -- email 'password (min 12 karakter)'");
  process.exit(1);
}
// Format: scrypt$<salt hex>$<hash hex>. ponytail: parameter default Node; naikkan N jika perlu.
const salt = randomBytes(16);
const passwordHash = `scrypt$${salt.toString("hex")}$${scryptSync(password, salt, 64).toString("hex")}`;
db.insert(adminUsers).values({ email: email.toLowerCase(), passwordHash })
  .onConflictDoUpdate({ target: adminUsers.email, set: { passwordHash } })
  .then(() => { console.log("admin ok:", email.toLowerCase()); process.exit(0); },
    (e) => { console.error(e); process.exit(1); });
