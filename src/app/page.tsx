import { asc, eq, inArray, isNull, and } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import {
  envelopeBalances,
  payeeSuggestions,
  recentTransactions,
} from "@/db/queries";
import { getCurrentUser } from "@/lib/user";
import { PageHeader, PageShell, TwoColumn } from "@/components/page";
import { TransactionList } from "@/components/transaction-list";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
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
    <PageShell>
      <PageHeader title="Cargar gasto">
        Si esto pasa de diez segundos, la app se abandona en tres semanas. El
        comercio sugiere categoría, sobre y cuenta; lo único que no se puede
        adivinar es el monto.
      </PageHeader>

      <TwoColumn
        main={
          <Card>
            <CardContent>
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
            </CardContent>
          </Card>
        }
        aside={
          <Card>
            <CardHeader>
              <CardTitle>Últimos movimientos</CardTitle>
              <CardDescription>
                Todo lo que entró al libro, no solo los gastos.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {recent.length === 0 ? (
                <Empty className="py-6">
                  <EmptyTitle>Todavía no hay nada cargado</EmptyTitle>
                  <EmptyDescription>
                    El primer gasto que cargues aparece acá.
                  </EmptyDescription>
                </Empty>
              ) : (
                <TransactionList rows={recent} />
              )}
            </CardContent>
          </Card>
        }
      />
    </PageShell>
  );
}
