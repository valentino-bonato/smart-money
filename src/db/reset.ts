/**
 * Borra el esquema completo para poder correr las migraciones de cero.
 * Destructivo: solo para desarrollo local.
 */
import postgres from "postgres";
import { loadEnv } from "./env";

async function main() {
  const sql = postgres(loadEnv(), { max: 1 });
  await sql.unsafe(`
    drop schema if exists public cascade;
    create schema public;
    drop schema if exists drizzle cascade;
  `);
  console.log("Esquema borrado. Correr: npm run db:migrate && npm run db:seed");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
