"use client";

import { useActionState, useState } from "react";
import { moveMoneyAction, type MoveMoneyState } from "./actions";
import { formatMoney } from "@/lib/money";

export type AccountOption = {
  id: string;
  name: string;
  currency: "ARS" | "USD";
  type: "asset" | "liability";
  balance: string;
};

export type EnvelopeOption = { id: string; name: string };

const initial: MoveMoneyState = { status: "idle" };

const field =
  "rounded-lg border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 outline-none focus:border-black/50 dark:focus:border-white/50";
const label = "text-xs uppercase tracking-wide opacity-60";

export function MoveMoneyForm(props: {
  accounts: AccountOption[];
  envelopes: EnvelopeOption[];
  today: string;
  rate: string;
}) {
  const [state, action, pending] = useActionState(moveMoneyAction, initial);
  return (
    <div className="flex flex-col gap-3">
      <Fields
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

function Fields({
  accounts,
  envelopes,
  today,
  rate,
  action,
  pending,
}: {
  accounts: AccountOption[];
  envelopes: EnvelopeOption[];
  today: string;
  rate: string;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  const [fromId, setFromId] = useState(accounts[0]?.id ?? "");
  const [toId, setToId] = useState(accounts[1]?.id ?? "");
  const [amount, setAmount] = useState("");

  const from = accounts.find((a) => a.id === fromId);
  const to = accounts.find((a) => a.id === toId);
  const sameAccount = fromId === toId;
  const isExchange = !!from && !!to && from.currency !== to.currency;
  const isCardPayment = to?.type === "liability";

  // Sugerencia al dólar oficial, solo como ayuda: el monto que vale es el del
  // cambio que de verdad se hizo, y ese lo escribe el usuario.
  const suggested = (() => {
    if (!isExchange || !from || !to) return null;
    const n = Number(amount.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return null;
    const r = Number(rate);
    const value = from.currency === "ARS" ? n / r : n * r;
    return value.toLocaleString("es-AR", { maximumFractionDigits: 2 });
  })();

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>De</span>
          <select
            name="fromAccountId"
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
            className={field}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {from ? (
            <span className="text-xs opacity-50 tabular-nums">
              tiene {formatMoney(from.balance, from.currency)}
            </span>
          ) : null}
        </label>

        <label className="flex flex-col gap-1">
          <span className={label}>A</span>
          <select
            name="toAccountId"
            value={toId}
            onChange={(e) => setToId(e.target.value)}
            className={field}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {to ? (
            <span className="text-xs opacity-50 tabular-nums">
              tiene {formatMoney(to.balance, to.currency)}
            </span>
          ) : null}
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>
            {isExchange ? `Sale (${from?.currency})` : "Monto"}
          </span>
          <input
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="80.000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            className={`${field} text-xl tabular-nums`}
          />
        </label>

        {isExchange ? (
          <label className="flex flex-col gap-1">
            <span className={label}>Entra ({to?.currency})</span>
            <input
              name="receivedAmount"
              inputMode="decimal"
              autoComplete="off"
              placeholder={suggested ?? "1.290,32"}
              required
              className={`${field} text-xl tabular-nums`}
            />
            {suggested ? (
              <span className="text-xs opacity-50">
                al oficial serían {suggested}
              </span>
            ) : null}
          </label>
        ) : (
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
        )}
      </div>

      {isExchange ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className={label}>¿De qué sobre es esta plata?</span>
            <select name="envelopeId" defaultValue="" className={field}>
              <option value="">De ninguno en particular</option>
              {envelopes.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <span className="text-xs opacity-50">
              Pasa su asignación a la nueva moneda.
            </span>
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
      ) : null}

      <label className="flex flex-col gap-1">
        <span className={label}>Descripción (opcional)</span>
        <input
          name="description"
          autoComplete="off"
          placeholder={
            isCardPayment
              ? "Pago del resumen"
              : isExchange
                ? "Compra de dólares"
                : "Reposición de Mercado Pago"
          }
          className={field}
        />
      </label>

      <button
        type="submit"
        disabled={pending || sameAccount}
        className="rounded-lg bg-foreground text-background px-4 py-3 font-medium disabled:opacity-50"
      >
        {pending
          ? "Registrando…"
          : isExchange
            ? "Registrar el cambio"
            : isCardPayment
              ? "Registrar el pago"
              : "Registrar la transferencia"}
      </button>

      <p className="text-xs opacity-55">
        {sameAccount
          ? "Las dos cuentas son la misma."
          : isExchange
            ? "La app mete sola las partidas de cambio. El invariante es por moneda: un asiento no puede tener pesos de un lado y dólares del otro."
            : "Esto no es un gasto y no toca ningún sobre: la plata cambia de cuenta, no de propósito."}
      </p>
    </form>
  );
}
