/**
 * El color de marca de cada institución.
 *
 * Para qué: las cuentas se leen en listas donde el nombre es largo y parecido
 * —"BBVA caja de ahorro", "BBVA caja de ahorro en dólares", "Tarjeta de crédito
 * BBVA — USD"—, y conciliar es ir y volver entre el homebanking y la app. Un
 * punto de color le da a cada renglón un ancla que se reconoce antes de leer.
 *
 * **Es un acento, no un tema.** La app sigue siendo neutra: el color aparece en
 * un punto de 8px y nada más. Pintar la fila entera haría que una lista de seis
 * cuentas parezca un gráfico, y §7 no quiere tableros.
 *
 * El valor de cada color vive en `globals.css` con una variante para claro y
 * otra para oscuro, porque ninguna marca sirve sin ajustar: el azul de BBVA
 * (#004481) es casi negro sobre fondo oscuro, y el amarillo de Mercado Pago
 * (#ffe600) es invisible sobre blanco.
 *
 * Se guarda el **nombre de la variable** y no una clase de Tailwind a propósito:
 * una clase armada como `bg-bank-${key}` no la ve el escáner de Tailwind y sale
 * sin estilo en producción.
 */
export type Institution = {
  key: string;
  label: string;
  /** Variable CSS, para usar en `style`. */
  cssVar: string;
  /**
   * El logo, con el tamaño al que se dibuja dentro del chip.
   *
   * Las medidas van acá y no en el componente porque **cada marca tiene su
   * proporción**: BBVA es un logotipo apaisado de 160×48, Mercado Pago y Cocos
   * son cuadrados, Ualá es una onda de 1200×628. Un solo tamaño para los
   * cuatro deforma tres. El chip sí mide siempre igual, así que la columna de
   * texto arranca alineada en todas las tarjetas.
   */
  logo: { src: string; width: number; height: number };
};

/**
 * El orden importa: se devuelve la primera que matchea. "Cocos Capital" antes
 * que nada que pueda contener "cocos", y así.
 *
 * El match es por nombre de cuenta y es a propósito tolerante: las cuentas las
 * nombra el usuario y "BBVA caja de ahorro en dólares" tiene que caer en BBVA
 * sin que haya que mantener una lista de nombres exactos. Una cuenta que no
 * matchea ninguna no es un error — "Me deben" no es un banco — y se dibuja con
 * el gris neutro del tema.
 */
const INSTITUTIONS: (Institution & { match: RegExp })[] = [
  {
    key: "bbva",
    label: "BBVA",
    cssVar: "--bank-bbva",
    match: /bbva/i,
    logo: { src: "/logos/bbva.png", width: 42, height: 13 },
  },
  {
    key: "mercadopago",
    label: "Mercado Pago",
    cssVar: "--bank-mercadopago",
    match: /mercado\s*pago/i,
    logo: { src: "/logos/mercadopago.png", width: 26, height: 26 },
  },
  {
    key: "cocos",
    label: "Cocos Capital",
    cssVar: "--bank-cocos",
    match: /cocos/i,
    logo: { src: "/logos/cocos.png", width: 26, height: 26 },
  },
  {
    key: "uala",
    label: "Ualá",
    cssVar: "--bank-uala",
    match: /ual[áa]/i,
    logo: { src: "/logos/uala.png", width: 30, height: 16 },
  },
];

export function institutionFor(accountName: string): Institution | null {
  const found = INSTITUTIONS.find((i) => i.match.test(accountName));
  if (!found) return null;
  const { key, label, cssVar, logo } = found;
  return { key, label, cssVar, logo };
}

/**
 * Qué cuenta es, una vez que el logo ya dijo de qué banco.
 *
 * Hace falta porque el logo solo no alcanza: BBVA tiene cinco cuentas y Cocos
 * dos, así que cinco tarjetas con el mismo logo necesitan un renglón que las
 * distinga. Es el nombre de la cuenta **menos** el nombre de la institución,
 * derivado y no una lista a mano: las cuentas las nombra el usuario, y una
 * tabla paralela de apodos se desincroniza en cuanto renombra una.
 *
 * "BBVA caja de ahorro" → "Caja de ahorro". "Cocos Capital — fondo USD" →
 * "Fondo USD". Cuando no queda nada —"Mercado Pago", "Ualá"— el nombre ya era
 * solo el banco, así que lo que distingue es la moneda.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function accountDetail(
  accountName: string,
  currency: "ARS" | "USD",
): string {
  const institution = INSTITUTIONS.find((i) => i.match.test(accountName));
  const currencyWord = currency === "USD" ? "Dólares" : "Pesos";
  if (!institution) return accountName;

  const rest = accountName
    // La etiqueta primero y el patrón después, en ese orden y los dos: el
    // patrón de Cocos es `/cocos/i` y solo sacaría "Cocos", dejando un
    // "Capital" huérfano. La etiqueta completa ("Cocos Capital") se lleva las
    // dos palabras, y el patrón queda para las que el usuario escribió
    // distinto ("Uala" sin tilde).
    .replace(new RegExp(escapeRegExp(institution.label), "gi"), "")
    .replace(new RegExp(institution.match.source, "gi"), "")
    // Los separadores que quedan colgando cuando se va el nombre del banco:
    // "Cocos Capital — fondo USD" deja " — fondo USD".
    .replace(/\s+/g, " ")
    .replace(/^[\s—·-]+|[\s—·-]+$/g, "")
    // "Ualá en dólares" deja "en dólares": la preposición sobra sin el sujeto.
    .replace(/^en\s+/i, "")
    .trim();

  if (!rest) return currencyWord;

  // El código de moneda que viene colgado de un guión se dice en castellano,
  // que es como se lee el resto de la tarjeta: "Tarjeta de crédito — ARS" queda
  // mal al lado de "Caja de ahorro".
  //
  // **Solo después del guión**, nunca suelto: "Cocos Capital — fondo USD" es el
  // nombre del fondo, no una aclaración de moneda, y traducirlo lo volvía
  // "Fondo dólares".
  const spelled = rest.replace(/([—·-]\s*)ARS$/, "$1pesos").replace(/([—·-]\s*)USD$/, "$1dólares");

  return spelled.charAt(0).toUpperCase() + spelled.slice(1);
}
