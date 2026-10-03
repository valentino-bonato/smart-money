"use client";

import { useActionState } from "react";
import { reconcileAction, type ReconcileState } from "./actions";
import { formatMoney } from "@/lib/money";
import { AccountDot } from "@/components/account-name";
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

export type AccountRow = {
  accountId: string;
  name: string;
  currency: "ARS" | "USD";
  computedBalance: string;
  lastReconciledAt: string | null;
};

const initial: ReconcileState = { status: "idle" };

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

      <FormStatus
        status={state.status === "error" ? "error" : "idle"}
        message={state.status === "error" ? state.message : undefined}
      />

      {state.status === "ok" ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Resultado</h3>
          <ul className="divide-y">
            {state.results.map((r) => (
              <li key={r.accountId} className="flex flex-col gap-0.5 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex items-baseline gap-2 text-sm">
                    <AccountDot name={r.name} />
                    {r.name}
                  </span>
                  {r.matched ? (
                    <span className="shrink-0 text-sm text-positive">
                      coincide
                    </span>
                  ) : (
                    <Amount
                      amount={r.difference}
                      currency={r.currency}
                      sign
                      tone="negative"
                      className="shrink-0 text-sm"
                    />
                  )}
                </div>
                {!r.matched ? (
                  <span className="text-xs text-muted-foreground">
                    <span className="money">
                      homebanking {formatMoney(r.statementBalance, r.currency)} ·
                      app {formatMoney(r.computedBalance, r.currency)}
                    </span>{" "}
                    ·{" "}
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
    <form action={action}>
      <FieldGroup className="gap-4">
        <Field className="max-w-48">
          <FieldLabel htmlFor="reconcile-date">Fecha del saldo</FieldLabel>
          <Input
            id="reconcile-date"
            type="date"
            name="date"
            defaultValue={today}
            required
            className="h-9"
          />
        </Field>

        <FieldGroup className="gap-3">
          {accounts.map((a) => (
            <Field key={a.accountId}>
              <input type="hidden" name="accountId" value={a.accountId} />
              <div className="flex items-baseline justify-between gap-3">
                <FieldLabel
                  htmlFor={`statement-${a.accountId}`}
                  className="items-baseline"
                >
                  <AccountDot name={a.name} />
                  {a.name}
                </FieldLabel>
                <span className="money text-xs text-muted-foreground">
                  app: {formatMoney(a.computedBalance, a.currency)}
                </span>
              </div>
              <Input
                id={`statement-${a.accountId}`}
                name="statementBalance"
                inputMode="decimal"
                autoComplete="off"
                placeholder={`saldo del homebanking en ${a.currency}`}
                className="money h-9"
              />
            </Field>
          ))}
        </FieldGroup>

        <Field>
          <Button type="submit" size="lg" disabled={pending} className="h-11">
            {pending ? "Comparando…" : "Comparar con el homebanking"}
          </Button>
          <FieldDescription className="text-xs">
            Las que dejes en blanco no se concilian — guardar un cero por una
            cuenta que no se miró sería mentira. Para una tarjeta, el saldo va
            negativo si debés plata.
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  );
}
