import { db } from "@/db";
import { monthlyBudget, rateForView, type BudgetLine } from "@/db/queries";
import { formatMoney } from "@/lib/money";
import { getCurrentUser } from "@/lib/user";
import { sumAmounts } from "@/db/ledger";
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

/** Dar vuelta el signo sin pasar por `Number`: la plata es string. */
function negate(amount: string): string {
  return amount.startsWith("-") ? amount.slice(1) : `-${amount}`;
}

function usedPct(assigned: string, spent: string): number | null {
  const a = Number(assigned);
  if (a <= 0) return null;
  return (Number(spent) / a) * 100;
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

  // Los sobres sin nada asignado y sin nada gastado no se muestran: ocupan una
  // tarjeta entera para decir que no pasó nada.
  const activos = lines.filter(
    (l) => Number(l.assignedArs) > 0 || Number(l.spentArs) !== 0,
  );

  // Tres grupos, por lo que hay que hacer con cada uno. Mezclarlos en una sola
  // grilla esconde justo el que urge.
  const pasados = activos.filter((l) => Number(l.leftArs) < 0);
  const sinPresupuesto = activos.filter(
    (l) => Number(l.assignedArs) === 0 && Number(l.spentArs) !== 0,
  );
  const enOrden = activos.filter(
    (l) => Number(l.leftArs) >= 0 && Number(l.assignedArs) > 0,
  );

  // Los totales del mes. En pesos, con la misma conversión de vista que las
  // líneas: no se guarda ningún saldo convertido, y la suma va por `sumAmounts`
  // (BigInt) y no por `Number`, que es la regla de la casa para la plata.
  const totalAsignado = sumAmounts(lines.map((l) => l.assignedArs));
  const totalGastado = sumAmounts(lines.map((l) => l.spentArs));
  const totalQueda = sumAmounts([totalAsignado, negate(totalGastado)]);
  const totalPct = usedPct(totalAsignado, totalGastado);

  return (
    <PageShell>
      <PageHeader title={`Presupuesto de ${monthLabel}`}>
        Lo que el plan asignó este mes contra lo que llevás gastado. Si un sobre
        gastó bastante más de lo que avanzó el mes, va camino a quedarse corto.
      </PageHeader>

      {/* El mes entero en un renglón y una barra. Es lo primero que se mira:
          responde "¿cómo voy?" antes de entrar en sobre por sobre. */}
      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div className="flex flex-col">
              <span className="text-sm text-muted-foreground">
                Gastado este mes
              </span>
              <span className="money font-heading text-3xl font-semibold">
                {formatMoney(totalGastado, "ARS")}
              </span>
              <span className="money text-sm text-muted-foreground">
                de {formatMoney(totalAsignado, "ARS")} asignado
              </span>
            </div>
            {/* En el teléfono los dos bloques quedan apilados, así que la
                alineación a la derecha recién entra cuando están lado a lado. */}
            <div className="flex flex-col items-start text-left sm:items-end sm:text-right">
              <span className="money text-xl font-medium">
                {formatMoney(totalQueda, "ARS")}
              </span>
              <span className="text-sm text-muted-foreground">
                queda para {mes.days - mes.day}{" "}
                {mes.days - mes.day === 1 ? "día" : "días"}
              </span>
            </div>
          </div>

          <BudgetBar used={totalPct} monthPct={mes.pct} />

          {/* La vara. Un 29% gastado no significa nada hasta saber si es día 3
              o día 25, así que el día del mes va dicho y marcado en la barra. */}
          <p className="text-sm text-muted-foreground">
            Van{" "}
            <strong className="font-medium text-foreground">
              {mes.day} de {mes.days} días
            </strong>
            , el {mes.pct.toFixed(0)}% del mes — y es la marca de la barra.
            {totalPct !== null
              ? ` Llevás gastado el ${totalPct.toFixed(0)}%.`
              : ""}
          </p>
        </CardContent>
      </Card>

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
            ? "Dentro de lo asignado."
            : "Todavía no hay nada acá."
        }
        lines={enOrden}
        mes={mes}
        rate={rate}
      />
    </PageShell>
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
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-heading text-base font-medium">
          {titulo}
          {lines.length ? (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {lines.length}
            </span>
          ) : null}
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">{nota}</p>
      </div>
      {lines.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lines.map((l) => (
            <SobreCard key={l.envelopeId} line={l} mes={mes} rate={rate} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Una tarjeta por sobre: el gastado grande, lo asignado abajo, la barra, y el
 * renglón que cierra la cuenta.
 *
 * **Sin colores.** La referencia que pidió el usuario codificaba el estado en
 * rojo/amarillo/verde y es justo lo que no quería: el estado se dice con
 * palabras ("Te pasaste por $70.000") y se marca con el borde de la tarjeta,
 * que es el mismo gris del tema un poco más fuerte. Un color por estado en una
 * grilla de doce tarjetas vuelve la pantalla un semáforo.
 */
function SobreCard({
  line,
  mes,
  rate,
}: {
  line: BudgetLine;
  mes: { pct: number };
  rate: string;
}) {
  const used = usedPct(line.assignedArs, line.spentArs);
  const over = Number(line.leftArs) < 0;
  // Va camino a quedarse corto: gastó bastante más de lo que avanzó el mes.
  const adelantado =
    used !== null && !over && used > mes.pct + 20 && line.rollover === "reset";
  const sinAsignar = Number(line.assignedArs) === 0;

  // Si el sobre recibe una moneda y gasta otra, mostrar el detalle: el total en
  // pesos es una conversión de la vista, no un saldo guardado.
  const mixto =
    line.assigned.some((a) => a.currency === "USD") ||
    line.spent.some((s) => s.currency === "USD");

  return (
    <Card size="sm" className={over ? "ring-foreground/25" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="truncate">{line.name}</span>
          {over ? (
            <Badge variant="outline" className="shrink-0">
              te pasaste
            </Badge>
          ) : adelantado ? (
            <Badge variant="outline" className="shrink-0">
              vas rápido
            </Badge>
          ) : null}
        </CardTitle>
        {line.rollover === "accumulate" ? (
          <CardDescription className="text-xs">
            acumula — el saldo del sobre arrastra meses anteriores
          </CardDescription>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-2">
        <div className="flex flex-col">
          <span className="money font-heading text-2xl font-semibold">
            {formatMoney(line.spentArs, "ARS")}
          </span>
          <span className="money text-sm text-muted-foreground">
            {sinAsignar
              ? "sin nada asignado este mes"
              : `de ${formatMoney(line.assignedArs, "ARS")} asignado`}
          </span>
        </div>

        {used !== null ? <BudgetBar used={used} monthPct={mes.pct} /> : null}

        <p className="money text-sm">
          {over ? (
            <>
              Te pasaste por{" "}
              <strong className="font-medium">
                {formatMoney(line.leftArs.replace("-", ""), "ARS")}
              </strong>
              {used !== null ? (
                <span className="text-muted-foreground">
                  {" "}
                  · {used.toFixed(0)}% de lo asignado
                </span>
              ) : null}
            </>
          ) : sinAsignar ? (
            <span className="text-muted-foreground">
              Salió de lo que venía acumulado.
            </span>
          ) : (
            <>
              Queda{" "}
              <strong className="font-medium">
                {formatMoney(line.leftArs, "ARS")}
              </strong>
              <span className="text-muted-foreground">
                {" "}
                · {used!.toFixed(0)}% usado
              </span>
            </>
          )}
        </p>

        {mixto ? (
          <p className="money text-xs text-muted-foreground">
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
            {` · al dólar de ${formatMoney(rate, "ARS")}`}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * La barra, con la marca del día del mes.
 *
 * No usa el `Progress` de shadcn porque necesita esa marca, que es la mitad del
 * sentido: un 60% gastado no dice nada hasta saber si es día 5 o día 25.
 *
 * **La marca sobresale de la barra en vez de cruzarla.** Cruzándola desaparecía
 * apenas el gasto la pasaba, que es justo cuando hay algo para ver: quedaba una
 * línea gris encima del relleno negro. Ahora la pista va en una caja más alta y
 * la marca la pasa por arriba y por abajo, así se ve con la barra vacía o llena.
 *
 * Pasado el 100% el excedente va rayado sobre el relleno, en escala. Es la
 * forma de mostrar que se pasó sin recurrir al rojo.
 */
function BudgetBar({
  used,
  monthPct,
}: {
  used: number | null;
  monthPct: number;
}) {
  const fill = Math.min(100, Math.max(0, used ?? 0));
  const over = (used ?? 0) > 100;
  const mark = Math.min(100, Math.max(0, monthPct));

  return (
    <div
      className="relative py-1"
      title={`La marca es el día del mes: ${mark.toFixed(0)}%`}
    >
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-foreground"
          style={{ width: `${fill}%` }}
        />
        {over ? (
          <span
            aria-hidden
            className="absolute inset-y-0 right-0 bg-[repeating-linear-gradient(135deg,var(--background)_0_2px,transparent_2px_5px)]"
            style={{ width: `${((used! - 100) / used!) * 100}%` }}
          />
        ) : null}
      </div>
      <span
        aria-hidden
        className="absolute inset-y-0 w-px bg-foreground/60"
        style={{ left: `${mark}%` }}
      />
    </div>
  );
}
