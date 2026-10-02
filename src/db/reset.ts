/**
 * Borra el esquema completo de la base de PRUEBAS para correr las migraciones
 * de cero. Destructivo.
 *
 * Nunca toca la base real: para eso hay que apuntar DATABASE_URL a mano y
 * saber lo que se está haciendo.
 */
import postgres from "postgres";
import { loadEnv } from "./env";

async function main() {
  const sql = postgres(loadEnv({ scratch: true }), { max: 1 });
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
