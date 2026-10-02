import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Puerta de entrada de la app.
 *
 * La app NO tiene login propio: es de un solo usuario y `getCurrentUser()`
 * devuelve la única fila de `users`. Sin esto, cualquiera con la URL ve y
 * modifica las finanzas de Valentino — comprobado contra el deploy, un `curl`
 * anónimo devolvía los saldos reales.
 *
 * Es autenticación básica a propósito: el navegador la recuerda, así que en el
 * teléfono se escribe una vez y no vuelve a molestar. La prioridad de §8 es que
 * cargar un gasto no pase de 10 segundos, y una pantalla de login propia en
 * cada visita iría en contra.
 *
 * **Falla cerrado.** Si `APP_PASSWORD` no está configurada no entra nadie, ni
 * siquiera en local. Al revés —abrir cuando falta la config— es exactamente el
 * error que dejó la app expuesta la primera vez.
 */
const REALM = 'Basic realm="smart money", charset="UTF-8"';

/** Comparación en tiempo constante: no filtra cuántos caracteres acertó. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    return new NextResponse(
      "Falta APP_PASSWORD. La app no se abre sin contraseña configurada.",
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const expected = `Basic ${btoa(`${process.env.APP_USER ?? "valentino"}:${password}`)}`;

  if (!sameSecret(header, expected)) {
    return new NextResponse("Hace falta la contraseña.", {
      status: 401,
      headers: { "WWW-Authenticate": REALM },
    });
  }

  return NextResponse.next();
}

export const config = {
  // Todo menos los estáticos y el favicon: las server actions son POST a las
  // mismas rutas, así que quedan cubiertas.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
