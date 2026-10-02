import { db } from "@/db";
import { monthlyBudget, rateForView, type BudgetLine } from "@/db/queries";
import { formatMoney } from "@/lib/money";
import { getCurrentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

function todayInBuenosAires(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
}

/** Qué porcentaje del mes pasó. Es la vara contra la que se compara el gasto. */
function monthProgress(today: string) {
  const [y, m, d] = today.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { day: d, days, pct: (d / days) * 100 };
}

function pct(line: BudgetLine): number | null {
  const a = Number(line.assignedArs);
  if (a <= 0) return null;
  return (Number(line.spentArs) / a) * 100;
}

export default async function PresupuestoPage() {
  const user = await getCurrentUser();
  const today = todayInBuenosAires();
  const period = `${today.slice(0, 7)}-01`;
  const rate = await rateForView(db, { date: today });
  const lines = await monthlyBudget(db, { userId: user.id, period, rate });

  const mes = monthProgress(today);
  const monthLabel = new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${period}T00:00:00Z`));

  // Tres grupos, por lo que hay que hacer con cada uno.
  const pasados = lines.filter((l) => Number(l.leftArs) < 0);
  const sinPresupuesto = lines.filter(
    (l) => Number(l.assignedArs) === 0 && Number(l.spentArs) !== 0,
  );
  const enOrden = lines.filter(
    (l) => Number(l.leftArs) >= 0 && Number(l.assignedArs) > 0,
  );

  return (
    <main className="mx-auto w-full max-w-xl lg:max-w-6xl px-5 py-8 flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Presupuesto de {monthLabel}</h1>
        <p className="text-sm opacity-70">
          Lo que el plan asignó este mes contra lo que llevás gastado. Van{" "}
          <strong>
            {mes.day} de {mes.days} días
          </strong>{" "}
          — o sea el {mes.pct.toFixed(0)}% del mes. Si un sobre gastó bastante
          más que eso, va camino a quedarse corto.
        </p>
      </div>

      {pasados.length ? (
        <Grupo
          titulo="Te pasaste"
          nota="Ya gastaste más de lo asignado este mes. Se cubre moviendo plata de otro sobre."
          lines={pasados}
          mes={mes}
          rate={rate}
        />
      ) : null}

      {sinPresupuesto.length ? (
        <Grupo
          titulo="Gastado sin presupuesto"
          nota="Gastaste de sobres a los que el plan no les asignó nada este mes. O falta una regla en la cascada, o salió de lo que venía acumulado."
          lines={sinPresupuesto}
          mes={mes}
          rate={rate}
        />
      ) : null}

      <Grupo
        titulo="En orden"
        nota={
          enOrden.length
            ? "Dentro de lo asignado. La barra llena es el presupuesto; la marca, el día del mes."
            : "Todavía no hay nada acá."
        }
        lines={enOrden}
        mes={mes}
        rate={rate}
      />
    </main>
  );
}

function Grupo({
  titulo,
  nota,
  lines,
  mes,
  rate,
}: {
  titulo: string;
  nota: string;
  lines: BudgetLine[];
  mes: { pct: number };
  rate: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs uppercase tracking-wide opacity-60">{titulo}</h2>
      <p className="text-xs opacity-55">{nota}</p>
      {lines.length ? (
        <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
          {lines.map((l) => (
            <Fila key={l.envelopeId} line={l} mes={mes} rate={rate} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Fila({
  line,
  mes,
  rate,
}: {
  line: BudgetLine;
  mes: { pct: number };
  rate: string;
}) {
  const used = pct(line);
  const over = Number(line.leftArs) < 0;
  // Va camino a quedarse corto: gastó bastante más de lo que avanzó el mes.
  const adelantado =
    used !== null && !over && used > mes.pct + 20 && line.rollover === "reset";

  // Si el sobre recibe una moneda y gasta otra, mostrar el detalle: el total en
  // pesos es una conversión de la vista, no un saldo guardado.
  const mixto =
    line.assigned.some((a) => a.currency === "USD") ||
    line.spent.some((s) => s.currency === "USD");

  return (
    <li className="py-3 flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">
          {line.name}
          {line.rollover === "accumulate" ? (
            <span className="opacity-40 text-xs"> · acumula</span>
          ) : null}
        </span>
        <span
          className={`tabular-nums shrink-0 ${
            over ? "text-red-600 dark:text-red-400" : ""
          }`}
        >
          {over ? "te pasaste " : "queda "}
          {formatMoney(
            over ? line.leftArs.replace("-", "") : line.leftArs,
            "ARS",
          )}
        </span>
      </div>

      {used !== null ? (
        <div className="relative h-1.5 w-full rounded-full bg-black/10 dark:bg-white/15 overflow-hidden">
          <div
            className={`h-full rounded-full ${
              over
                ? "bg-red-600 dark:bg-red-400"
                : adelantado
                  ? "bg-amber-500"
                  : "bg-foreground"
            }`}
            style={{ width: `${Math.min(100, used)}%` }}
          />
          {/* La marca del día del mes: la vara contra la que se compara. */}
          <span
            className="absolute top-0 h-full w-px bg-black/45 dark:bg-white/55"
            style={{ left: `${Math.min(100, mes.pct)}%` }}
            aria-hidden
          />
        </div>
      ) : null}

      <p className="text-xs opacity-55 tabular-nums">
        {formatMoney(line.spentArs, "ARS")} de{" "}
        {formatMoney(line.assignedArs, "ARS")}
        {used !== null ? ` · ${used.toFixed(0)}%` : " · sin presupuesto"}
        {adelantado ? " · vas rápido para el día que es" : ""}
      </p>

      {mixto ? (
        <p className="text-xs opacity-40 tabular-nums">
          asignado{" "}
          {line.assigned.length
            ? line.assigned
                .map((a) => formatMoney(a.amount, a.currency))
                .join(" + ")
            : "nada"}
          {" · gastado "}
          {line.spent.length
            ? line.spent.map((s) => formatMoney(s.amount, s.currency)).join(" + ")
            : "nada"}
          {` · comparado al dólar de ${formatMoney(rate, "ARS")}`}
        </p>
      ) : null}
    </li>
  );
}
