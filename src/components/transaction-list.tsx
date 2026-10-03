import {
  ArrowLeftRight,
  Banknote,
  CreditCard,
  Flag,
  Repeat,
  ShoppingCart,
} from "lucide-react";
import { Amount } from "@/components/money";
import { DeleteButton } from "@/app/delete-button";

type Row = {
  id: string;
  date: string;
  payee: string | null;
  description: string | null;
  kind: string;
  envelope?: string | null;
  category?: string | null;
  inflows: { amount: string; currency: "ARS" | "USD" }[];
  outflows: { amount: string; currency: "ARS" | "USD" }[];
};

/**
 * La lista de últimos movimientos, compartida entre Cargar y Mover.
 *
 * **Un asiento no tiene "un monto".** Tiene partidas, y pueden ser muchas y en
 * varias monedas: el saldo de apertura son siete. Por eso se muestran todos los
 * ingresos, y en un cambio además de dónde salió. Mostrar una partida suelta
 * —la más grande, pongamos— da un número que no significa nada.
 *
 * El ícono es por tipo de movimiento y no decoración: en una lista mezclada, un
 * pago de resumen y un gasto se leen igual si solo se mira el texto.
 */
const ICONS: Record<string, typeof ShoppingCart> = {
  gasto: ShoppingCart,
  ingreso: Banknote,
  transferencia: ArrowLeftRight,
  pago: CreditCard,
  cambio: Repeat,
  apertura: Flag,
};

export function TransactionList({
  rows,
  showKindLabel = true,
}: {
  rows: Row[];
  showKindLabel?: boolean;
}) {
  return (
    <ul className="divide-y">
      {rows.map((t) => {
        const Icon = ICONS[t.kind] ?? ShoppingCart;
        const subtitle =
          t.kind === "gasto"
            ? (t.envelope ?? t.category?.replace(/^Gastos:/, "") ?? "gasto")
            : t.kind;

        return (
          <li key={t.id} className="flex items-center gap-3 py-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Icon className="size-4" aria-hidden />
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">
                {t.payee ?? t.description ?? "—"}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                <span className="money">{t.date.slice(5)}</span>
                {showKindLabel ? ` · ${subtitle}` : ""}
              </span>
            </span>

            <span className="flex shrink-0 flex-col items-end text-sm">
              {t.kind === "cambio" && t.outflows.length ? (
                <span className="money text-xs text-muted-foreground">
                  {t.outflows
                    .map((o) => `${o.currency === "USD" ? "US$" : "$"} ${Number(o.amount).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`)
                    .join(" + ")}
                  {" →"}
                </span>
              ) : null}
              {t.inflows.length ? (
                t.inflows.map((i) => (
                  <Amount key={i.currency} {...i} tone="plain" />
                ))
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </span>

            {/* La apertura no se borra: es el punto de partida del libro. */}
            {t.kind !== "apertura" ? <DeleteButton id={t.id} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
