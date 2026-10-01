/**
 * Parseo y formato de plata. Nunca pasa por `number`.
 *
 * El parseo tiene que aguantar cómo se escribe de verdad en Argentina:
 * "25000", "25.000", "25.000,50" y también "25000.50". La regla, en orden:
 *
 *   · Si hay coma, la coma es el separador decimal y los puntos son de miles.
 *   · Si no hay coma y hay un solo punto con 1 o 2 dígitos detrás, ese punto
 *     es decimal ("1.55" = 1,55).
 *   · Si no, los puntos son de miles ("1.550" = 1550).
 *
 * El caso que la regla resuelve a propósito es "1.550": en esta app es mil
 * quinientos cincuenta, no uno con cincuenta y cinco.
 */

/** Decimales de `numeric(20,4)`. */
export const MONEY_SCALE = 4;

export class MoneyParseError extends Error {}

/**
 * Saca los puntos de miles, validando los grupos: el primero de 1 a 3 dígitos
 * y los demás de exactamente 3.
 *
 * La validación no es cosmética. Sin ella "1.0000001" — un dedazo sobre
 * "1.0" — pasaba como separador de miles y se convertía en 10.000.001 en
 * silencio. Un monto ambiguo tiene que fallar, no adivinarse.
 */
function stripThousands(part: string, raw: string): string {
  if (!part.includes(".")) return part;
  const groups = part.split(".");
  const bad =
    groups[0].length < 1 ||
    groups[0].length > 3 ||
    groups.slice(1).some((g) => g.length !== 3);
  if (bad) {
    throw new MoneyParseError(
      `Monto ambiguo: ${raw}. Usá la coma para los decimales (25.000,50).`,
    );
  }
  return groups.join("");
}

/** Devuelve un string decimal canónico listo para `numeric`. */
export function parseAmountInput(raw: string): string {
  const trimmed = raw.trim().replace(/\s| /g, "");
  if (!trimmed) throw new MoneyParseError("Falta el monto");

  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;

  if (!/^[\d.,]+$/.test(body)) {
    throw new MoneyParseError(`No parece un monto: ${raw}`);
  }

  let whole: string;
  let frac = "";

  if (body.includes(",")) {
    const parts = body.split(",");
    if (parts.length > 2) {
      throw new MoneyParseError(`Monto con más de una coma: ${raw}`);
    }
    whole = stripThousands(parts[0], raw);
    frac = parts[1] ?? "";
  } else {
    const dots = body.split(".");
    const last = dots[dots.length - 1];
    if (dots.length === 2 && last.length > 0 && last.length <= 2) {
      // "1.55" → decimal.
      whole = dots[0];
      frac = last;
    } else {
      // "1.550" o "1.234.567" → separadores de miles.
      whole = stripThousands(body, raw);
    }
  }

  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) {
    throw new MoneyParseError(`No parece un monto: ${raw}`);
  }
  if (frac.length > MONEY_SCALE) {
    throw new MoneyParseError(
      `El monto no puede tener más de ${MONEY_SCALE} decimales: ${raw}`,
    );
  }

  const value = `${whole || "0"}${frac ? `.${frac}` : ""}`;
  if (/^0*(\.0*)?$/.test(value)) {
    throw new MoneyParseError("El monto no puede ser 0");
  }
  return `${negative ? "-" : ""}${value}`;
}

/** Formato de lectura. Recibe el string que vino de la base. */
export function formatMoney(
  amount: string,
  currency: "ARS" | "USD",
  opts: { sign?: boolean } = {},
): string {
  const n = Number(amount);
  const body = new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Math.abs(n));
  const prefix = n < 0 ? "−" : opts.sign ? "+" : "";
  return `${prefix}${currency === "USD" ? "US$" : "$"} ${body}`;
}
