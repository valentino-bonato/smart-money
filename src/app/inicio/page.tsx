import Link from "next/link";
import { ArrowLeftRight, PlusCircle } from "lucide-react";
import { db } from "@/db";
import {
  accountBalances,
  netWorth,
  rateForView,
  recentTransactions,
} from "@/db/queries";
import { formatMoney } from "@/lib/money";
import { getCurrentUser } from "@/lib/user";
import { AccountName } from "@/components/account-name";
import { Amount } from "@/components/money";
import { PageShell } from "@/components/page";
import { TransactionList } from "@/components/transaction-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

function todayInBuenosAires(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
}

/**
 * La pantalla de inicio: cuánto hay, dónde está, y qué pasó último.
 *
 * No reemplaza a Cargar ni compite con ella — responde la pregunta previa, la
 * que hoy obliga a abrir cuatro homebankings: cuánta plata hay y en qué cuenta.
 * Por eso la lista de cuentas es un inventario completo y no un resumen: una
 * cuenta en cero se muestra igual (`includeZero`), porque una cuenta que
 * desaparece se lee como una cuenta que no existe.
 *
 * **Las tarjetas van aparte, abajo.** Son pasivos: mezclarlas en la misma
 * grilla que las cuentas de activo hace leer −US$ 220,62 como si fuera saldo
 * disponible. Y su monto va con `tone="plain"`: una tarjeta debe plata por
 * definición, no es una alarma.
 */
export default async function InicioPage() {
  const user = await getCurrentUser();
  const today = todayInBuenosAires();

  const rate = await rateForView(db, { date: today });

  const [balances, worth, recent] = await Promise.all([
    accountBalances(db, { includeZero: true }),
    // El patrimonio es la suma llana de activo + pasivo, sin invertir el signo
    // de nada. Es el único número de la pantalla que convierte monedas, así que
    // dice con qué precio lo hizo.
    netWorth(db, { in: "ARS", rate, from: "USD" }),
    recentTransactions(db, { userId: user.id, limit: 7 }),
  ]);

  const assets = balances.filter((b) => b.type === "asset");
  const liabilities = balances.filter((b) => b.type === "liability");

  return (
    <PageShell>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Patrimonio
          </span>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="money font-heading text-3xl font-semibold tracking-tight lg:text-4xl">
              {formatMoney(worth, "ARS")}
            </span>
            <span className="money text-sm text-muted-foreground">
              al oficial de {formatMoney(rate, "ARS")}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/">
              <PlusCircle aria-hidden />
              Cargar gasto
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/mover">
              <ArrowLeftRight aria-hidden />
              Mover plata
            </Link>
          </Button>
        </div>
      </header>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-heading text-base font-semibold tracking-tight">
            Mis cuentas
          </h2>
          <Link
            href="/conciliacion"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Conciliar →
          </Link>
        </div>

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {assets.map((a) => (
            <li
              key={a.accountId}
              className="flex flex-col gap-2 rounded-xl border p-4"
            >
              <AccountName name={a.name} className="text-sm leading-snug" />
              <Amount
                amount={a.balance}
                currency={a.currency}
                className="font-heading text-xl font-semibold tracking-tight"
              />
            </li>
          ))}
        </ul>

        {liabilities.length ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {liabilities.map((l) => (
              <li
                key={l.accountId}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border bg-muted/40 p-4"
              >
                <AccountName name={l.name} className="text-sm leading-snug" />
                <Amount
                  amount={l.balance}
                  currency={l.currency}
                  tone="plain"
                  className="font-heading text-lg font-semibold tracking-tight"
                />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Últimas actividades</CardTitle>
        </CardHeader>
        <CardContent>
          <TransactionList rows={recent} />
        </CardContent>
      </Card>
    </PageShell>
  );
}
