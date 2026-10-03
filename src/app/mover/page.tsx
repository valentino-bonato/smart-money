import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { accountBalances, rateForView, recentTransactions } from "@/db/queries";
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
    <PageShell>
      <PageHeader title="Mover plata">
        Pasar plata a Mercado Pago, pagar el resumen de la tarjeta y comprar
        dólares. Los tres son lo mismo por dentro y{" "}
        <strong className="font-medium text-foreground">
          ninguno es un gasto
        </strong>
        : son justo los casos donde se rompe una app de lista de movimientos.
      </PageHeader>

      <TwoColumn
        main={
          <Card>
            <CardContent>
              <MoveMoneyForm
                accounts={options}
                envelopes={envelopes.map((e) => ({ id: e.id, name: e.name }))}
                today={today}
                rate={rate}
              />
            </CardContent>
          </Card>
        }
        aside={
          <Card>
            <CardHeader>
              <CardTitle>Movimientos que no son gastos</CardTitle>
              <CardDescription>
                Transferencias, pagos de resumen y cambios de moneda.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {moves.length ? (
                <TransactionList rows={moves} />
              ) : (
                <Empty className="py-6">
                  <EmptyTitle>Nada todavía</EmptyTitle>
                  <EmptyDescription>
                    Acá van las transferencias, los pagos de resumen y las
                    compras de dólares.
                  </EmptyDescription>
                </Empty>
              )}
            </CardContent>
          </Card>
        }
      />
    </PageShell>
  );
}
