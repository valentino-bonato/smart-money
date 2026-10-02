import { defineConfig } from "drizzle-kit";
import { loadEnv } from "./src/db/env";

// Las migraciones van a la base que diga DATABASE_URL. `db:migrate` apunta a
// la real; `db:migrate:test` la sobreescribe con la de pruebas.
loadEnv();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },
  strict: true,
  verbose: true,
});
