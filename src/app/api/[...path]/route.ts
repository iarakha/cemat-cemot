import { handle, NOT_FOUND } from "@/server/http";

// Endpoint /api/* yang tidak ada -> error JSON seragam, bukan halaman HTML 404.
const notFound = handle<unknown>(async () => { throw NOT_FOUND; });
export const GET = notFound, POST = notFound, PUT = notFound, PATCH = notFound, DELETE = notFound;
