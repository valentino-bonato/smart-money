import {
  ArrowLeftRight,
  Banknote,
  CreditCard,
  Flag,
  Repeat,
  ShoppingCart,
} from "lucide-react";
import { AccountDot } from "@/components/account-name";
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
  source?: string | null;
  destination?: string | null;
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

        // De dónde salió la plata. En un gasto alcanza con el origen; en lo que
        // mueve plata entre cuentas propias importan las dos puntas; en un
        // ingreso solo importa dónde cayó, porque del otro lado hay una cuenta
        // de ingreso y no una cuenta de verdad.
        //
        // En una apertura o un ajuste no se muestra ninguna: la contrapartida es
        // técnica, y además el título del ajuste ya nombra la cuenta.
        const movesBetweenAccounts =
          t.kind === "transferencia" || t.kind === "pago" || t.kind === "cambio";
        const silent = t.kind === "apertura" || t.kind === "ajuste";
        const from = silent ? null : t.source;
        const to = silent
          ? null
          : movesBetweenAccounts || t.kind === "ingreso"
            ? t.destination
            : null;

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
                {from || to ? (
                  <>
                    {" · "}
                    {from ? (
                      <>
                        <AccountDot
                          name={from}
                          className="inline-block size-2"
                        />{" "}
                        {from}
                      </>
                    ) : null}
                    {to ? (
                      <>
                        {from ? " → " : "→ "}
                        <AccountDot name={to} className="inline-block size-2" />{" "}
                        {to}
                      </>
                    ) : null}
                  </>
                ) : null}
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
