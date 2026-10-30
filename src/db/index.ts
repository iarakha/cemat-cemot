import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const g = globalThis as unknown as { pg?: ReturnType<typeof postgres> };
const client = (g.pg ??= postgres(process.env.DATABASE_URL!));

export const db = drizzle(client, { schema });
