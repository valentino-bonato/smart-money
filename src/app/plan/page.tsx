import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { computePlan, loadPlan } from "@/db/planner";
import { nextPlanningPeriod, rateForView } from "@/db/queries";
import { formatMoney } from "@/lib/money";
import { getCurrentUser } from "@/lib/user";
import { AccountName } from "@/components/account-name";
import { Amount } from "@/components/money";
import { PageHeader, PageShell, TwoColumn } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { ApproveForm } from "./plan-actions";

export const dynamic = "force-dynamic";

function todayInBuenosAires(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
}

const TIERS = [
  { tier: "base" as const, title: "Nivel 1 · piso", source: "el sueldo" },
  {
    tier: "recurring_variable" as const,
    title: "Nivel 2 y 3 · variable y hitos",
    source: "la consultoría y los desarrollos",
  },
];

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await getCurrentUser();
  const today = todayInBuenosAires();
  const params = await searchParams;

  // Por default se planifica el mes en curso; si ya está aprobado, el próximo.
  const auto = await nextPlanningPeriod(db, { userId: user.id, today });
  const period = /^\d{4}-\d{2}-01$/.test(params.period ?? "")
    ? params.period!
    : auto;

  const rate = await rateForView(db, { date: period });
  const [computed, saved, adHoc] = await Promise.all([
    computePlan(db, { userId: user.id, period, rate }),
    loadPlan(db, { userId: user.id, period }),
    db
      .select()
      .from(schema.envelopes)
      .where(
        and(
          eq(schema.envelopes.userId, user.id),
          isNull(schema.envelopes.archivedAt),
          isNull(schema.envelopes.contributionRule),
        ),
      )
      .orderBy(asc(schema.envelopes.displayOrder)),
  ]);

  const monthLabel = new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${period}T00:00:00Z`));

  const approved = saved?.plan.status === "approved";
  const payments = computed.lines.filter((l) => l.accountId);

  return (
    <PageShell>
      <PageHeader
        title={`Plan de ${monthLabel}`}
        action={
          approved ? (
            <Badge variant="secondary">aprobado</Badge>
          ) : (
            <Badge variant="outline">propuesta</Badge>
          )
        }
      >
        {approved
          ? "Este mes ya está aprobado. Lo de abajo es lo que la cascada propone hoy; recalcular lo pisa."
          : "Lo que la cascada propone con lo que entró. Nada se asigna hasta que aprobás."}{" "}
        Dólar <span className="money">{formatMoney(rate, "ARS")}</span>.
      </PageHeader>

      <TwoColumn
        main={
          <>
            {TIERS.map(({ tier, title, source }) => {
              const lines = computed.lines.filter((l) => l.tier === tier);
              const available = computed.available[tier];
              const leftover = computed.leftover[tier];
              const isApplied = computed.applied[tier];

              return (
                <Card key={tier}>
                  <CardHeader>
                    <CardTitle>{title}</CardTitle>
                    <CardDescription>
                      {isApplied
                        ? "Ya aprobado: esta plata tiene destino y no vuelve a aparecer en las transferencias."
                        : `Lo que entró de ${source}.`}
                    </CardDescription>
                    <CardAction className="text-right">
                      {isApplied ? (
                        <Badge variant="secondary">ya aplicado</Badge>
                      ) : (
                        <>
                          <Amount
                            amount={available}
                            currency="ARS"
                            className="block font-medium"
                          />
                          {/* El piso es la única excepción que acepta un
                              esperado: el sueldo es fijo y cae el día 1. */}
                          <span className="text-xs text-muted-foreground">
                            {computed.availableSource[tier] === "expected"
                              ? "esperado"
                              : "cobrado"}
                          </span>
                        </>
                      )}
                    </CardAction>
                  </CardHeader>
                  <CardContent>
                    {lines.length === 0 ? (
                      <Empty className="py-4">
                        <EmptyTitle>Nada que asignar</EmptyTitle>
                        <EmptyDescription>
                          Todavía no entró nada de {source}.
                        </EmptyDescription>
                      </Empty>
                    ) : (
                      <ul className="divide-y">
                        {lines.map((l) => (
                          <li
                            key={l.sequence}
                            className={`flex flex-col py-2 ${
                              l.alreadyApplied ? "opacity-45" : ""
                            }`}
                          >
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="text-sm">
                                {l.envelopeName ?? (
                                  <AccountName name={l.accountName ?? ""}>
                                    <span className="text-muted-foreground">
                                      {" · pago"}
                                    </span>
                                  </AccountName>
                                )}
                              </span>
                              <Amount
                                amount={l.amount}
                                currency={l.currency}
                                className="shrink-0 text-sm"
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {l.ruleApplied}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {Number(leftover) > 0 ? (
                      <p className="money pt-2 text-xs text-muted-foreground">
                        Queda sin asignar {formatMoney(leftover, "ARS")}.
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </>
        }
        aside={
          <>
            {/* El criterio de éxito de la pantalla: la lista de transferencias
                concretas. Sin esto el plan obliga a sentarse a calcular. */}
            <Card>
              <CardHeader>
                <CardTitle>Transferencias pendientes</CardTitle>
                <CardDescription>
                  Lo que hay que hacer en el homebanking. La suma es igual al
                  total de lo pendiente: todo peso asignado tiene un destino.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {payments.length === 0 && computed.transfers.length === 0 ? (
                  <Empty className="py-4">
                    <EmptyTitle>Nada pendiente</EmptyTitle>
                    <EmptyDescription>
                      Lo que el plan asignó ya tiene destino y no hay resúmenes
                      por pagar.
                    </EmptyDescription>
                  </Empty>
                ) : (
                  <ul className="divide-y">
                    {payments.map((l) => (
                      <li
                        key={`pay-${l.sequence}`}
                        className="flex items-baseline justify-between gap-3 py-2 text-sm"
                      >
                        <span className="inline-flex items-baseline gap-1">
                          Pagar <AccountName name={l.accountName ?? ""} />
                        </span>
                        <Amount
                          amount={l.amount}
                          currency={l.currency}
                          className="shrink-0"
                        />
                      </li>
                    ))}
                    {computed.transfers.map((t) => (
                      <li
                        key={t.accountId}
                        className="flex items-baseline justify-between gap-3 py-2 text-sm"
                      >
                        <AccountName name={t.accountName}>
                          {/* Mandar pesos a CEDEARs es comprar dólares: el
                              trigger rechaza la transferencia directa. */}
                          {t.needsExchange ? (
                            <Badge variant="outline" className="ml-2">
                              comprar {t.destinationCurrency}
                            </Badge>
                          ) : null}
                        </AccountName>
                        <Amount
                          amount={t.amount}
                          currency={t.currency}
                          className="shrink-0"
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {computed.expected.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>Cobros esperados</CardTitle>
                  <CardDescription>
                    Se muestran y no se asignan hasta que entran.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="divide-y">
                    {computed.expected.map((e) => (
                      <li
                        key={e.id}
                        className="flex items-baseline justify-between gap-3 py-2 text-sm"
                      >
                        <span>
                          {e.source}
                          <span className="text-muted-foreground">
                            {" · "}
                            {e.expectedDate ?? "sin fecha"}
                          </span>
                        </span>
                        <Amount
                          amount={e.amount}
                          currency={e.currency}
                          className="shrink-0"
                        />
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>{approved ? "Ya aprobado" : "Aprobar"}</CardTitle>
                <CardDescription>
                  Aprobar materializa las asignaciones de los niveles cuyo cobro
                  ya entró. No paga nada: las transferencias se hacen a mano.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ApproveForm
                  period={period}
                  envelopes={adHoc.map((e) => ({ id: e.id, name: e.name }))}
                  approved={approved}
                  planId={saved?.plan.id ?? null}
                />
              </CardContent>
            </Card>
          </>
        }
      />
    </PageShell>
  );
}
