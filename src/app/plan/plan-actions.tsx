"use client";

import { useActionState, useState } from "react";
import { PlusIcon } from "lucide-react";
import {
  approveMonthAction,
  unapproveMonthAction,
  type PlanActionState,
} from "./actions";
import { FormStatus } from "@/components/form-status";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldGroup,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

const initial: PlanActionState = { status: "idle" };

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
      <form action={action}>
        <input type="hidden" name="period" value={period} />

        <FieldGroup className="gap-4">
          {/* Los puntuales son los sobres sin regla de aporte: el cumpleaños de
              Rochi no entra en la cascada, se agrega a mano el mes que toca. */}
          {envelopes.length ? (
            <FieldSet>
              <FieldLegend variant="label">Puntuales del mes</FieldLegend>
              <FieldGroup className="gap-2">
                {extras.map((key) => (
                  <div key={key} className="grid grid-cols-3 gap-2">
                    <NativeSelect name="extraEnvelopeId" defaultValue="">
                      <option value="">—</option>
                      {envelopes.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </NativeSelect>
                    <Input
                      name="extraAmount"
                      inputMode="decimal"
                      placeholder="200.000"
                      autoComplete="off"
                      className="money h-9"
                    />
                    <Input
                      name="extraNote"
                      placeholder="cumple de Rochi"
                      autoComplete="off"
                      className="h-9"
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setExtras((e) => [...e, (e.at(-1) ?? 0) + 1])}
                  className="self-start"
                >
                  <PlusIcon /> Agregar otro
                </Button>
              </FieldGroup>
            </FieldSet>
          ) : null}

          <Field>
            <Button type="submit" size="lg" disabled={pending} className="h-11">
              {pending
                ? "Calculando…"
                : approved
                  ? "Recalcular y aprobar de nuevo"
                  : "Aprobar el plan del mes"}
            </Button>
          </Field>
        </FieldGroup>
      </form>

      {approved && planId ? <UnapproveButton planId={planId} /> : null}

      <FormStatus
        status={state.status}
        message={state.status === "idle" ? undefined : state.message}
      />
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
      <Button type="submit" variant="link" size="sm" disabled={pending}>
        {pending ? "Deshaciendo…" : "Deshacer la aprobación"}
      </Button>
      {state.status === "error" ? (
        <p className="text-sm text-destructive">{state.message}</p>
      ) : null}
    </form>
  );
}
