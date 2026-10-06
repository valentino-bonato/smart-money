import { db } from "@/db";
import {
  missingEntries,
  reconcilableAccounts,
  reconciliationHistory,
  type MissingHint,
  type ReconcilableAccount,
} from "@/db/reconcile";
import { formatMoney } from "@/lib/money";
import { accountDetail, institutionFor } from "@/lib/institutions";
import { getCurrentUser } from "@/lib/user";
import { Amount } from "@/components/money";
import { PageHeader, PageShell } from "@/components/page";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ReconcileForm } from "./reconcile-form";

export const dynamic = "force-dynamic";

function todayInBuenosAires(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
}

function dayLabel(date: string, today: string): string {
  if (date === today) return "hoy";
  const d = new Date(`${date}T00:00:00Z`);
  const t = new Date(`${today}T00:00:00Z`);
  const days = Math.round((+t - +d) / 86_400_000);
  if (days === 1) return "ayer";
  const long = new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(d);
  return days < 30 ? `hace ${days} días · ${long}` : long;
}

export default async function ConciliacionPage() {
  const user = await getCurrentUser();
  const today = todayInBuenosAires();
  const period = `${today.slice(0, 7)}-01`;

  const [accounts, missing, history] = await Promise.all([
    reconcilableAccounts(db, { userId: user.id }),
    missingEntries(db, { userId: user.id, period, today }),
    reconciliationHistory(db, { userId: user.id, limit: 20 }),
  ]);

  const unresolved = history.filter((h) => !h.resolved);

  // La franja de estado: lo que la pantalla no decía y era lo único que
  // faltaba de verdad — cuál cuenta quedó atrás. Sale de `lastReconciledAt`,
  // que la consulta ya traía.
  const dates = accounts
    .map((a) => a.lastReconciledAt)
    .filter((d): d is string => Boolean(d));
  const lastDate = dates.length ? dates.sort().at(-1)! : null;
  const upToDate = accounts.filter((a) => a.lastReconciledAt === lastDate);
  const never = accounts.filter((a) => !a.lastReconciledAt);

  // Agrupadas por institución, que es el recorrido real: se abre un
  // homebanking, se miran sus cuentas, se pasa al siguiente. El formulario
  // plano pedía un orden que el banco no deja seguir.
  const groups = groupByInstitution(accounts);

  return (
    <PageShell>
      <PageHeader title="Conciliación">
        Pegá los saldos del homebanking y la app dice la diferencia. Si cierran
        al peso, el historial está completo y el planner puede confiar en él.
      </PageHeader>

      <section className="flex flex-wrap items-center gap-x-10 gap-y-4 rounded-xl border bg-muted/30 p-4">
        <Stat label="Último cuadre">
          {lastDate ? dayLabel(lastDate, today) : "nunca"}
        </Stat>
        <Stat label="Al día">
          <span className="money">
            {lastDate ? upToDate.length : 0} de {accounts.length} cuentas
          </span>
        </Stat>
        {never.length ? (
          <Stat label="Sin conciliar nunca">
            {never.map((a) => a.name).join(" · ")}
          </Stat>
        ) : null}
      </section>

      <ReconcileForm
        groups={groups.map((g) => ({
          key: g.key,
          label: g.label,
          sample: g.accounts[0].name,
          accounts: g.accounts.map((a) => ({
            accountId: a.accountId,
            name: a.name,
            detail: accountDetail(a.name, a.currency),
            currency: a.currency,
            type: a.type,
            computedBalance: a.computedBalance,
            lastReconciledAt: a.lastReconciledAt,
            lastReconciledLabel: a.lastReconciledAt
              ? dayLabel(a.lastReconciledAt, today)
              : null,
            // La diferencia abierta y la hipótesis viajan CON la cuenta, no en
            // una tarjeta aparte: el problema y lo que hay que hacer con él
            // tienen que estar en el mismo renglón.
            pending: unresolved
              .filter((h) => h.accountId === a.accountId)
              .map((h) => ({
                id: h.id,
                date: h.date,
                difference: h.difference,
                statementBalance: h.statementBalance,
                currency: h.currency,
              })),
            hints: missing
              .filter(
                (m) => m.kind === "recurring" && m.accountId === a.accountId,
              )
              .map((m) => ({
                name: m.name,
                amount: formatMoney(m.amount, m.currency),
              })),
          })),
        }))}
        today={today}
      />

      {/* Lo que falta cargar y NO cuelga de una cuenta: un cobro esperado entra
          donde el usuario decida, así que no se puede pegar a un renglón. */}
      <PendingInflows missing={missing} />

      {history.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Últimos cuadres</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {history.slice(0, 12).map((h) => (
                <li
                  key={h.id}
                  className="flex items-baseline justify-between gap-3 py-2 text-sm text-muted-foreground"
                >
                  <span className="truncate">
                    {h.account}
                    <span className="money">{` · ${h.date}`}</span>
                  </span>
                  {Number(h.difference) === 0 ? (
                    <span className="shrink-0 text-positive">coincide</span>
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
    </PageShell>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{children}</span>
    </span>
  );
}

function PendingInflows({ missing }: { missing: MissingHint[] }) {
  const inflows = missing.filter((m) => m.kind === "inflow");
  if (!inflows.length) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cobros que ya tendrían que haber entrado</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {inflows.map((m, i) => (
            <li
              key={i}
              className="flex items-baseline justify-between gap-3 py-2 text-sm"
            >
              <span>
                {m.name}
                {m.kind === "inflow" && m.expectedDate ? (
                  <span className="money block text-xs text-muted-foreground">
                    esperado al {m.expectedDate}
                  </span>
                ) : null}
              </span>
              <Amount
                amount={m.amount}
                currency={m.currency}
                className="shrink-0"
              />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** El logo manda, así que las cuentas se juntan por institución. */
function groupByInstitution(accounts: ReconcilableAccount[]) {
  const groups: {
    key: string;
    label: string;
    accounts: ReconcilableAccount[];
  }[] = [];

  for (const a of accounts) {
    const institution = institutionFor(a.name);
    const key = institution?.key ?? "otras";
    const label = institution?.label ?? "Sin institución";
    const found = groups.find((g) => g.key === key);
    if (found) found.accounts.push(a);
    else groups.push({ key, label, accounts: [a] });
  }

  return groups;
}
