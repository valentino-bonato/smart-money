import { db } from "@/db";
import {
  missingEntries,
  reconcilableAccounts,
  reconciliationHistory,
} from "@/db/reconcile";
import { getCurrentUser } from "@/lib/user";
import { AccountName } from "@/components/account-name";
import { Amount } from "@/components/money";
import { PageHeader, PageShell, TwoColumn } from "@/components/page";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { adjustAction, ignoreAction } from "./actions";
import { ReconcileForm } from "./reconcile-form";

export const dynamic = "force-dynamic";

function todayInBuenosAires(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
}

export default async function ConciliacionPage() {
  const user = await getCurrentUser();
  const today = todayInBuenosAires();
  const period = `${today.slice(0, 7)}-01`;

  const [accounts, missing, history] = await Promise.all([
    reconcilableAccounts(db, { userId: user.id }),
    missingEntries(db, { userId: user.id, period, today }),
    reconciliationHistory(db, { userId: user.id, limit: 12 }),
  ]);

  const unresolved = history.filter((h) => !h.resolved);

  return (
    <PageShell>
      <PageHeader title="Conciliación">
        Pegá los saldos del homebanking y la app dice la diferencia. Si cierran
        al peso, el historial está completo y el planner puede confiar en él.
      </PageHeader>

      <TwoColumn
        main={
          <Card>
            <CardHeader>
              <CardTitle>Saldos del homebanking</CardTitle>
              <CardDescription>
                La diferencia es el saldo del banco menos el de la app, y la
                resta se hace en la base. Positiva: falta cargar un ingreso.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ReconcileForm
                accounts={accounts.map((a) => ({
                  accountId: a.accountId,
                  name: a.name,
                  currency: a.currency,
                  computedBalance: a.computedBalance,
                  lastReconciledAt: a.lastReconciledAt,
                }))}
                today={today}
              />
            </CardContent>
          </Card>
        }
        aside={
          <>
            {/* La segunda mitad, que es la que vale: qué es lo más probable que
                falte. No adivina gastos sueltos — apunta a lo que la app ya
                sabe que tiene que pasar y todavía no vio. */}
            <Card>
              <CardHeader>
                <CardTitle>Probablemente falte cargar esto</CardTitle>
                <CardDescription>
                  Gastos fijos del mes sin cargo generado, y cobros esperados
                  cuya fecha ya pasó.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {missing.length ? (
                  <>
                    <ul className="divide-y">
                      {missing.map((m, i) => (
                        <li
                          key={`${m.kind}-${i}`}
                          className="flex items-baseline justify-between gap-3 py-2 text-sm"
                        >
                          <span>
                            {m.name}
                            <span className="block text-xs text-muted-foreground">
                              {m.kind === "recurring"
                                ? `gasto fijo del mes, desde ${m.accountName}`
                                : `cobro esperado${m.expectedDate ? ` al ${m.expectedDate}` : ""}`}
                            </span>
                          </span>
                          <Amount
                            amount={m.amount}
                            currency={m.currency}
                            className="shrink-0"
                          />
                        </li>
                      ))}
                    </ul>
                    <p className="pt-2 text-xs text-muted-foreground">
                      Los gastos fijos se cargan desde el plan del mes; los
                      cobros, desde la pantalla de carga.
                    </p>
                  </>
                ) : (
                  <Empty className="py-4">
                    <EmptyTitle>Nada pendiente</EmptyTitle>
                    <EmptyDescription>
                      No hay gastos fijos ni cobros esperados sin cargar este
                      mes.
                    </EmptyDescription>
                  </Empty>
                )}
              </CardContent>
            </Card>

            {unresolved.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>Diferencias sin resolver</CardTitle>
                  <CardDescription>
                    <strong className="font-medium">Ajustar</strong> deja la
                    cuenta en el saldo del homebanking con un asiento contra
                    equity — para lo que no se arregla cargando un movimiento,
                    como la revalorización de los CEDEARs o una comisión.{" "}
                    <strong className="font-medium">Ignorar</strong> no toca
                    nada: es para cuando ya sabés qué falta y lo vas a cargar.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="divide-y">
                    {unresolved.map((h) => (
                      <li
                        key={h.id}
                        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm"
                      >
                        <AccountName name={h.account}>
                          <span className="money text-muted-foreground">
                            {" · "}
                            {h.date}
                          </span>
                        </AccountName>
                        <span className="flex shrink-0 items-center gap-2">
                          <Amount
                            amount={h.difference}
                            currency={h.currency}
                            sign
                            tone="negative"
                          />
                          <form action={adjustAction}>
                            <input type="hidden" name="id" value={h.id} />
                            <input
                              type="hidden"
                              name="accountId"
                              value={h.accountId}
                            />
                            <input
                              type="hidden"
                              name="toBalance"
                              value={h.statementBalance}
                            />
                            <input type="hidden" name="date" value={h.date} />
                            <Button type="submit" variant="outline" size="xs">
                              Ajustar
                            </Button>
                          </form>
                          <form action={ignoreAction}>
                            <input type="hidden" name="id" value={h.id} />
                            <Button type="submit" variant="ghost" size="xs">
                              Ignorar
                            </Button>
                          </form>
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}

            {history.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>Historial</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="divide-y">
                    {history.map((h) => (
                      <li
                        key={h.id}
                        className="flex items-baseline justify-between gap-3 py-2 text-sm text-muted-foreground"
                      >
                        <AccountName name={h.account}>
                          <span className="money">{` · ${h.date}`}</span>
                        </AccountName>
                        {Number(h.difference) === 0 ? (
                          <span className="shrink-0 text-positive">
                            coincide
                          </span>
                        ) : (
                          <Amount
                            amount={h.difference}
                            currency={h.currency}
                            sign
                            tone="plain"
                            className="shrink-0"
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}
          </>
        }
      />
    </PageShell>
  );
}
