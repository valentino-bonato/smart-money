"use client";

import { useActionState, useState } from "react";
import {
  approveMonthAction,
  unapproveMonthAction,
  type PlanActionState,
} from "./actions";

const initial: PlanActionState = { status: "idle" };

const field =
  "rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 outline-none focus:border-black/50 dark:focus:border-white/50";

export function ApproveForm({
  period,
  envelopes,
  approved,
  planId,
}: {
  period: string;
  /** Sobres sin regla de aporte: los candidatos a puntual del mes. */
  envelopes: { id: string; name: string }[];
  approved: boolean;
  planId: string | null;
}) {
  const [state, action, pending] = useActionState(approveMonthAction, initial);
  const [extras, setExtras] = useState<number[]>([0]);

  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="period" value={period} />

        {envelopes.length ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs uppercase tracking-wide opacity-60">
              Puntuales del mes
            </legend>
            {extras.map((key) => (
              <div key={key} className="grid grid-cols-[1fr_1fr_1fr] gap-2">
                <select name="extraEnvelopeId" className={field} defaultValue="">
                  <option value="">—</option>
                  {envelopes.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
                <input
                  name="extraAmount"
                  inputMode="decimal"
                  placeholder="200.000"
                  autoComplete="off"
                  className={`${field} tabular-nums`}
                />
                <input
                  name="extraNote"
                  placeholder="cumple de Rochi"
                  autoComplete="off"
                  className={field}
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() => setExtras((e) => [...e, (e.at(-1) ?? 0) + 1])}
              className="self-start text-sm underline opacity-70"
            >
              Agregar otro
            </button>
          </fieldset>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-foreground text-background px-4 py-3 font-medium disabled:opacity-50"
        >
          {pending
            ? "Calculando…"
            : approved
              ? "Recalcular y aprobar de nuevo"
              : "Aprobar el plan del mes"}
        </button>
      </form>

      {approved && planId ? <UnapproveButton planId={planId} /> : null}

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

function UnapproveButton({ planId }: { planId: string }) {
  const [state, action, pending] = useActionState(
    unapproveMonthAction,
    initial,
  );
  return (
    <form action={action}>
      <input type="hidden" name="planId" value={planId} />
      <button
        type="submit"
        disabled={pending}
        className="text-sm underline opacity-60 disabled:opacity-30"
      >
        {pending ? "Deshaciendo…" : "Deshacer la aprobación"}
      </button>
      {state.status === "error" ? (
        <p className="text-sm text-red-600 dark:text-red-400">{state.message}</p>
      ) : null}
    </form>
  );
}
