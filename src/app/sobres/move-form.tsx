"use client";

import { useActionState, useState } from "react";
import { moveAllocationAction, type MoveState } from "./actions";
import { POOL } from "./pool";
import { FormStatus } from "@/components/form-status";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

export type MoveTarget = { id: string; name: string };

const initial: MoveState = { status: "idle" };

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
      <FormStatus
        status={state.status}
        message={state.status === "idle" ? undefined : state.message}
      />
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
    <form action={action}>
      <FieldGroup className="gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor="move-from">De</FieldLabel>
            <NativeSelect
              id="move-from"
              name="from"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="move-to">A</FieldLabel>
            <NativeSelect
              id="move-to"
              name="to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            >
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>

        <div className="grid grid-cols-[1fr_auto_auto] gap-3">
          <Field>
            <FieldLabel htmlFor="move-amount">Monto</FieldLabel>
            <Input
              id="move-amount"
              name="amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="30,18"
              defaultValue={defaultAmount}
              required
              className="money h-9"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="move-currency">Moneda</FieldLabel>
            <NativeSelect
              id="move-currency"
              name="currency"
              defaultValue={defaultCurrency ?? "ARS"}
              className="w-auto"
            >
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="move-date">Fecha</FieldLabel>
            <Input
              id="move-date"
              type="date"
              name="date"
              defaultValue={today}
              required
              className="h-9"
            />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="move-note">Nota (opcional)</FieldLabel>
          <Input
            id="move-note"
            name="note"
            autoComplete="off"
            placeholder="Cubro el Notion atípico"
            className="h-9"
          />
        </Field>

        <Button type="submit" disabled={pending || sameTarget} className="h-10">
          {pending ? "Moviendo…" : "Mover"}
        </Button>
        {sameTarget ? (
          <p className="text-sm text-muted-foreground">
            El origen y el destino son el mismo.
          </p>
        ) : null}
      </FieldGroup>
    </form>
  );
}
