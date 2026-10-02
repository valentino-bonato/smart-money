import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { computePlan, loadPlan } from "@/db/planner";
import { nextPlanningPeriod, rateForView } from "@/db/queries";
import { formatMoney } from "@/lib/money";
import { getCurrentUser } from "@/lib/user";
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
    <main className="mx-auto w-full max-w-xl lg:max-w-6xl px-5 py-8 flex flex-col gap-8">
      <h1 className="text-xl font-semibold">Plan de {monthLabel}</h1>

      <p className="text-sm opacity-70">
        {approved
          ? "Este mes ya está aprobado. Lo de abajo es lo que la cascada propone hoy; recalcular lo pisa."
          : "Lo que la cascada propone con lo que entró. Nada se asigna hasta que aprobás."}{" "}
        Dólar {formatMoney(rate, "ARS")}.
      </p>

      <div className="grid lg:grid-cols-2 lg:gap-12 gap-8 lg:items-start">
      <div className="flex flex-col gap-8">
      {TIERS.map(({ tier, title, source }) => {
        const lines = computed.lines.filter((l) => l.tier === tier);
        const available = computed.available[tier];
        const leftover = computed.leftover[tier];
        return (
          <section key={tier} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-xs uppercase tracking-wide opacity-60">
                {title}
              </h2>
              <span className="text-sm tabular-nums opacity-70">
                {computed.applied[tier] ? (
                  "ya aplicado"
                ) : (
                  <>
                    {formatMoney(available, "ARS")}
                    <span className="opacity-60">
                      {" "}
                      {computed.availableSource[tier] === "expected"
                        ? "esperado"
                        : "cobrado"}
                    </span>
                  </>
                )}
              </span>
            </div>
            {lines.length === 0 ? (
              <p className="text-sm opacity-60">
                Todavía no entró nada de {source}.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
                {lines.map((l) => (
                  <li
                    key={l.sequence}
                    className={`py-2 flex flex-col ${
                      l.alreadyApplied ? "opacity-45" : ""
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span>
                        {l.envelopeName ?? (
                          <>
                            {l.accountName}{" "}
                            <span className="opacity-50">· pago</span>
                          </>
                        )}
                      </span>
                      <span className="tabular-nums shrink-0">
                        {formatMoney(l.amount, l.currency)}
                      </span>
                    </div>
                    <span className="text-xs opacity-50">{l.ruleApplied}</span>
                  </li>
                ))}
              </ul>
            )}
            {computed.applied[tier] ? (
              <p className="text-xs opacity-55">
                Ya aprobado: esta plata tiene destino y no vuelve a aparecer en
                las transferencias. Para rehacerlo, deshacé la aprobación abajo.
              </p>
            ) : null}
            {Number(leftover) > 0 ? (
              <p className="text-xs opacity-60">
                Queda sin asignar {formatMoney(leftover, "ARS")}.
              </p>
            ) : null}
          </section>
        );
      })}


      </div>
      <div className="flex flex-col gap-8">
      {/* El criterio de éxito de la pantalla: la lista de transferencias
          concretas. Sin esto el plan obliga a sentarse a calcular. */}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs uppercase tracking-wide opacity-60">
          Transferencias pendientes
        </h2>
        {payments.length === 0 && computed.transfers.length === 0 ? (
          <p className="text-sm opacity-60">
            Nada pendiente: lo que el plan asignó ya tiene destino y no hay
            resúmenes por pagar.
          </p>
        ) : null}
        <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
          {payments.map((l) => (
            <li
              key={`pay-${l.sequence}`}
              className="py-2 flex items-baseline justify-between gap-3"
            >
              <span>
                Pagar {l.accountName}
              </span>
              <span className="tabular-nums shrink-0">
                {formatMoney(l.amount, l.currency)}
              </span>
            </li>
          ))}
          {computed.transfers.map((t) => (
            <li
              key={t.accountId}
              className="py-2 flex items-baseline justify-between gap-3"
            >
              <span>
                {t.accountName}
                {t.needsExchange ? (
                  <span className="opacity-50">
                    {" "}
                    · comprar {t.destinationCurrency}
                  </span>
                ) : null}
              </span>
              <span className="tabular-nums shrink-0">
                {formatMoney(t.amount, t.currency)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {computed.expected.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs uppercase tracking-wide opacity-60">
            Cobros esperados
          </h2>
          <p className="text-xs opacity-55">
            Se muestran y no se asignan hasta que entran.
          </p>
          <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
            {computed.expected.map((e) => (
              <li
                key={e.id}
                className="py-2 flex items-baseline justify-between gap-3 text-sm"
              >
                <span>
                  {e.source}
                  <span className="opacity-50">
                    {" "}
                    · {e.expectedDate ?? "sin fecha"}
                  </span>
                </span>
                <span className="tabular-nums shrink-0">
                  {formatMoney(e.amount, e.currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-wide opacity-60">
          {approved ? "Ya aprobado" : "Aprobar"}
        </h2>
        <ApproveForm
          period={period}
          envelopes={adHoc.map((e) => ({ id: e.id, name: e.name }))}
          approved={approved}
          planId={saved?.plan.id ?? null}
        />
      </section>
      </div>
      </div>
    </main>
  );
}
