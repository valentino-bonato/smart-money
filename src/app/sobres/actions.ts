"use server";

import { refresh } from "next/cache";
import { db } from "@/db";
import {
  assignFromPool,
  moveBetweenEnvelopes,
  returnToPool,
} from "@/db/envelopes";
import { MoneyParseError, parseAmountInput } from "@/lib/money";
import { getCurrentUser } from "@/lib/user";
import { POOL } from "./pool";

export type MoveState =
  | { status: "idle" }
  | { status: "ok"; message: string; token: string }
  | { status: "error"; message: string };

/**
 * Mover plata de propósito. El origen y el destino pueden ser un sobre o el
 * pool sin asignar, y de ahí salen las tres formas de §6: asignar del pool es
 * una fila positiva, devolver al pool una negativa, y mover entre sobres dos.
 */
export async function moveAllocationAction(
  _prev: MoveState,
  form: FormData,
): Promise<MoveState> {
  try {
    await getCurrentUser();

    const from = String(form.get("from") ?? "");
    const to = String(form.get("to") ?? "");
    const currency = String(form.get("currency") ?? "");
    const date = String(form.get("date") ?? "");
    const noteRaw = form.get("note");
    const note =
      typeof noteRaw === "string" && noteRaw.trim() ? noteRaw.trim() : null;

    if (currency !== "ARS" && currency !== "USD") {
      return { status: "error", message: "Moneda inválida" };
    }
    if (!from || !to) {
      return { status: "error", message: "Falta el origen o el destino" };
    }
    if (from === to) {
      return { status: "error", message: "El origen y el destino son el mismo" };
    }

    const amount = parseAmountInput(String(form.get("amount") ?? ""));

    if (from === POOL) {
      await assignFromPool(db, { envelopeId: to, amount, currency, date, note });
    } else if (to === POOL) {
      await returnToPool(db, { envelopeId: from, amount, currency, date, note });
    } else {
      await moveBetweenEnvelopes(db, {
        fromEnvelopeId: from,
        toEnvelopeId: to,
        amount,
        currency,
        date,
        note,
      });
    }

    refresh();
    return { status: "ok", message: "Listo", token: crypto.randomUUID() };
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
