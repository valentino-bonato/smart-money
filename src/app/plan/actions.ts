"use server";

import { refresh } from "next/cache";
import { db } from "@/db";
import { unapprovePlan } from "@/db/envelopes";
import { approvePlan, computePlan, savePlan } from "@/db/planner";
import { rateForView } from "@/db/queries";
import { MoneyParseError, parseAmountInput } from "@/lib/money";
import { getCurrentUser } from "@/lib/user";

export type PlanActionState =
  | { status: "idle" }
  | { status: "ok"; message: string; token: string }
  | { status: "error"; message: string };

function fail(err: unknown): PlanActionState {
  if (err instanceof MoneyParseError) {
    return { status: "error", message: err.message };
  }
  const e = err as Error & { cause?: Error };
  return {
    status: "error",
    message: (e.cause?.message ?? e.message).split("\n")[0],
  };
}

const TIER_LABEL: Record<string, string> = {
  base: "piso",
  recurring_variable: "variable",
  milestone: "hitos",
};

/**
 * Recalcula el mes y lo aprueba. Es una sola acción porque es una sola
 * decisión: el plan no se guarda a medias.
 *
 * Los puntuales del mes entran como pares sobre/monto del formulario: no hay
 * regla que invente el cumple de Rochi.
 */
export async function approveMonthAction(
  _prev: PlanActionState,
  form: FormData,
): Promise<PlanActionState> {
  try {
    const user = await getCurrentUser();
    const period = String(form.get("period") ?? "");
    if (!/^\d{4}-\d{2}-01$/.test(period)) {
      return { status: "error", message: "Período inválido" };
    }

    const extras: { envelopeId: string; amount: string; note: string }[] = [];
    const ids = form.getAll("extraEnvelopeId").map(String);
    const amounts = form.getAll("extraAmount").map(String);
    const notes = form.getAll("extraNote").map(String);
    for (let i = 0; i < ids.length; i++) {
      if (!ids[i] || !amounts[i]?.trim()) continue;
      extras.push({
        envelopeId: ids[i],
        amount: parseAmountInput(amounts[i]),
        note: notes[i]?.trim() || "puntual del mes",
      });
    }

    const rate = await rateForView(db, { date: period });
    const computed = await computePlan(db, {
      userId: user.id,
      period,
      rate,
      extras,
    });
    const planId = await savePlan(db, { userId: user.id, period, plan: computed });
    const { materialized, pending } = await approvePlan(db, {
      userId: user.id,
      planId,
      period,
    });

    refresh();
    const parts = [
      materialized.length
        ? `asignado: ${materialized.map((t) => TIER_LABEL[t]).join(", ")}`
        : "no se asignó nada todavía",
    ];
    if (pending.length) {
      parts.push(
        `${pending.map((t) => TIER_LABEL[t]).join(", ")} espera a que entre el cobro`,
      );
    }
    return {
      status: "ok",
      message: `Plan aprobado · ${parts.join(" · ")}`,
      token: crypto.randomUUID(),
    };
  } catch (err) {
    return fail(err);
  }
}

/** Deshace la aprobación: borra las allocations del plan y lo vuelve a borrador. */
export async function unapproveMonthAction(
  _prev: PlanActionState,
  form: FormData,
): Promise<PlanActionState> {
  try {
    await getCurrentUser();
    const planId = String(form.get("planId") ?? "");
    if (!planId) return { status: "error", message: "Falta el plan" };
    await unapprovePlan(db, planId);
    refresh();
    return {
      status: "ok",
      message: "Aprobación deshecha",
      token: crypto.randomUUID(),
    };
  } catch (err) {
    return fail(err);
  }
}
