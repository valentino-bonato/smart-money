import { defineConfig } from "drizzle-kit";
import { loadMigrationEnv } from "./src/db/env";

// Migrar va SIEMPRE por la conexión directa. En Neon el pooler corre en
// transaction mode y las migraciones usan features de sesión que ahí no
// existen. `db:migrate:test` sobreescribe la URL con la base de pruebas.
const url = process.env.DATABASE_URL ?? loadMigrationEnv();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
