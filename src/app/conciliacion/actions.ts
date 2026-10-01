"use server";

import { refresh } from "next/cache";
import { db } from "@/db";
import {
  recordReconciliation,
  resolveReconciliation,
  type ReconciliationResult,
} from "@/db/reconcile";
import { MoneyParseError, parseAmountInput } from "@/lib/money";
import { getCurrentUser } from "@/lib/user";

export type ReconcileState =
  | { status: "idle" }
  | { status: "ok"; results: ReconciliationResult[]; token: string }
  | { status: "error"; message: string };

/**
 * Pega los saldos del homebanking y devuelve la diferencia por cuenta.
 *
 * Las cuentas que se dejan en blanco no se concilian: pegar tres saldos y no el
 * cuarto es lo normal, y guardar un cero por la que no se miró sería mentira.
 *
 * El monto se parsea con el mismo `parseAmountInput` que la carga, así que un
 * saldo ambiguo falla en vez de adivinarse. Para un pasivo se acepta el signo
 * negativo, que es como se debe escribir una deuda.
 */
export async function reconcileAction(
  _prev: ReconcileState,
  form: FormData,
): Promise<ReconcileState> {
  try {
    const user = await getCurrentUser();
    const date = String(form.get("date") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { status: "error", message: "Fecha inválida" };
    }

    const ids = form.getAll("accountId").map(String);
    const raw = form.getAll("statementBalance").map(String);

    const balances: { accountId: string; statementBalance: string }[] = [];
    for (let i = 0; i < ids.length; i++) {
      const value = raw[i]?.trim();
      if (!value) continue;
      // El cero es un saldo válido y parseAmountInput lo rechaza a propósito
      // (un gasto de 0 no existe), así que acá se acepta explícito.
      const amount = /^-?0+([.,]0+)?$/.test(value)
        ? "0"
        : parseAmountInput(value);
      balances.push({ accountId: ids[i], statementBalance: amount });
    }

    if (!balances.length) {
      return { status: "error", message: "No pegaste ningún saldo" };
    }

    const results = await recordReconciliation(db, {
      userId: user.id,
      date,
      balances,
    });

    refresh();
    return { status: "ok", results, token: crypto.randomUUID() };
  } catch (err) {
    if (err instanceof MoneyParseError) {
      return { status: "error", message: err.message };
    }
    const e = err as Error & { cause?: Error };
    return {
      status: "error",
      message: (e.cause?.message ?? e.message).split("\n")[0],
    };
  }
}

/** Marca una diferencia como aceptada, sin cargar nada más. */
export async function resolveAction(form: FormData): Promise<void> {
  await getCurrentUser();
  const id = String(form.get("id") ?? "");
  if (!id) return;
  await resolveReconciliation(db, { id });
  refresh();
}
