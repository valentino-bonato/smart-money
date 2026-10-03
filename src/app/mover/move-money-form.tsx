"use client";

import { useActionState, useState } from "react";
import { moveMoneyAction, type MoveMoneyState } from "./actions";
import { formatMoney } from "@/lib/money";
import { AccountDot } from "@/components/account-name";
import { FormStatus } from "@/components/form-status";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

export type AccountOption = {
  id: string;
  name: string;
  currency: "ARS" | "USD";
  type: "asset" | "liability";
  balance: string;
};

export type EnvelopeOption = { id: string; name: string };

const initial: MoveMoneyState = { status: "idle" };

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
      <FormStatus
        status={state.status}
        message={state.status === "idle" ? undefined : state.message}
      />
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
    <form action={action}>
      <FieldGroup className="gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="fromAccountId">De</FieldLabel>
            <NativeSelect
              id="fromAccountId"
              name="fromAccountId"
              value={fromId}
              onChange={(e) => setFromId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
            {/* El color no puede ir en el `<option>` —ningún navegador lo
                pinta—, así que va en la línea del saldo, que de paso cambia con
                la selección. */}
            {from ? (
              <FieldDescription className="flex items-baseline gap-1.5 text-xs">
                <AccountDot name={from.name} />
                <span className="money">
                  tiene {formatMoney(from.balance, from.currency)}
                </span>
              </FieldDescription>
            ) : null}
          </Field>

          <Field>
            <FieldLabel htmlFor="toAccountId">A</FieldLabel>
            <NativeSelect
              id="toAccountId"
              name="toAccountId"
              value={toId}
              onChange={(e) => setToId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
            {to ? (
              <FieldDescription className="flex items-baseline gap-1.5 text-xs">
                <AccountDot name={to.name} />
                <span className="money">
                  tiene {formatMoney(to.balance, to.currency)}
                </span>
              </FieldDescription>
            ) : null}
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="amount">
              {isExchange ? `Sale (${from?.currency})` : "Monto"}
            </FieldLabel>
            <Input
              id="amount"
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="80.000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              className="money h-11 text-xl!"
            />
          </Field>

          {isExchange ? (
            <Field>
              <FieldLabel htmlFor="receivedAmount">
                Entra ({to?.currency})
              </FieldLabel>
              <Input
                id="receivedAmount"
                name="receivedAmount"
                inputMode="decimal"
                autoComplete="off"
                placeholder={suggested ?? "1.290,32"}
                required
                className="money h-11 text-xl!"
              />
              {/* Sugerencia al oficial, nada más: el monto que vale es el del
                  cambio que de verdad se hizo. */}
              {suggested ? (
                <FieldDescription className="money text-xs">
                  al oficial serían {suggested}
                </FieldDescription>
              ) : null}
            </Field>
          ) : (
            <Field>
              <FieldLabel htmlFor="date">Fecha</FieldLabel>
              <Input
                id="date"
                type="date"
                name="date"
                defaultValue={today}
                required
                className="h-11"
              />
            </Field>
          )}
        </div>

        {isExchange ? (
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="envelopeId">
                ¿De qué sobre es esta plata?
              </FieldLabel>
              <NativeSelect id="envelopeId" name="envelopeId" defaultValue="">
                <option value="">De ninguno en particular</option>
                {envelopes.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </NativeSelect>
              <FieldDescription className="text-xs">
                Pasa su asignación a la nueva moneda. Sin esto el sobre dice
                tener pesos que ya no existen.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="exchange-date">Fecha</FieldLabel>
              <Input
                id="exchange-date"
                type="date"
                name="date"
                defaultValue={today}
                required
                className="h-9"
              />
            </Field>
          </div>
        ) : null}

        <Field>
          <FieldLabel htmlFor="description">Descripción (opcional)</FieldLabel>
          <Input
            id="description"
            name="description"
            autoComplete="off"
            placeholder={
              isCardPayment
                ? "Pago del resumen"
                : isExchange
                  ? "Compra de dólares"
                  : "Reposición de Mercado Pago"
            }
            className="h-9"
          />
        </Field>

        <Field>
          <Button
            type="submit"
            size="lg"
            disabled={pending || sameAccount}
            className="h-11"
          >
            {pending
              ? "Registrando…"
              : isExchange
                ? "Registrar el cambio"
                : isCardPayment
                  ? "Registrar el pago"
                  : "Registrar la transferencia"}
          </Button>
          <FieldDescription className="text-xs">
            {sameAccount
              ? "Las dos cuentas son la misma."
              : isExchange
                ? "La app mete sola las partidas de cambio. El invariante es por moneda: un asiento no puede tener pesos de un lado y dólares del otro."
                : "Esto no es un gasto y no toca ningún sobre: la plata cambia de cuenta, no de propósito."}
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  );
}
