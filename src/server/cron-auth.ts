import { timingSafeEqual } from "node:crypto";
import { ApiError } from "./http";
export function requireCron(req: Request) {
  const secret = process.env.CRON_SECRET;
  const input = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || secret.length < 32 || input.length !== expected.length || !timingSafeEqual(Buffer.from(input), Buffer.from(expected))) {
    throw new ApiError(401, "UNAUTHORIZED", "Akses ditolak");
  }
}
