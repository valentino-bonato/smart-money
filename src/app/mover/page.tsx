import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { accountBalances, rateForView, recentTransactions } from "@/db/queries";
import { formatMoney } from "@/lib/money";
import { getCurrentUser } from "@/lib/user";
import { MoveMoneyForm } from "./move-money-form";

export const dynamic = "force-dynamic";

function todayInBuenosAires(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
}

export default async function MoverPage() {
  const user = await getCurrentUser();
  const today = todayInBuenosAires();

  const [accounts, balances, envelopes, rate, recent] = await Promise.all([
    db
      .select()
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.userId, user.id),
          isNull(schema.accounts.archivedAt),
          eq(schema.accounts.isSystem, false),
          inArray(schema.accounts.type, ["asset", "liability"]),
        ),
      )
      .orderBy(asc(schema.accounts.displayOrder)),
    accountBalances(db),
    db
      .select()
      .from(schema.envelopes)
      .where(
        and(
          eq(schema.envelopes.userId, user.id),
          isNull(schema.envelopes.archivedAt),
        ),
      )
      .orderBy(asc(schema.envelopes.displayOrder)),
    rateForView(db, { date: today }),
    recentTransactions(db, { userId: user.id, limit: 20 }),
  ]);

  const options = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    currency: a.currency,
    type: a.type as "asset" | "liability",
    balance:
      balances.find((b) => b.accountId === a.id)?.balance ?? "0",
  }));

  const moves = recent.filter((r) => r.kind !== "gasto" && r.kind !== "apertura");

  return (
    <main className="mx-auto w-full max-w-xl px-5 py-8 flex flex-col gap-8">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold">Mover plata</h1>
        <nav className="flex gap-3 text-sm">
          <Link href="/" className="underline opacity-70">
            Cargar
          </Link>
          <Link href="/sobres" className="underline opacity-70">
            Sobres
          </Link>
          <Link href="/plan" className="underline opacity-70">
            Plan
          </Link>
          <Link href="/conciliacion" className="underline opacity-70">
            Conciliar
          </Link>
        </nav>
      </header>

      <p className="text-sm opacity-70">
        Pasar plata a Mercado Pago, pagar el resumen de la tarjeta y comprar
        dólares. Los tres son lo mismo por dentro y <strong>ninguno es un
        gasto</strong>: son justo los casos donde se rompe una app de lista de
        movimientos.
      </p>

      <MoveMoneyForm
        accounts={options}
        envelopes={envelopes.map((e) => ({ id: e.id, name: e.name }))}
        today={today}
        rate={rate}
      />

      {moves.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs uppercase tracking-wide opacity-60">
            Últimos movimientos que no son gastos
          </h2>
          <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
            {moves.map((t) => (
              <li
                key={t.id}
                className="flex items-baseline gap-3 py-2 text-sm"
              >
                <span className="w-12 shrink-0 opacity-50 tabular-nums">
                  {t.date.slice(5)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="truncate block">
                    {t.description ?? t.payee ?? "—"}
                  </span>
                  <span className="text-xs opacity-50">{t.kind}</span>
                </span>
                <span className="flex flex-col items-end shrink-0 tabular-nums">
                  {t.kind === "cambio" && t.outflows.length ? (
                    <span className="text-xs opacity-50">
                      {t.outflows
                        .map((o) => formatMoney(o.amount, o.currency))
                        .join(" + ")}
                      {" →"}
                    </span>
                  ) : null}
                  {t.inflows.map((i) => (
                    <span key={i.currency}>
                      {formatMoney(i.amount, i.currency)}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
