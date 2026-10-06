import { asc, eq, isNull, and } from "drizzle-orm";
import { AlertTriangle } from "lucide-react";
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
import { cn } from "cn";
import { Amount } from "@/components/money";
import { PageHeader, PageShell, TwoColumn } from "@/components/page";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

type Envelope = typeof schema.envelopes.$inferSelect;

/**
 * El rol de cada sobre en la cascada, deducido de sus propias columnas.
 *
 * **No hay tabla de orden.** El planner ya deduce el rol así, y una
 * configuración paralela se desincronizaría: un sobre que la pantalla muestra
 * en el piso y el planner trata como meta es exactamente el tipo de mentira
 * que `queries.ts` existe para evitar.
 */
function roleOf(e: Envelope): "piso" | "meta" | "resto" {
  if (e.contributionRule === "fixed") return "piso";
  if (e.targetAmount) return "meta";
  return "resto";
}

const GROUPS = [
  {
    role: "piso" as const,
    title: "Obligaciones del piso",
    hint: "se cubren primero, en orden",
  },
  {
    role: "meta" as const,
    title: "Metas",
    hint: "el progreso es Σ asignado, no el saldo: gastar en la meta es la meta cumpliéndose",
  },
  {
    role: "resto" as const,
    title: "El resto",
    hint: "lo que se lleva lo que sobra, y lo que no entra en la cascada",
  },
];

/**
 * Cuánta plata tiene cada propósito.
 *
 * Se llama "Presupuestos" y el archivo sigue en `/sobres`: el nombre de la
 * ruta no se tocó para no partir en dos una pantalla que ya estaba en uso.
 *
 * **La lista va agrupada por rol en la cascada, no plana.** En una lista
 * corrida el Viaje y "Puntuales del mes" pesan igual, y la cascada dice que no
 * lo son: uno es una meta con fecha dura y el otro no entra en el reparto.
 */
