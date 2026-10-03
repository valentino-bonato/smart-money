import { asc, eq, isNull, and } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { allocatedInMonth } from "@/db/envelopes";
import {
  envelopeBalances,
  goalProgress,
  nextPlanningPeriod,
  rateForView,
  unassignedPool,
} from "@/db/queries";
import { formatMoney } from "@/lib/money";
import { getCurrentUser } from "@/lib/user";
import { Amount } from "@/components/money";
import { PageHeader, PageShell, TwoColumn } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { MoveForm } from "./move-form";

export const dynamic = "force-dynamic";

function todayInBuenosAires(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
}

function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

export default async function SobresPage() {
  const user = await getCurrentUser();
  const today = todayInBuenosAires();
  const period = monthStart(today);

  const rate = await rateForView(db, { date: today });
  // El aporte sugerido se calcula desde el próximo mes a planificar, no desde
  // el actual: octubre ya está aprobado, y contarlo como pendiente mientras su
  // asignación ya suma al progreso da un aporte más bajo del real.
  const planning = await nextPlanningPeriod(db, { userId: user.id, today });

  const [envelopes, balances, allocated, pool, goals] = await Promise.all([
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
    allocatedInMonth(db, { period }),
    unassignedPool(db),
    goalProgress(db, { rate, period: planning }),
  ]);

  const planningLabel = new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${planning}T00:00:00Z`));

  return (
    <PageShell>
      <PageHeader title="Sobres">
        Cuánta plata tiene cada propósito. El aporte de las metas es el que hace
        falta desde {planningLabel}, con lo ya asignado descontado.
      </PageHeader>

      <TwoColumn
        flip
        main={
          <Card>
            <CardHeader>
              <CardTitle>Saldo por sobre</CardTitle>
              <CardDescription>
                El saldo es Σ asignado − Σ gastado, y arrastra meses anteriores
                en los sobres que acumulan.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {envelopes.map((e) => {
                  const rows = balances.filter((b) => b.envelopeId === e.id);
                  const withMoney = rows.filter(
                    (b) => Number(b.balance) !== 0 || Number(b.spent) !== 0,
                  );
                  const shown = withMoney.length ? withMoney : rows.slice(0, 1);
                  const goal = goals.find((g) => g.envelopeId === e.id);
                  const month = allocated.filter((a) => a.envelopeId === e.id);
                  const negative = shown.some((b) => Number(b.balance) < 0);

                  return (
                    <li key={e.id} className="flex flex-col gap-1.5 py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium">{e.name}</span>
                        <span className="flex shrink-0 flex-col items-end">
                          {shown.map((b) => (
                            <Amount
                              key={b.currency}
                              amount={b.balance}
                              currency={b.currency}
                            />
                          ))}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        {month.length ? (
                          <span className="money">
                            Este mes se le asignó{" "}
                            {month
                              .map((m) => formatMoney(m.total, m.currency))
                              .join(" + ")}
                          </span>
                        ) : null}
                        {shown.some((b) => Number(b.spent) !== 0) ? (
                          <span className="money">
                            Gastado{" "}
                            {shown
                              .filter((b) => Number(b.spent) !== 0)
                              .map((b) => formatMoney(b.spent, b.currency))
                              .join(" + ")}
                          </span>
                        ) : null}
                      </div>

                      {goal ? <GoalBar goal={goal} /> : null}

                      {negative ? (
                        <p className="text-xs text-negative">
                          En negativo — hay que cubrirlo de otro sobre.
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        }
        aside={
          <>
            {/* El pool: lo que todavía no tiene propósito. Era el síntoma exacto
                del problema — 2.706.000 sin destino al abrir. */}
            <Card>
              <CardHeader>
                <CardTitle>Sin asignar</CardTitle>
                <CardDescription>
                  Plata que todavía no tiene propósito. No resta los resúmenes
                  de tarjeta pendientes: la fórmula mira solo las cuentas de
                  activo.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-x-8 gap-y-2">
                {pool.map((p) => (
                  <span key={p.currency} className="flex flex-col">
                    <span className="text-xs text-muted-foreground">
                      {p.currency}
                    </span>
                    <Amount
                      amount={p.pool}
                      currency={p.currency}
                      className="font-heading text-2xl font-medium"
                    />
                  </span>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Mover plata de propósito</CardTitle>
                <CardDescription>
                  Esto no mueve plata de ninguna cuenta: cambia para qué es.
                  Mover entre sobres son dos filas; devolver al pool, una
                  negativa.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MoveForm
                  envelopes={envelopes.map((e) => ({ id: e.id, name: e.name }))}
                  today={today}
                />
              </CardContent>
            </Card>
          </>
        }
      />
    </PageShell>
  );
}

function GoalBar({
  goal,
}: {
  goal: Awaited<ReturnType<typeof goalProgress>>[number];
}) {
  const target = Number(goal.targetAmount);
  const progress = Number(goal.progress);
  const pct =
    target > 0 ? Math.min(100, Math.max(0, (progress / target) * 100)) : 0;

  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <Progress value={pct} className="h-1.5" />

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="money">
          {formatMoney(goal.progress, goal.targetCurrency)} de{" "}
          {formatMoney(goal.targetAmount, goal.targetCurrency)} · falta{" "}
          {formatMoney(goal.remaining, goal.targetCurrency)}
        </span>
        {goal.monthsRemaining !== null ? (
          <Badge variant="outline" className="money">
            {goal.monthsRemaining}{" "}
            {goal.monthsRemaining === 1 ? "mes" : "meses"} ·{" "}
            {formatMoney(goal.suggestedContribution, goal.targetCurrency)}/mes
          </Badge>
        ) : (
          <Badge variant="ghost">sin fecha</Badge>
        )}
        {/* La fecha dura no es un adorno: es lo que hace que el nivel variable
            tenga que completar el faltante del piso. */}
        {goal.deadlineHard ? <Badge variant="secondary">fecha dura</Badge> : null}
      </div>

      {/* El progreso de una meta NO es el saldo del sobre: gastar en la meta
          misma es la meta cumpliéndose, no plata que haya que volver a juntar. */}
      {Number(goal.spent) !== 0 ? (
        <p className="money text-xs text-muted-foreground">
          Ya gastado de la meta: {formatMoney(goal.spent, goal.targetCurrency)} ·
          disponible {formatMoney(goal.available, goal.targetCurrency)}
        </p>
      ) : null}
    </div>
  );
}
