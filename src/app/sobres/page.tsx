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

  return (
    <main className="mx-auto w-full max-w-xl lg:max-w-6xl px-5 py-8 flex flex-col gap-8">
      <h1 className="text-xl font-semibold">Sobres</h1>

      <div className="grid lg:grid-cols-2 lg:gap-12 gap-8 lg:items-start">
      <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h2 className="text-xs uppercase tracking-wide opacity-60">
          Saldo por sobre
        </h2>
        <p className="text-xs opacity-50">
          El aporte de las metas es el que hace falta desde{" "}
          {new Intl.DateTimeFormat("es-AR", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          }).format(new Date(`${planning}T00:00:00Z`))}
          , con lo ya asignado descontado.
        </p>
        <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
          {envelopes.map((e) => {
            const rows = balances.filter((b) => b.envelopeId === e.id);
            const withMoney = rows.filter(
              (b) => Number(b.balance) !== 0 || Number(b.spent) !== 0,
            );
            const shown = withMoney.length ? withMoney : rows.slice(0, 1);
            const goal = goals.find((g) => g.envelopeId === e.id);
            const month = allocated.filter((a) => a.envelopeId === e.id);

            return (
              <li key={e.id} className="py-3 flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{e.name}</span>
                  <span className="flex flex-col items-end">
                    {shown.map((b) => (
                      <span
                        key={b.currency}
                        className={`tabular-nums ${
                          Number(b.balance) < 0
                            ? "text-red-600 dark:text-red-400"
                            : ""
                        }`}
                      >
                        {formatMoney(b.balance, b.currency)}
                      </span>
                    ))}
                  </span>
                </div>

                {month.length ? (
                  <p className="text-xs opacity-55">
                    Este mes se le asignó{" "}
                    {month
                      .map((m) => formatMoney(m.total, m.currency))
                      .join(" + ")}
                  </p>
                ) : null}

                {shown.some((b) => Number(b.spent) !== 0) ? (
                  <p className="text-xs opacity-55">
                    Gastado{" "}
                    {shown
                      .filter((b) => Number(b.spent) !== 0)
                      .map((b) => formatMoney(b.spent, b.currency))
                      .join(" + ")}
                  </p>
                ) : null}

                {goal ? <GoalBar goal={goal} /> : null}

                {shown.some((b) => Number(b.balance) < 0) ? (
                  <p className="text-xs text-red-600 dark:text-red-400">
                    En negativo — hay que cubrirlo de otro sobre.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>


      </div>
      <div className="flex flex-col gap-8 lg:order-first">
      {/* El pool: lo que todavía no tiene propósito. Era el síntoma exacto del
          problema — 2.706.000 sin destino al abrir. */}
      <section className="flex flex-col gap-1">
        <h2 className="text-xs uppercase tracking-wide opacity-60">
          Sin asignar
        </h2>
        <div className="flex gap-6">
          {pool.map((p) => (
            <span key={p.currency} className="tabular-nums">
              {formatMoney(p.pool, p.currency)}
            </span>
          ))}
        </div>
        <p className="text-xs opacity-50">
          No resta los resúmenes de tarjeta pendientes: la fórmula mira solo las
          cuentas de activo.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-wide opacity-60">
          Mover plata de propósito
        </h2>
        <p className="text-xs opacity-55">
          Esto no mueve plata de ninguna cuenta: cambia para qué es. Mover entre
          sobres son dos filas; devolver al pool, una negativa.
        </p>
        <MoveForm
          envelopes={envelopes.map((e) => ({ id: e.id, name: e.name }))}
          today={today}
        />
      </section>
      </div>
      </div>
    </main>
  );
}

function GoalBar({
  goal,
}: {
  goal: Awaited<ReturnType<typeof goalProgress>>[number];
}) {
  const target = Number(goal.targetAmount);
  const progress = Number(goal.progress);
  const pct = target > 0 ? Math.min(100, Math.max(0, (progress / target) * 100)) : 0;

  return (
    <div className="flex flex-col gap-1 pt-1">
      <div className="h-1.5 w-full rounded-full bg-black/10 dark:bg-white/15 overflow-hidden">
        <div
          className="h-full rounded-full bg-foreground"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs opacity-60 tabular-nums">
        {formatMoney(goal.progress, goal.targetCurrency)} de{" "}
        {formatMoney(goal.targetAmount, goal.targetCurrency)} · falta{" "}
        {formatMoney(goal.remaining, goal.targetCurrency)}
        {goal.monthsRemaining !== null
          ? ` · ${goal.monthsRemaining} ${goal.monthsRemaining === 1 ? "mes" : "meses"}, ${formatMoney(goal.suggestedContribution, goal.targetCurrency)}/mes`
          : " · sin fecha"}
        {goal.deadlineHard ? " · fecha dura" : ""}
      </p>
      {Number(goal.spent) !== 0 ? (
        <p className="text-xs opacity-50">
          Ya gastado de la meta:{" "}
          {formatMoney(goal.spent, goal.targetCurrency)} · disponible{" "}
          {formatMoney(goal.available, goal.targetCurrency)}
        </p>
      ) : null}
    </div>
  );
}
