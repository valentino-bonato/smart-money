import { cn } from "cn";
import { formatMoney } from "@/lib/money";

/**
 * Un monto. Siempre `tabular-nums`, y el negativo siempre del mismo color.
 *
 * Existe para que no haya quince lugares decidiendo por su cuenta qué es rojo:
 * un sobre en negativo y un presupuesto pasado son la misma noticia y se tienen
 * que ver igual. `tone="auto"` pinta por el signo; `tone="plain"` es para donde
 * el negativo es normal y no una alarma — una tarjeta de crédito debe plata por
 * definición.
 */
export function Amount({
  amount,
  currency,
  sign,
  tone = "auto",
  className,
}: {
  amount: string;
  currency: "ARS" | "USD";
  sign?: boolean;
  tone?: "auto" | "plain" | "positive" | "negative";
  className?: string;
}) {
  const n = Number(amount);
  const resolved =
    tone === "auto" ? (n < 0 ? "negative" : "plain") : tone;

  return (
    <span
      className={cn(
        "money",
        resolved === "negative" && "text-negative",
        resolved === "positive" && "text-positive",
        className,
      )}
    >
      {formatMoney(amount, currency, { sign })}
    </span>
  );
}

/** Varios montos de un mismo concepto, uno por moneda. Un asiento puede tocar
 *  las dos y mostrar una sola partida da un número que no significa nada. */
export function Amounts({
  rows,
  className,
  ...rest
}: {
  rows: { amount: string; currency: "ARS" | "USD" }[];
  className?: string;
  sign?: boolean;
  tone?: "auto" | "plain" | "positive" | "negative";
}) {
  return (
    <span className={cn("flex flex-col items-end", className)}>
      {rows.map((r) => (
        <Amount key={r.currency} {...r} {...rest} />
      ))}
    </span>
  );
}
