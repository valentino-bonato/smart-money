"use client";

import { useActionState } from "react";
import { CheckCircle2, ChevronDown, Lightbulb } from "lucide-react";
import {
  adjustAction,
  ignoreAction,
  reconcileAction,
  type ReconcileState,
} from "./actions";
import { formatMoney } from "@/lib/money";
import { AccountLogo } from "@/components/account-name";
import { Amount } from "@/components/money";
import { FormStatus } from "@/components/form-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AccountRow = {
  accountId: string;
  name: string;
  /** El nombre de la cuenta sin el del banco: el logo ya lo dijo. */
  detail: string;
  currency: "ARS" | "USD";
  type: "asset" | "liability";
  computedBalance: string;
  lastReconciledAt: string | null;
  lastReconciledLabel: string | null;
  pending: {
    id: string;
    date: string;
    difference: string;
    statementBalance: string;
    currency: "ARS" | "USD";
  }[];
  hints: { name: string; amount: string }[];
};

export type Group = {
  key: string;
  label: string;
  /** Un nombre de cuenta del grupo, para que el logo lo resuelva. */
  sample: string;
  accounts: AccountRow[];
};

const initial: ReconcileState = { status: "idle" };

/**
 * El cuadre, agrupado por institución y plegable.
 *
 * **El orden sigue el recorrido real**: se abre un homebanking, se miran sus
 * cuentas, se pasa al siguiente. El formulario plano de doce campos pedía un
 * orden que el banco no deja seguir.
 *
 * Los grupos son `<details>` nativos y no un acordeón de React: funcionan sin
 * JavaScript, el navegador recuerda el foco, y no hay estado que sincronizar
 * con el formulario que los envuelve. Arrancan abiertos los que tienen algo
 * pendiente.
 *
 * **Ajustar e Ignorar no pueden ser formularios anidados** — el HTML no lo
 * permite dentro del form del cuadre. Se resuelven con el atributo `form=` de
 * HTML5: el botón vive en la fila y apunta a un `<form>` que se renderiza
 * afuera. Nativo, sin JS, y sin mover la acción lejos del problema.
 */
