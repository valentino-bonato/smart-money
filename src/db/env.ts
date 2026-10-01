import { config } from "dotenv";

/** Carga .env.local y .env para los scripts de CLI (drizzle-kit, seed). */
export function loadEnv() {
  config({ path: ".env.local", quiet: true });
  config({ path: ".env", quiet: true });
  if (!process.env.DATABASE_URL) {
    throw new Error("Falta DATABASE_URL (ver .env.example)");
  }
  return process.env.DATABASE_URL;
}
