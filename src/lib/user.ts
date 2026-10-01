import { db } from "@/db";
import * as schema from "@/db/schema";

/**
 * El usuario único del v1.
 *
 * Existe para que no haya un `userId` hardcodeado desparramado por el código:
 * cuando entre auth real, se reemplaza el cuerpo de esta función y nada más.
 */
export async function getCurrentUser() {
  const [user] = await db.select().from(schema.users).limit(1);
  if (!user) {
    throw new Error("No hay usuario. Correr `npm run db:seed`.");
  }
  return user;
}
