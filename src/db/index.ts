import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Falta DATABASE_URL (ver .env.example)");

// En dev Next.js recarga los módulos: cachear el pool evita agotar conexiones.
const globalForDb = globalThis as unknown as {
  smartMoneySql?: ReturnType<typeof postgres>;
};

const client = globalForDb.smartMoneySql ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.smartMoneySql = client;

export const db = drizzle(client, { schema });
export { schema };
export type Db = typeof db;
