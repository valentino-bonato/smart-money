"use client";

import { useActionState, useMemo, useState } from "react";
import { recordExpenseAction, type QuickEntryState } from "./actions";
import { Amount } from "@/components/money";
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
      <FormStatus
        status={state.status}
        message={state.status === "idle" ? undefined : state.message}
      />
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
    <form action={action}>
      <input type="hidden" name="currency" value={currency} />

      <FieldGroup className="gap-4">
        {/* El monto es lo primero y ocupa el alto de dos campos: es el único
            dato que no se puede sugerir, y el teclado tiene que abrirse ahí. */}
        <Field>
          <FieldLabel htmlFor="amount">
            Monto{" "}
            <span className="font-normal text-muted-foreground">
              en {currency === "USD" ? "dólares" : "pesos"}
            </span>
          </FieldLabel>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-2xl text-muted-foreground">
              {currency === "USD" ? "US$" : "$"}
            </span>
            <Input
              id="amount"
              name="amount"
              inputMode="decimal"
              autoFocus
              autoComplete="off"
              placeholder="25.000"
              required
              className="money h-16 pl-14 text-3xl! font-medium"
            />
          </div>
        </Field>

        <Field>
          <FieldLabel htmlFor="payee">Comercio</FieldLabel>
          <Input
            id="payee"
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
            className="h-9"
          />
          <datalist id="payees">
            {suggestions.map((s) => (
              <option key={s.payee} value={s.payee} />
            ))}
          </datalist>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="expenseAccountId">Categoría</FieldLabel>
            <NativeSelect
              id="expenseAccountId"
              name="expenseAccountId"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              required
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name.replace(/^Gastos:/, "")}
                  {c.currency === "USD" ? " (USD)" : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field>
            <FieldLabel htmlFor="envelopeId">Sobre</FieldLabel>
            <NativeSelect
              id="envelopeId"
              name="envelopeId"
              value={envelopeId}
              onChange={(e) => setEnvelopeId(e.target.value)}
              required
            >
              <option value="">Elegí un sobre…</option>
              {envelopes.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        {/* El saldo del sobre, en el momento en que importa: justo antes de
            gastar. Responde "¿me queda plata de amigos?" sin cambiar de
            pantalla. Puede ser negativo, y se dice. */}
        {envelope ? (
          <div
            className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-sm ${
              negative
                ? "bg-negative/10 text-negative"
                : "bg-muted text-muted-foreground"
            }`}
          >
            <span>
              Queda en <strong className="font-medium">{envelope.name}</strong>
            </span>
            <Amount
              amount={envelope.balance}
              currency={envelope.currency}
              className="font-medium"
            />
            {negative ? (
              <span className="w-full text-xs">
                En negativo — hay que cubrirlo de otro sobre.
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="paidFromAccountId">Salió de</FieldLabel>
            <NativeSelect
              id="paidFromAccountId"
              name="paidFromAccountId"
              value={effectiveSourceId}
              onChange={(e) => setSourceId(e.target.value)}
              required
            >
              {validSources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field>
            <FieldLabel htmlFor="date">Fecha</FieldLabel>
            <Input
              id="date"
              type="date"
              name="date"
              defaultValue={today}
              required
              className="h-9"
            />
          </Field>
        </div>

        <Field>
          <Button type="submit" size="lg" disabled={pending} className="h-11">
            {pending ? "Guardando…" : "Cargar gasto"}
          </Button>
          <FieldDescription className="text-xs">
            La moneda no se pide: la define la categoría, y las cuentas de
            origen se filtran a esa misma moneda.
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  );
}