export function ReconcileForm({
  groups,
  today,
}: {
  groups: Group[];
  today: string;
}) {
  const [state, action, pending] = useActionState(reconcileAction, initial);
  const all = groups.flatMap((g) => g.accounts);

  return (
    <div className="flex flex-col gap-4">
      <form action={action} key={state.status === "ok" ? state.token : "first"}>
        <div className="flex flex-col gap-4">
          <div className="flex max-w-48 flex-col gap-1.5">
            <Label htmlFor="reconcile-date">Saldos al</Label>
            <Input
              id="reconcile-date"
              type="date"
              name="date"
              defaultValue={today}
              required
              className="h-9"
            />
          </div>

          {groups.map((g) => {
            const needsAttention = g.accounts.some(
              (a) => a.pending.length || !a.lastReconciledAt,
            );
            return (
              <details
                key={g.key}
                open={needsAttention}
                className="overflow-hidden rounded-xl border"
              >
                <summary className="flex cursor-pointer list-none items-center gap-3 bg-muted/40 p-3">
                  <AccountLogo name={g.sample} />
                  <span className="text-sm font-semibold">{g.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {g.accounts.length}{" "}
                    {g.accounts.length === 1 ? "cuenta" : "cuentas"}
                  </span>
                  <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                    {g.accounts.every((a) => a.lastReconciledAt) ? (
                      <CheckCircle2
                        className="size-4 text-positive"
                        aria-hidden
                      />
                    ) : null}
                    <ChevronDown className="size-4" aria-hidden />
                  </span>
                </summary>

                <ul className="divide-y">
                  {g.accounts.map((a) => (
                    <li key={a.accountId} className="flex flex-col gap-2 p-3">
                      <input
                        type="hidden"
                        name="accountId"
                        value={a.accountId}
                      />

                      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                          <Label
                            htmlFor={`statement-${a.accountId}`}
                            className="flex flex-wrap items-baseline gap-x-2"
                          >
                            <span className="font-medium">{a.detail}</span>
                            <span className="money text-xs font-normal text-muted-foreground">
                              app: {formatMoney(a.computedBalance, a.currency)}
                              {a.type === "liability"
                                ? " · negativo si debés"
                                : ""}
                            </span>
                          </Label>
                          <Input
                            id={`statement-${a.accountId}`}
                            name="statementBalance"
                            inputMode="decimal"
                            autoComplete="off"
                            placeholder={`saldo del homebanking en ${a.currency}`}
                            className="money h-9"
                          />
                        </div>

                        <span className="text-xs text-muted-foreground">
                          {a.lastReconciledLabel
                            ? `conciliada ${a.lastReconciledLabel}`
                            : "sin conciliar nunca"}
                        </span>
                      </div>

                      {a.pending.map((p) => (
                        <div
                          key={p.id}
                          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-l-2 border-l-negative bg-muted/30 p-2.5"
                        >
                          <Amount
                            amount={p.difference}
                            currency={p.currency}
                            sign
                            tone="negative"
                            className="text-sm font-medium"
                          />
                          <span className="text-xs text-muted-foreground">
                            {Number(p.difference) > 0
                              ? "el banco tiene más: falta un ingreso"
                              : "el banco tiene menos: falta un gasto"}
                            <span className="money">{` · ${p.date}`}</span>
                          </span>
                          <span className="ml-auto flex gap-2">
                            <Button
                              type="submit"
                              form={`adjust-${p.id}`}
                              variant="outline"
                              size="xs"
                            >
                              Ajustar
                            </Button>
                            <Button
                              type="submit"
                              form={`ignore-${p.id}`}
                              variant="ghost"
                              size="xs"
                            >
                              Ignorar
                            </Button>
                          </span>
                        </div>
                      ))}

                      {/* La hipótesis, pegada a la cuenta que no cierra. No
                          adivina gastos sueltos: es lo que la app ya sabe que
                          tenía que pasar este mes y todavía no vio. */}
                      {a.hints.map((h) => (
                        <p
                          key={h.name}
                          className="flex items-start gap-2 rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground"
                        >
                          <Lightbulb className="size-4 shrink-0" aria-hidden />
                          <span>
                            Si no cierra, puede ser{" "}
                            <strong className="font-medium text-foreground">
                              {h.name}
                            </strong>
                            : gasto fijo del mes por{" "}
                            <span className="money">{h.amount}</span> desde esta
                            cuenta, todavía sin cargar.
                          </span>
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              </details>
            );
          })}

          <div className="flex flex-col gap-2">
            <Button type="submit" size="lg" disabled={pending} className="h-11">
              {pending ? "Comparando…" : "Comparar con el homebanking"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Las que dejes en blanco no se concilian — guardar un cero por una
              cuenta que no se miró sería mentira.
            </p>
          </div>
        </div>
      </form>

      <FormStatus
        status={state.status === "error" ? "error" : "idle"}
        message={state.status === "error" ? state.message : undefined}
      />

      {state.status === "ok" ? (
        <section className="flex flex-col gap-2 rounded-xl border p-4">
          <h3 className="text-sm font-medium">Resultado</h3>
          <ul className="divide-y">
            {state.results.map((r) => (
              <li key={r.accountId} className="flex flex-col gap-0.5 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm">{r.name}</span>
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
                      homebanking {formatMoney(r.statementBalance, r.currency)}{" "}
                      · app {formatMoney(r.computedBalance, r.currency)}
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

      {/* Los formularios que disparan los botones de arriba. Van acá, fuera del
          form del cuadre, porque el HTML no permite anidarlos. */}
      {all.flatMap((a) =>
        a.pending.map((p) => (
          <div key={p.id} className="hidden">
            <form id={`adjust-${p.id}`} action={adjustAction}>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="accountId" value={a.accountId} />
              <input
                type="hidden"
                name="toBalance"
                value={p.statementBalance}
              />
              <input type="hidden" name="date" value={p.date} />
            </form>
            <form id={`ignore-${p.id}`} action={ignoreAction}>
              <input type="hidden" name="id" value={p.id} />
            </form>
          </div>
        )),
      )}
    </div>
  );
}