export default async function PresupuestosPage() {
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

  const negativePool = pool.find((p) => Number(p.pool) < 0);

  return (
    <PageShell>
      <PageHeader title="Presupuestos">
        Cuánta plata tiene cada propósito. El aporte de las metas es el que hace
        falta desde {planningLabel}, con lo ya asignado descontado.
      </PageHeader>

      <TwoColumn
        flip
        main={
          <div className="flex flex-col gap-6">
            {GROUPS.map((g) => {
              const list = envelopes.filter((e) => roleOf(e) === g.role);
              if (!list.length) return null;

              return (
                <section key={g.role} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <h2 className="text-xs font-semibold tracking-wide uppercase">
                      {g.title}
                    </h2>
                    <p className="text-xs text-muted-foreground">{g.hint}</p>
                  </div>

                  <ul className="divide-y rounded-xl border">
                    {list.map((e) => {
                      const rows = balances.filter(
                        (b) => b.envelopeId === e.id,
                      );
                      const withMoney = rows.filter(
                        (b) =>
                          Number(b.balance) !== 0 || Number(b.spent) !== 0,
                      );
                      const shown = withMoney.length
                        ? withMoney
                        : rows.slice(0, 1);
                      const goal = goals.find((x) => x.envelopeId === e.id);
                      const month = allocated.filter(
                        (a) => a.envelopeId === e.id,
                      );
                      const negative = shown.some(
                        (b) => Number(b.balance) < 0,
                      );
                      const neverFunded =
                        rows.every((b) => Number(b.allocated) === 0) &&
                        shown.some((b) => Number(b.spent) !== 0);

                      return (
                        <li
                          key={e.id}
                          className={cn(
                            "flex flex-col gap-2 p-4",
                            // El sobre en rojo se marca con el borde izquierdo
                            // además del monto: en una lista de doce, un número
                            // rojo solo se pasa por alto.
                            negative && "border-l-2 border-l-negative",
                          )}
                        >
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

                          <div className="flex flex-wrap items-center gap-1.5">
                            {e.contributionRule === "fixed" &&
                            e.contributionAmount &&
                            e.contributionCurrency ? (
                              <Chip>
                                {formatMoney(
                                  e.contributionAmount,
                                  e.contributionCurrency,
                                )}
                                /mes
                              </Chip>
                            ) : null}
                            {e.contributionRule === "remainder" ? (
                              <Chip>se lleva el resto</Chip>
                            ) : null}
                            {e.contributionRule === null && !e.targetAmount ? (
                              <Chip>no entra en la cascada</Chip>
                            ) : null}
                            <Chip>
                              {e.rollover === "accumulate"
                                ? "acumula"
                                : "resetea"}
                            </Chip>
                            {negative ? <Chip tone="negative">en negativo</Chip> : null}
                            {neverFunded ? (
                              <Chip tone="negative">nunca recibió plata</Chip>
                            ) : null}

                            <span className="ml-auto text-xs text-muted-foreground">
                              {shown.some((b) => Number(b.spent) !== 0) ? (
                                <span className="money">
                                  gastó{" "}
                                  {shown
                                    .filter((b) => Number(b.spent) !== 0)
                                    .map((b) =>
                                      formatMoney(b.spent, b.currency),
                                    )
                                    .join(" + ")}
                                </span>
                              ) : (
                                "sin gastar"
                              )}
                            </span>
                          </div>

                          {month.length ? (
                            <p className="money text-xs text-muted-foreground">
                              Este mes se le asignó{" "}
                              {month
                                .map((m) => formatMoney(m.total, m.currency))
                                .join(" + ")}
                            </p>
                          ) : null}

                          {goal ? <GoalBar goal={goal} /> : null}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
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
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-x-8 gap-y-2">
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
                </div>

                {/* Un pool negativo no es un error de la pantalla y conviene
                    decirlo: los sobres prometen más de lo que hay en las
                    cuentas, que es lo que pasa cuando varios quedan en rojo. */}
                {negativePool ? (
                  <p className="flex gap-2 rounded-lg border border-negative/30 bg-negative/5 p-3 text-xs text-negative">
                    <AlertTriangle className="size-4 shrink-0" aria-hidden />
                    <span className="money">
                      En {negativePool.currency} los sobres prometen{" "}
                      {formatMoney(
                        String(Math.abs(Number(negativePool.pool))),
                        negativePool.currency,
                      )}{" "}
                      más de lo que hay en las cuentas. Cubrir los sobres en
                      rojo desde otro sobre lo cierra.
                    </span>
                  </p>
                ) : null}
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

/** "2027-06-01" → "jun 2027". El día no agrega nada en una meta a años. */
function shortDate(date: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function Chip({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "negative";
}) {
  return (
    <span
      className={cn(
        "money rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "negative"
          ? "bg-negative/10 text-negative"
          : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
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
    <div className="flex flex-col gap-2 pt-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="money text-sm">
          {formatMoney(goal.progress, goal.targetCurrency)}{" "}
          <span className="text-muted-foreground">
            de {formatMoney(goal.targetAmount, goal.targetCurrency)}
          </span>
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* La fecha dura no es un adorno: es lo que hace que el nivel variable
              tenga que completar el faltante del piso. */}
          {goal.deadlineHard && goal.targetDate ? (
            <Chip>fecha dura · {shortDate(goal.targetDate)}</Chip>
          ) : goal.targetDate ? (
            <Chip>{shortDate(goal.targetDate)}</Chip>
          ) : (
            <Chip>sin fecha</Chip>
          )}
          {goal.monthsRemaining !== null ? (
            <Chip>
              {goal.monthsRemaining}{" "}
              {goal.monthsRemaining === 1 ? "mes" : "meses"}
            </Chip>
          ) : null}
        </div>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${Math.round(pct)}% de la meta`}
      >
        <div
          className="h-full rounded-full bg-foreground"
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="money text-xs text-muted-foreground">
        falta{" "}
        <strong className="font-medium text-foreground">
          {formatMoney(goal.remaining, goal.targetCurrency)}
        </strong>{" "}
        · aporte{" "}
        <strong className="font-medium text-foreground">
          {formatMoney(goal.suggestedContribution, goal.targetCurrency)}/mes
        </strong>
        {/* El progreso de una meta NO es el saldo del sobre: gastar en la meta
            misma es la meta cumpliéndose, no plata que haya que volver a
            juntar. */}
        {Number(goal.spent) !== 0 ? (
          <>
            {" · ya gastado "}
            {formatMoney(goal.spent, goal.targetCurrency)} · disponible{" "}
            {formatMoney(goal.available, goal.targetCurrency)}
          </>
        ) : null}
      </p>
    </div>
  );
}
