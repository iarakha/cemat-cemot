import { sql } from "drizzle-orm";
import { db } from "@/db";
import { handle, json } from "@/server/http";

export const GET = handle(async () => {
  await db.execute(sql`select 1`);
  return json({ ok: true });
});
