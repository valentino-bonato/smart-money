import { db } from "@/db";
import { monthlyBudget, rateForView, type BudgetLine } from "@/db/queries";
import { formatMoney } from "@/lib/money";
import { getCurrentUser } from "@/lib/user";
import { Amount } from "@/components/money";
import { PageHeader, PageShell } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
    <PageShell>
      <PageHeader title={`Presupuesto de ${monthLabel}`}>
        Lo que el plan asignó este mes contra lo que llevás gastado. Van{" "}
        <strong className="font-medium text-foreground">
          {mes.day} de {mes.days} días
        </strong>{" "}
        — o sea el {mes.pct.toFixed(0)}% del mes. Si un sobre gastó bastante más
        que eso, va camino a quedarse corto.
      </PageHeader>

      {/* Tres grupos y no una lista ordenada: lo que hay que hacer con cada uno
          es distinto, y mezclarlos esconde justamente el que urge. */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {pasados.length ? (
          <Grupo
            titulo="Te pasaste"
            nota="Ya gastaste más de lo asignado este mes. Se cubre moviendo plata de otro sobre."
            lines={pasados}
            mes={mes}
            rate={rate}
            tone="negative"
          />
        ) : null}

        {sinPresupuesto.length ? (
          <Grupo
            titulo="Gastado sin presupuesto"
            nota="Gastaste de sobres a los que el plan no les asignó nada este mes. O falta una regla en la cascada, o salió de lo que venía acumulado."
            lines={sinPresupuesto}
            mes={mes}
            rate={rate}
            tone="warning"
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
      </div>
    </PageShell>
  );
}

function Grupo({
  titulo,
  nota,
  lines,
  mes,
  rate,
  tone,
}: {
  titulo: string;
  nota: string;
  lines: BudgetLine[];
  mes: { pct: number };
  rate: string;
  tone?: "negative" | "warning";
}) {
  return (
    <Card
      className={
        tone === "negative"
          ? "ring-negative/30"
          : tone === "warning"
            ? "ring-warning/30"
            : ""
      }
    >
      <CardHeader>
        <CardTitle
          className={
            tone === "negative"
              ? "text-negative"
              : tone === "warning"
                ? "text-warning"
                : ""
          }
        >
          {titulo}
        </CardTitle>
        <CardDescription>{nota}</CardDescription>
      </CardHeader>
      {lines.length ? (
        <CardContent>
          <ul className="divide-y">
            {lines.map((l) => (
              <Fila key={l.envelopeId} line={l} mes={mes} rate={rate} />
            ))}
          </ul>
        </CardContent>
      ) : null}
    </Card>
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
    <li className="flex flex-col gap-1.5 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">
          {line.name}
          {line.rollover === "accumulate" ? (
            <Badge variant="ghost" className="ml-1.5 text-muted-foreground">
              acumula
            </Badge>
          ) : null}
        </span>
        <span className="shrink-0 text-sm">
          <span className={over ? "text-negative" : "text-muted-foreground"}>
            {over ? "te pasaste " : "queda "}
          </span>
          <Amount
            amount={over ? line.leftArs.replace("-", "") : line.leftArs}
            currency="ARS"
            tone={over ? "negative" : "plain"}
          />
        </span>
      </div>

      {/* La barra no usa el Progress de shadcn: necesita la marca del día del
          mes encima, y sin esa vara un 60% gastado no dice nada — depende de si
          es día 5 o día 25. */}
      {used !== null ? (
        <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${
              over
                ? "bg-negative"
                : adelantado
                  ? "bg-warning"
                  : "bg-primary"
            }`}
            style={{ width: `${Math.min(100, used)}%` }}
          />
          <span
            className="absolute top-0 h-full w-px bg-foreground/50"
            style={{ left: `${Math.min(100, mes.pct)}%` }}
            aria-hidden
          />
        </div>
      ) : null}

      <p className="money text-xs text-muted-foreground">
        {formatMoney(line.spentArs, "ARS")} de{" "}
        {formatMoney(line.assignedArs, "ARS")}
        {used !== null ? ` · ${used.toFixed(0)}%` : " · sin presupuesto"}
        {adelantado ? " · vas rápido para el día que es" : ""}
      </p>

      {mixto ? (
        <p className="money text-xs text-muted-foreground/70">
          asignado{" "}
          {line.assigned.length
            ? line.assigned
                .map((a) => formatMoney(a.amount, a.currency))
                .join(" + ")
            : "nada"}
          {" · gastado "}
          {line.spent.length
            ? line.spent
                .map((s) => formatMoney(s.amount, s.currency))
                .join(" + ")
            : "nada"}
          {` · comparado al dólar de ${formatMoney(rate, "ARS")}`}
        </p>
      ) : null}
    </li>
  );
}
