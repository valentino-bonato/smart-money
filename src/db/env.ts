import { config } from "dotenv";

/**
 * Carga .env.local y .env para los scripts de CLI (drizzle-kit, seed, verify).
 *
 * `scratch: true` devuelve la base de pruebas. El seed TRUNCA todo y los
 * verificadores asumen que la base tiene exactamente lo que el seed dejó, así
 * que no pueden correr contra la base con los datos reales: o le borran los
 * movimientos al usuario, o fallan porque hay movimientos que no esperaban.
 */
export function loadEnv(opts: { scratch?: boolean } = {}) {
  config({ path: ".env.local", quiet: true });
  config({ path: ".env", quiet: true });

  if (opts.scratch) {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) {
      throw new Error(
        "Falta TEST_DATABASE_URL. Los scripts de prueba no corren contra la " +
          "base real: el seed la borraría. Ver .env.example.",
      );
    }
    return url;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("Falta DATABASE_URL (ver .env.example)");
  }
  return process.env.DATABASE_URL;
}

/**
 * La conexión para migrar. En local es la misma; en Neon tiene que ser la
 * **directa**, no la del pooler.
 *
 * PgBouncer corre en transaction mode y ahí no funcionan las cosas de alcance
 * de sesión — `SET`, `PREPARE` de SQL, tablas temporales que sobreviven a la
 * transacción. Las migraciones usan varias de esas, así que por el pooler
 * fallan o, peor, se aplican a medias.
 */
export function loadMigrationEnv() {
  config({ path: ".env.local", quiet: true });
  config({ path: ".env", quiet: true });
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Falta DATABASE_URL (ver .env.example)");
  return url;
}
