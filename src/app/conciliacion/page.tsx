import { db } from "@/db";
import {
  missingEntries,
  reconcilableAccounts,
  reconciliationHistory,
} from "@/db/reconcile";
import { formatMoney } from "@/lib/money";
import { getCurrentUser } from "@/lib/user";
import { adjustAction, ignoreAction } from "./actions";
import { ReconcileForm } from "./reconcile-form";

export const dynamic = "force-dynamic";

function todayInBuenosAires(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
}

export default async function ConciliacionPage() {
  const user = await getCurrentUser();
  const today = todayInBuenosAires();
  const period = `${today.slice(0, 7)}-01`;

  const [accounts, missing, history] = await Promise.all([
    reconcilableAccounts(db, { userId: user.id }),
    missingEntries(db, { userId: user.id, period, today }),
    reconciliationHistory(db, { userId: user.id, limit: 12 }),
  ]);

  const unresolved = history.filter((h) => !h.resolved);

  return (
    <main className="mx-auto w-full max-w-xl lg:max-w-6xl px-5 py-8 flex flex-col gap-8">
      <h1 className="text-xl font-semibold">Conciliación</h1>

      <p className="text-sm opacity-70">
        Pegá los saldos del homebanking y la app dice la diferencia. Si cierran
        al peso, el historial está completo y el planner puede confiar en él.
      </p>

      <div className="grid lg:grid-cols-2 lg:gap-12 gap-8 lg:items-start">
      <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-xs uppercase tracking-wide opacity-60">
          Saldos del homebanking
        </h2>
        <ReconcileForm
          accounts={accounts.map((a) => ({
            accountId: a.accountId,
            name: a.name,
            currency: a.currency,
            computedBalance: a.computedBalance,
            lastReconciledAt: a.lastReconciledAt,
          }))}
          today={today}
        />
      </section>


      </div>
      <div className="flex flex-col gap-8">
      {/* La segunda mitad, que es la que vale: qué es lo más probable que
          falte. No adivina gastos sueltos — apunta a lo que la app ya sabe que
          tiene que pasar y todavía no vio. */}
      {missing.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs uppercase tracking-wide opacity-60">
            Probablemente falte cargar esto
          </h2>
          <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
            {missing.map((m, i) => (
              <li
                key={`${m.kind}-${i}`}
                className="py-2 flex items-baseline justify-between gap-3 text-sm"
              >
                <span>
                  {m.name}
                  <span className="opacity-50">
                    {" "}
                    ·{" "}
                    {m.kind === "recurring"
                      ? `gasto fijo del mes, desde ${m.accountName}`
                      : `cobro esperado${m.expectedDate ? ` al ${m.expectedDate}` : ""}`}
                  </span>
                </span>
                <span className="tabular-nums shrink-0">
                  {formatMoney(m.amount, m.currency)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs opacity-55">
            Los gastos fijos se cargan desde el plan del mes; los cobros, desde
            la pantalla de carga.
          </p>
        </section>
      ) : (
        <p className="text-sm opacity-60">
          No hay gastos fijos ni cobros esperados pendientes de cargar este mes.
        </p>
      )}

      {unresolved.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs uppercase tracking-wide opacity-60">
            Diferencias sin resolver
          </h2>
          <p className="text-xs opacity-55">
            <strong>Ajustar</strong> deja la cuenta en el saldo del homebanking
            con un asiento de ajuste — para lo que no se arregla cargando un
            movimiento, como la revalorización de los CEDEARs o una comisión.
            <strong> Ignorar</strong> no toca nada: es para cuando ya sabés qué
            falta y lo vas a cargar.
          </p>
          <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
            {unresolved.map((h) => (
              <li
                key={h.id}
                className="py-2 flex items-baseline justify-between gap-3 text-sm"
              >
                <span>
                  {h.account}
                  <span className="opacity-50"> · {h.date}</span>
                </span>
                <span className="flex items-baseline gap-3 shrink-0">
                  <span className="tabular-nums text-red-600 dark:text-red-400">
                    {formatMoney(h.difference, h.currency, { sign: true })}
                  </span>
                  {/* Ajustar deja la cuenta en el saldo del homebanking con un
                      asiento contra Equity:Ajustes. Ignorar no toca nada: es
                      para cuando ya sabés qué falta y lo vas a cargar. */}
                  <form action={adjustAction}>
                    <input type="hidden" name="id" value={h.id} />
                    <input type="hidden" name="accountId" value={h.accountId} />
                    <input
                      type="hidden"
                      name="toBalance"
                      value={h.statementBalance}
                    />
                    <input type="hidden" name="date" value={h.date} />
                    <button type="submit" className="underline text-xs">
                      Ajustar
                    </button>
                  </form>
                  <form action={ignoreAction}>
                    <input type="hidden" name="id" value={h.id} />
                    <button
                      type="submit"
                      className="underline opacity-50 text-xs"
                    >
                      Ignorar
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {history.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs uppercase tracking-wide opacity-60">
            Historial
          </h2>
          <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
            {history.map((h) => (
              <li
                key={h.id}
                className="py-2 flex items-baseline justify-between gap-3 text-sm"
              >
                <span className="opacity-70">
                  {h.date} · {h.account}
                </span>
                <span className="tabular-nums shrink-0 opacity-70">
                  {Number(h.difference) === 0
                    ? "coincide"
                    : formatMoney(h.difference, h.currency, { sign: true })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      </div>
      </div>
    </main>
  );
}
