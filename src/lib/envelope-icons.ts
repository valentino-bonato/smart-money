import {
  Beer,
  Car,
  HeartPulse,
  Heart,
  Landmark,
  Languages,
  Plane,
  Repeat,
  Shield,
  ShoppingCart,
  TrendingUp,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * El ícono y el color de cada sobre.
 *
 * Para qué: en `/presupuesto` hay trece tarjetas iguales en una grilla, y el
 * único dato que las distingue es un nombre en el mismo tipo y tamaño que el
 * de al lado. Un ícono con color se reconoce antes de leer — igual que el
 * punto de institución en las listas de cuentas.
 *
 * **El color es de identidad, no de estado.** Es la distinción que hace que
 * esto no choque con el "sin colores, a propósito" de esa pantalla: el rojo
 * sigue siendo el único color que significa algo ("te pasaste"), y por eso
 * ninguna categoría usa rojo. Lo demás solo dice "esto es Comida" y dice lo
 * mismo siempre.
 *
 * Y vive **solo dentro del ícono de 20px**: la tarjeta sigue neutra. Pintar la
 * tarjeta entera devolvería el semáforo que la pantalla evita a propósito.
 *
 * El match es por nombre y tolerante, por la misma razón que el de las
 * instituciones: los sobres los nombra el usuario. Uno que no matchea no es un
 * error — se dibuja con el gris del tema y una billetera.
 */
export type EnvelopeLook = {
  key: string;
  icon: LucideIcon;
  /** Variable CSS, para usar en `style`. */
  cssVar: string;
};

const LOOKS: (EnvelopeLook & { match: RegExp })[] = [
  // "Auto — ahorro" y "Auto — corriente" comparten ícono y color a propósito:
  // son el mismo propósito en dos tiempos, y verlos hermanados es correcto.
  { key: "auto", icon: Car, cssVar: "--cat-auto", match: /auto/i },
  {
    key: "comida",
    icon: ShoppingCart,
    cssVar: "--cat-comida",
    match: /comida|s[úu]per|super/i,
  },
  { key: "amigos", icon: Beer, cssVar: "--cat-amigos", match: /amigos|salidas/i },
  {
    key: "suscripciones",
    icon: Repeat,
    cssVar: "--cat-suscripciones",
    match: /suscripci/i,
  },
  {
    key: "ingles",
    icon: Languages,
    cssVar: "--cat-ingles",
    match: /ingl[ée]s/i,
  },
  { key: "viaje", icon: Plane, cssVar: "--cat-viaje", match: /viaje/i },
  {
    key: "emergencia",
    icon: Shield,
    cssVar: "--cat-emergencia",
    match: /emergencia/i,
  },
  {
    key: "inversion",
    icon: TrendingUp,
    cssVar: "--cat-inversion",
    match: /cedear|inversi/i,
  },
  {
    key: "impuestos",
    icon: Landmark,
    cssVar: "--cat-impuestos",
    match: /impuesto|afip|arca/i,
  },
  { key: "salud", icon: HeartPulse, cssVar: "--cat-salud", match: /salud/i },
  {
    key: "puntuales",
    icon: Zap,
    cssVar: "--cat-puntuales",
    match: /puntual|extra/i,
  },
  // Último: "Rochi" es un nombre propio y no tiene palabra que lo delate, así
  // que matchea por sí mismo y va al final para no ganarle a nada.
  { key: "rochi", icon: Heart, cssVar: "--cat-rochi", match: /rochi|pareja/i },
];

const FALLBACK: EnvelopeLook = {
  key: "otro",
  icon: Wallet,
  cssVar: "--cat-otro",
};

export function envelopeLook(name: string): EnvelopeLook {
  const found = LOOKS.find((l) => l.match.test(name));
  if (!found) return FALLBACK;
  const { key, icon, cssVar } = found;
  return { key, icon, cssVar };
}
