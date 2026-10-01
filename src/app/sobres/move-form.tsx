"use client";

import { useActionState, useState } from "react";
import { moveAllocationAction, type MoveState } from "./actions";
import { POOL } from "./pool";

export type MoveTarget = { id: string; name: string };

const initial: MoveState = { status: "idle" };

const field =
  "rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 outline-none focus:border-black/50 dark:focus:border-white/50";
const label = "text-xs uppercase tracking-wide opacity-60";

export function MoveForm({
  envelopes,
  today,
  defaultFrom,
  defaultTo,
  defaultCurrency,
  defaultAmount,
}: {
  envelopes: MoveTarget[];
  today: string;
  defaultFrom?: string;
  defaultTo?: string;
  defaultCurrency?: "ARS" | "USD";
  defaultAmount?: string;
}) {
  const [state, action, pending] = useActionState(
    moveAllocationAction,
    initial,
  );

  return (
    <div className="flex flex-col gap-3">
      <Fields
        key={state.status === "ok" ? state.token : "first"}
        envelopes={envelopes}
        today={today}
        action={action}
        pending={pending}
        defaultFrom={defaultFrom}
        defaultTo={defaultTo}
        defaultCurrency={defaultCurrency}
        defaultAmount={defaultAmount}
      />
      {state.status !== "idle" ? (
        <p
          role="status"
          className={`text-sm ${
            state.status === "error"
              ? "text-red-600 dark:text-red-400"
              : "text-green-700 dark:text-green-400"
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

function Fields({
  envelopes,
  today,
  action,
  pending,
  defaultFrom,
  defaultTo,
  defaultCurrency,
  defaultAmount,
}: {
  envelopes: MoveTarget[];
  today: string;
  action: (formData: FormData) => void;
  pending: boolean;
  defaultFrom?: string;
  defaultTo?: string;
  defaultCurrency?: "ARS" | "USD";
  defaultAmount?: string;
}) {
  const [from, setFrom] = useState(defaultFrom ?? POOL);
  const [to, setTo] = useState(defaultTo ?? envelopes[0]?.id ?? "");

  const options = [{ id: POOL, name: "Sin asignar (pool)" }, ...envelopes];
  const sameTarget = from === to;

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>De</span>
          <select
            name="from"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className={field}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>A</span>
          <select
            name="to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={field}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>Monto</span>
          <input
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="30,18"
            defaultValue={defaultAmount}
            required
            className={`${field} tabular-nums`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Moneda</span>
          <select
            name="currency"
            defaultValue={defaultCurrency ?? "ARS"}
            className={field}
          >
            <option value="ARS">ARS</option>
            <option value="USD">USD</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>Fecha</span>
          <input
            type="date"
            name="date"
            defaultValue={today}
            required
            className={field}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className={label}>Nota (opcional)</span>
        <input
          name="note"
          autoComplete="off"
          placeholder="Cubro el Notion atípico"
          className={field}
        />
      </label>

      <button
        type="submit"
        disabled={pending || sameTarget}
        className="rounded-lg bg-foreground text-background px-4 py-2.5 font-medium disabled:opacity-50"
      >
        {pending ? "Moviendo…" : "Mover"}
      </button>
      {sameTarget ? (
        <p className="text-sm opacity-60">
          El origen y el destino son el mismo.
        </p>
      ) : null}
    </form>
  );
}
