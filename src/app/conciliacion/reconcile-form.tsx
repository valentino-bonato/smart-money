"use client";

import { useActionState } from "react";
import { reconcileAction, type ReconcileState } from "./actions";
import { formatMoney } from "@/lib/money";

export type AccountRow = {
  accountId: string;
  name: string;
  currency: "ARS" | "USD";
  computedBalance: string;
  lastReconciledAt: string | null;
};

const initial: ReconcileState = { status: "idle" };

const field =
  "rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 outline-none focus:border-black/50 dark:focus:border-white/50";

export function ReconcileForm({
  accounts,
  today,
}: {
  accounts: AccountRow[];
  today: string;
}) {
  const [state, action, pending] = useActionState(reconcileAction, initial);

  return (
    <div className="flex flex-col gap-4">
      <Fields
        key={state.status === "ok" ? state.token : "first"}
        accounts={accounts}
        today={today}
        action={action}
        pending={pending}
      />

      {state.status === "error" ? (
        <p role="status" className="text-sm text-red-600 dark:text-red-400">
          {state.message}
        </p>
      ) : null}

      {state.status === "ok" ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs uppercase tracking-wide opacity-60">
            Resultado
          </h3>
          <ul className="flex flex-col divide-y divide-black/10 dark:divide-white/10">
            {state.results.map((r) => (
              <li key={r.accountId} className="py-2 flex flex-col gap-0.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span>{r.name}</span>
                  <span
                    className={`tabular-nums shrink-0 ${
                      r.matched
                        ? "text-green-700 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {r.matched
                      ? "coincide"
                      : formatMoney(r.difference, r.currency, { sign: true })}
                  </span>
                </div>
                {!r.matched ? (
                  <span className="text-xs opacity-60">
                    homebanking {formatMoney(r.statementBalance, r.currency)} ·
                    app {formatMoney(r.computedBalance, r.currency)} ·{" "}
                    {Number(r.difference) > 0
                      ? "el banco tiene más: falta cargar un ingreso, o hay un gasto cargado que no existió"
                      : "el banco tiene menos: falta cargar un gasto"}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Fields({
  accounts,
  today,
  action,
  pending,
}: {
  accounts: AccountRow[];
  today: string;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1 max-w-48">
        <span className="text-xs uppercase tracking-wide opacity-60">
          Fecha del saldo
        </span>
        <input
          type="date"
          name="date"
          defaultValue={today}
          required
          className={field}
        />
      </label>

      <ul className="flex flex-col gap-3">
        {accounts.map((a) => (
          <li key={a.accountId} className="flex flex-col gap-1">
            <input type="hidden" name="accountId" value={a.accountId} />
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm">{a.name}</span>
              <span className="text-xs opacity-55 tabular-nums">
                app: {formatMoney(a.computedBalance, a.currency)}
              </span>
            </div>
            <input
              name="statementBalance"
              inputMode="decimal"
              autoComplete="off"
              placeholder={`saldo del homebanking en ${a.currency}`}
              className={`${field} tabular-nums`}
            />
          </li>
        ))}
      </ul>

      <p className="text-xs opacity-55">
        Las que dejes en blanco no se concilian. Para una tarjeta, el saldo va
        negativo si debés plata.
      </p>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-foreground text-background px-4 py-3 font-medium disabled:opacity-50"
      >
        {pending ? "Comparando…" : "Comparar con el homebanking"}
      </button>
    </form>
  );
}
