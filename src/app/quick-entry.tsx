"use client";

import { useActionState, useMemo, useState } from "react";
import { recordExpenseAction, type QuickEntryState } from "./actions";
import { formatMoney } from "@/lib/money";

export type Option = { id: string; name: string; currency: "ARS" | "USD" };
export type EnvelopeOption = Option & { balance: string };
export type Suggestion = {
  payee: string;
  expenseAccountId: string | null;
  envelopeId: string | null;
  paidFromAccountId: string | null;
  currency: "ARS" | "USD" | null;
};

type Props = {
  categories: Option[];
  envelopes: EnvelopeOption[];
  /** Cuentas de las que puede salir la plata: asset y liability. */
  sources: Option[];
  suggestions: Suggestion[];
  today: string;
  defaultSourceId: string;
};

const initial: QuickEntryState = { status: "idle" };

const field =
  "rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 outline-none focus:border-black/50 dark:focus:border-white/50";
const label = "text-xs uppercase tracking-wide opacity-60";

export function QuickEntry(props: Props) {
  const [state, action, pending] = useActionState(recordExpenseAction, initial);

  return (
    <div className="flex flex-col gap-3">
      {/* Remontar los campos con el token de la última carga los limpia y
          devuelve el foco al monto, sin un efecto que escriba estado.
          Cargar dos gastos seguidos no cuesta más que el primero. */}
      <EntryFields
        key={state.status === "ok" ? state.token : "first"}
        {...props}
        action={action}
        pending={pending}
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

function EntryFields({
  categories,
  envelopes,
  sources,
  suggestions,
  today,
  defaultSourceId,
  action,
  pending,
}: Props & {
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  const [payee, setPayee] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [envelopeId, setEnvelopeId] = useState("");
  const [sourceId, setSourceId] = useState(defaultSourceId);

  const category = categories.find((c) => c.id === categoryId);
  const currency = category?.currency ?? "ARS";

  // Una cuenta = una moneda: solo se puede pagar desde una cuenta de la misma
  // moneda que la categoría. Filtrar acá evita que el trigger lo rechace.
  const validSources = useMemo(
    () => sources.filter((s) => s.currency === currency),
    [sources, currency],
  );
  // Derivado, no un efecto: si la categoría cambió de moneda y la cuenta
  // elegida ya no sirve, se usa la primera válida.
  const effectiveSourceId = validSources.some((s) => s.id === sourceId)
    ? sourceId
    : (validSources[0]?.id ?? "");

  const envelope = envelopes.find((e) => e.id === envelopeId);
  const negative = envelope ? Number(envelope.balance) < 0 : false;

  // La sugerencia por comercio: con un payee conocido no hay que elegir nada.
  // Arranca sin datos y aprende del uso; no hay lista precargada.
  function applySuggestion(name: string) {
    const match = suggestions.find(
      (s) => s.payee.toLowerCase() === name.trim().toLowerCase(),
    );
    if (!match) return;
    if (match.expenseAccountId) setCategoryId(match.expenseAccountId);
    if (match.envelopeId) setEnvelopeId(match.envelopeId);
    if (match.paidFromAccountId) setSourceId(match.paidFromAccountId);
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="currency" value={currency} />

      <label className="flex flex-col gap-1">
        <span className={label}>
          Monto {currency === "USD" ? "(USD)" : "(ARS)"}
        </span>
        <input
          name="amount"
          inputMode="decimal"
          autoFocus
          autoComplete="off"
          placeholder="25.000"
          required
          className={`${field} py-3 text-3xl tabular-nums`}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={label}>Comercio</span>
        <input
          name="payee"
          list="payees"
          autoComplete="off"
          placeholder="Coto"
          value={payee}
          onChange={(e) => {
            setPayee(e.target.value);
            applySuggestion(e.target.value);
          }}
          onBlur={(e) => applySuggestion(e.target.value)}
          className={field}
        />
        <datalist id="payees">
          {suggestions.map((s) => (
            <option key={s.payee} value={s.payee} />
          ))}
        </datalist>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>Categoría</span>
          <select
            name="expenseAccountId"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            required
            className={field}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name.replace(/^Gastos:/, "")}
                {c.currency === "USD" ? " (USD)" : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={label}>Sobre</span>
          <select
            name="envelopeId"
            value={envelopeId}
            onChange={(e) => setEnvelopeId(e.target.value)}
            required
            className={field}
          >
            <option value="">Elegí un sobre…</option>
            {envelopes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* El saldo del sobre, en el momento en que importa: justo antes de
          gastar. Responde "¿me queda plata de amigos?" sin cambiar de
          pantalla. Puede ser negativo, y se dice. */}
      {envelope ? (
        <p className="text-sm opacity-70">
          {envelope.name}: queda{" "}
          <strong className={negative ? "text-red-600 dark:text-red-400" : ""}>
            {formatMoney(envelope.balance, envelope.currency)}
          </strong>
          {negative ? " — en negativo, hay que cubrirlo de otro sobre" : ""}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>Salió de</span>
          <select
            name="paidFromAccountId"
            value={effectiveSourceId}
            onChange={(e) => setSourceId(e.target.value)}
            required
            className={field}
          >
            {validSources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
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

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-foreground text-background px-4 py-3 font-medium disabled:opacity-50"
      >
        {pending ? "Guardando…" : "Cargar gasto"}
      </button>
    </form>
  );
}
