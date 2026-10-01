import { asc, eq, inArray, isNull, and } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import * as schema from "@/db/schema";
import {
  envelopeBalances,
  payeeSuggestions,
  recentTransactions,
} from "@/db/queries";
import { formatMoney } from "@/lib/money";
import { getCurrentUser } from "@/lib/user";
import { QuickEntry, type EnvelopeOption, type Option } from "./quick-entry";

/** Siempre contra la base: es un solo usuario y los datos cambian al cargar. */
export const dynamic = "force-dynamic";

function todayInBuenosAires(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
}

export default async function Page() {
  const user = await getCurrentUser();

  const [accounts, envelopes, balances, suggestions, recent] =
    await Promise.all([
      db
        .select()
        .from(schema.accounts)
        .where(
          and(
            eq(schema.accounts.userId, user.id),
            isNull(schema.accounts.archivedAt),
            eq(schema.accounts.isSystem, false),
            inArray(schema.accounts.type, ["asset", "liability", "expense"]),
          ),
        )
        .orderBy(asc(schema.accounts.displayOrder)),
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
      envelopeBalances(db, { includeZero: true }),
      payeeSuggestions(db, { userId: user.id }),
      recentTransactions(db, { userId: user.id, limit: 8 }),
    ]);

  const categories: Option[] = accounts
    .filter((a) => a.type === "expense")
    .map((a) => ({ id: a.id, name: a.name, currency: a.currency }));

  const sources: Option[] = accounts
    .filter((a) => a.type === "asset" || a.type === "liability")
    .map((a) => ({ id: a.id, name: a.name, currency: a.currency }));

  // El saldo que se muestra es el de la moneda del sobre con movimiento; si
  // tiene las dos, gana la que tenga saldo distinto de cero más reciente.
  const envelopeOptions: EnvelopeOption[] = envelopes.map((e) => {
    const rows = balances.filter((b) => b.envelopeId === e.id);
    const nonZero = rows.find((b) => Number(b.balance) !== 0) ?? rows[0];
    return {
      id: e.id,
      name: e.name,
      currency: nonZero?.currency ?? "ARS",
      balance: nonZero?.balance ?? "0",
    };
  });

  // Mercado Pago es la caja chica del día a día: el default correcto para un
  // gasto cargado a mano.
  const defaultSource =
    sources.find((s) => s.name === "Mercado Pago") ?? sources[0];

  return (
    <main className="mx-auto w-full max-w-xl px-5 py-8 flex flex-col gap-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Cargar gasto</h1>
        <nav className="flex gap-3 text-sm">
          <Link href="/sobres" className="underline opacity-70">
            Sobres
          </Link>
          <Link href="/plan" className="underline opacity-70">
            Plan
          </Link>
          <Link href="/mover" className="underline opacity-70">
            Mover
          </Link>
          <Link href="/conciliacion" className="underline opacity-70">
            Conciliar
          </Link>
        </nav>
      </header>

      <QuickEntry
        categories={categories}
        envelopes={envelopeOptions}
        sources={sources}
        suggestions={suggestions.map((s) => ({
          payee: s.payee,
          expenseAccountId: s.expenseAccountId,
          envelopeId: s.envelopeId,
          paidFromAccountId: s.paidFromAccountId,
          currency: s.currency,
        }))}
        today={todayInBuenosAires()}
        defaultSourceId={defaultSource?.id ?? ""}
      />

      <section className="flex flex-col gap-2">
        <h2 className="text-xs uppercase tracking-wide opacity-60">
          Últimos movimientos
        </h2>
        {recent.length === 0 ? (
          <p className="text-sm opacity-60">Todavía no hay nada cargado.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
            {recent.map((t) => (
              <li key={t.id} className="flex items-baseline gap-3 py-2 text-sm">
                <span className="w-12 shrink-0 opacity-50 tabular-nums">
                  {t.date.slice(5)}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="truncate block">
                    {t.payee ?? t.description ?? "—"}
                  </span>
                  <span className="text-xs opacity-50">
                    {t.kind === "gasto"
                      ? (t.envelope ?? t.category?.replace(/^Gastos:/, "") ?? "gasto")
                      : t.kind}
                  </span>
                </span>
                {/* Un asiento puede tocar varias monedas: se muestran todas.
                    En un cambio, además, de dónde salió. */}
                <span className="flex flex-col items-end shrink-0 tabular-nums">
                  {t.kind === "cambio" && t.outflows.length ? (
                    <span className="text-xs opacity-50">
                      {t.outflows
                        .map((o) => formatMoney(o.amount, o.currency))
                        .join(" + ")}
                      {" →"}
                    </span>
                  ) : null}
                  {t.inflows.length ? (
                    t.inflows.map((i) => (
                      <span key={i.currency}>
                        {formatMoney(i.amount, i.currency)}
                      </span>
                    ))
                  ) : (
                    <span className="opacity-40">—</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
