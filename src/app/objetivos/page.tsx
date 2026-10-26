import { db } from "@/db";
import {
  goalProgress,
  nextPlanningPeriod,
  rateForView,
  type GoalProgress,
} from "@/db/queries";
import { envelopeLook } from "@/lib/envelope-icons";
import { formatMoney } from "@/lib/money";
import { getCurrentUser } from "@/lib/user";
import { PageHeader, PageShell } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";

export const dynamic = "force-dynamic";

function todayInBuenosAires(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
}

function shortDate(date: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/** Qué parte del camino ya se juntó. */
function progressPct(g: GoalProgress): number {
  const target = Number(g.targetAmount);
  if (target <= 0) return 0;
  return Math.min(100, Math.max(0, (Number(g.progress) / target) * 100));
}

/**
 * Qué parte del TIEMPO ya pasó, entre la primera asignación y la fecha meta.
 *
 * Es el equivalente de la marca del día del mes en `/presupuesto`, y por la
 * misma razón: un 19% juntado no dice nada hasta saber si faltan siete meses o
 * dos años. Sin fecha meta no hay eje de tiempo y no hay marca.
 */
function timePct(g: GoalProgress, today: string): number | null {
  if (!g.targetDate || !g.startedAt) return null;
  const start = +new Date(`${g.startedAt}T00:00:00Z`);
  const end = +new Date(`${g.targetDate}T00:00:00Z`);
  const now = +new Date(`${today}T00:00:00Z`);
  if (end <= start) return null;
  return Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
}

/**
 * El progreso de las metas, con la misma impronta que `/presupuesto`.
 *
 * Existe porque las metas estaban repartidas: el progreso en Presupuestos
 * mezclado con los doce sobres, y el aporte que hace falta solo en el Plan. La
 * pregunta "¿llego?" no tenía pantalla.
 *
 * **Agrupa por si la meta va atrasada**, no por tipo. Es el mismo criterio que
 * `/presupuesto`, que agrupa por "te pasaste" y no por categoría: lo que hay
 * que ver primero es lo que no va a llegar.
 */
export default async function ObjetivosPage() {
  const user = await getCurrentUser();
  const today = todayInBuenosAires();

  const rate = await rateForView(db, { date: today });
  // El aporte sugerido se mide desde el próximo mes a planificar, no desde el
  // actual: contar el mes en curso como pendiente mientras su asignación ya
  // suma al progreso da un aporte más bajo del real.
  const planning = await nextPlanningPeriod(db, { userId: user.id, today });
  const goals = await goalProgress(db, { rate, period: planning });

  const planningLabel = new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${planning}T00:00:00Z`));

  const cumplidas: GoalProgress[] = [];
  const atrasadas: GoalProgress[] = [];
  const alDia: GoalProgress[] = [];
  const sinFecha: GoalProgress[] = [];

  for (const g of goals) {
    // Una meta completa ya no está "en camino" ni "sin fecha": está cumplida,
    // y mezclarla con las que faltan hace parecer que queda trabajo.
    if (Number(g.remaining) <= 0) {
      cumplidas.push(g);
      continue;
    }
    const t = timePct(g, today);
    if (t === null) sinFecha.push(g);
    else if (progressPct(g) + 1 < t) atrasadas.push(g);
    else alDia.push(g);
  }

  // El total por moneda del objetivo. No se convierte nada: sumar metas en
  // monedas distintas pediría un precio, y una meta a 2027 valuada al dólar de
  // hoy es un número que cambia solo.
  const totals = new Map<string, { target: number; progress: number }>();
  for (const g of goals) {
    const t = totals.get(g.targetCurrency) ?? { target: 0, progress: 0 };
    t.target += Number(g.targetAmount);
    t.progress += Number(g.progress);
    totals.set(g.targetCurrency, t);
  }

  return (
    <PageShell>
      <PageHeader title="Objetivos">
        Cuánto llevás de cada meta y cuánto hace falta por mes para llegar. El
        aporte se mide desde {planningLabel}, con lo ya asignado descontado.
      </PageHeader>

      {goals.length ? (
        <>
          <section className="flex flex-wrap items-center gap-x-10 gap-y-4 rounded-xl border bg-muted/30 p-4">
            {[...totals.entries()].map(([currency, t]) => (
              <span key={currency} className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Juntado en {currency}
                </span>
                <span className="money font-heading text-lg font-semibold">
                  {formatMoney(String(t.progress), currency as "ARS" | "USD")}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    de{" "}
                    {formatMoney(String(t.target), currency as "ARS" | "USD")}
                  </span>
                </span>
              </span>
            ))}
            {atrasadas.length ? (
              <span className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Atrasadas
                </span>
                <span className="text-sm font-medium">
                  {atrasadas.length} de {goals.length - cumplidas.length}
                </span>
              </span>
            ) : null}
          </section>

          <Grupo
            titulo="Va atrasada"
            nota="Juntaste menos de lo que avanzó el tiempo hasta la fecha meta. El aporte de abajo ya es el que hace falta para recuperar."
            goals={atrasadas}
            today={today}
          />
          <Grupo
            titulo="En camino"
            nota="El progreso le lleva el ritmo al calendario."
            goals={alDia}
            today={today}
          />
          <Grupo
            titulo="Cumplida"
            nota="Ya juntaste el total. La plata sigue en el sobre hasta que la uses."
            goals={cumplidas}
            today={today}
          />
          <Grupo
            titulo="Sin fecha"
            nota="No hay contra qué medir el ritmo. Se completan con lo que sobra, después de las que tienen fecha."
            goals={sinFecha}
            today={today}
          />
        </>
      ) : (
        <Empty className="rounded-xl border py-10">
          <EmptyTitle>Todavía no hay metas</EmptyTitle>
          <EmptyDescription>
            Un sobre se vuelve meta cuando tiene un monto objetivo.
          </EmptyDescription>
        </Empty>
      )}
    </PageShell>
  );
}

function Grupo({
  titulo,
  nota,
  goals,
  today,
}: {
  titulo: string;
  nota: string;
  goals: GoalProgress[];
  today: string;
}) {
  if (!goals.length) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-heading text-base font-medium">
          {titulo}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {goals.length}
          </span>
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">{nota}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {goals.map((g) => (
          <GoalCard key={g.envelopeId} goal={g} today={today} />
        ))}
      </div>
    </section>
  );
}

/**
 * Una tarjeta por meta: lo juntado grande, el objetivo abajo, la barra con la
 * marca del tiempo, y el renglón que cierra la cuenta.
 *
 * **Sin colores de estado**, igual que `/presupuesto`: que una meta vaya
 * atrasada se dice con palabras y con el grupo en el que cae, no pintando la
 * tarjeta. El único color es el del ícono, que es identidad.
 */
function GoalCard({ goal, today }: { goal: GoalProgress; today: string }) {
  const look = envelopeLook(goal.name);
  const Icon = look.icon;
  const pct = progressPct(goal);
  const time = timePct(goal, today);
  const atrasada = time !== null && pct + 1 < time;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            {/* El color va en `style`: una clase armada no la ve el escáner de
                Tailwind. Mismo motivo que el punto de institución. */}
            <Icon
              className="size-4 shrink-0"
              style={{ color: `var(${look.cssVar})` }}
              aria-hidden
            />
            <span className="truncate">{goal.name}</span>
          </span>
          {goal.deadlineHard ? (
            <Badge variant="outline" className="shrink-0">
              fecha dura
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-col">
          <span className="money font-heading text-2xl font-semibold">
            {formatMoney(goal.progress, goal.targetCurrency)}
          </span>
          <span className="money text-sm text-muted-foreground">
            de {formatMoney(goal.targetAmount, goal.targetCurrency)}
            {goal.targetDate ? ` · ${shortDate(goal.targetDate)}` : ""}
          </span>
        </div>

        <GoalBar pct={pct} timePct={time} />

        <p className="money text-sm">
          Falta{" "}
          <strong className="font-medium">
            {formatMoney(goal.remaining, goal.targetCurrency)}
          </strong>
          <span className="text-muted-foreground">
            {" · "}
            {pct.toFixed(0)}% juntado
          </span>
        </p>

        {goal.monthsRemaining !== null ? (
          <p className="money text-sm text-muted-foreground">
            {goal.monthsRemaining <= 0 ? (
              "La fecha ya pasó."
            ) : (
              <>
                <strong className="font-medium text-foreground">
                  {formatMoney(
                    goal.suggestedContribution,
                    goal.targetCurrency,
                  )}
                  /mes
                </strong>{" "}
                durante {goal.monthsRemaining}{" "}
                {goal.monthsRemaining === 1 ? "mes" : "meses"}
                {atrasada ? " para recuperar el atraso" : ""}
              </>
            )}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Sin fecha: no hay aporte mensual que calcular.
          </p>
        )}

        {/* El progreso de una meta NO es el saldo del sobre: gastar en la meta
            misma —el hostel de Amsterdam— es la meta cumpliéndose, no plata
            que haya que volver a juntar. Por eso se aclara aparte cuánto queda
            disponible. */}
        {Number(goal.spent) !== 0 ? (
          <p className="money text-xs text-muted-foreground">
            Ya usaste {formatMoney(goal.spent, goal.targetCurrency)} de la meta
            · te quedan {formatMoney(goal.available, goal.targetCurrency)} sin
            gastar
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * La barra, con la marca del tiempo transcurrido.
 *
 * Es la misma pieza que la de `/presupuesto` y por el mismo motivo: el relleno
 * solo no dice nada. Allá la marca es el día del mes; acá, qué parte del
 * camino hasta la fecha meta ya pasó. Si el relleno va detrás de la marca, la
 * meta va atrasada, y se ve sin leer un número.
 *
 * La marca sobresale por arriba y por abajo en vez de cruzar la barra: cruzando
 * desaparecía justo cuando el relleno la pasa, que es cuando hay algo para ver.
 */
function GoalBar({ pct, timePct }: { pct: number; timePct: number | null }) {
  return (
    <div
      className="relative py-1"
      title={
        timePct === null
          ? undefined
          : `La marca es el tiempo transcurrido: ${timePct.toFixed(0)}%`
      }
    >
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground"
          style={{ width: `${pct}%` }}
        />
      </div>
      {timePct !== null ? (
        <span
          aria-hidden
          className="absolute inset-y-0 w-px bg-foreground/60"
          style={{ left: `${timePct}%` }}
        />
      ) : null}
    </div>
  );
}
