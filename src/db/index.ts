import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("Falta DATABASE_URL (ver .env.example)");

/**
 * En producción esta URL es la del **pooler** (PgBouncer en transaction mode).
 * Sirve para todo lo que hace la app:
 *
 *   · el constraint trigger deferido valida al COMMIT, y transaction mode
 *     mantiene la misma conexión durante toda la transacción;
 *   · los prepared statements a nivel de protocolo — los que usa postgres-js —
 *     sí funcionan por el pooler, a diferencia del `PREPARE` de SQL.
 *
 * Lo que NO puede ir por acá son las migraciones: ver `loadMigrationEnv`.
 */
const globalForDb = globalThis as unknown as {
  smartMoneySql?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.smartMoneySql ??
  postgres(url, {
    // Chico pero no 1: las pantallas lanzan varias consultas en paralelo con
    // Promise.all, y con una sola conexión se serializan. Además una lectura
    // dentro de una transacción se colgaría.
    max: 5,
    // Neon exige TLS; en local no hay.
    ssl: url.includes("localhost") ? false : "require",
  });
if (process.env.NODE_ENV !== "production") globalForDb.smartMoneySql = client;

export const db = drizzle(client, { schema });
export { schema };
export type Db = typeof db;
