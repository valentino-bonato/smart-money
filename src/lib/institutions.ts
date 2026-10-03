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
  { key: "bbva", label: "BBVA", cssVar: "--bank-bbva", match: /bbva/i },
  {
    key: "mercadopago",
    label: "Mercado Pago",
    cssVar: "--bank-mercadopago",
    match: /mercado\s*pago/i,
  },
  {
    key: "cocos",
    label: "Cocos Capital",
    cssVar: "--bank-cocos",
    match: /cocos/i,
  },
  { key: "uala", label: "Ualá", cssVar: "--bank-uala", match: /ual[áa]/i },
];

export function institutionFor(accountName: string): Institution | null {
  const found = INSTITUTIONS.find((i) => i.match.test(accountName));
  if (!found) return null;
  const { key, label, cssVar } = found;
  return { key, label, cssVar };
}
