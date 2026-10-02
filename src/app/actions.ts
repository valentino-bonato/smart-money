"use server";

import { and, eq, like } from "drizzle-orm";
import { refresh } from "next/cache";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { recordExpense } from "@/db/ledger";
import { MoneyParseError, parseAmountInput } from "@/lib/money";
import { getCurrentUser } from "@/lib/user";

export type QuickEntryState =
  | { status: "idle" }
  /**
   * `token` cambia en cada carga exitosa. El formulario lo usa como `key` para
   * remontarse: así se limpia y vuelve el foco al monto sin ningún efecto que
   * escriba estado, que es lo que pide la regla react-hooks/set-state-in-effect.
   */
  | { status: "ok"; message: string; token: string }
  | { status: "error"; message: string };

function required(form: FormData, field: string, label: string): string {
  const value = form.get(field);
  if (typeof value !== "string" || !value.trim()) {
    throw new MoneyParseError(`Falta ${label}`);
  }
  return value.trim();
}

/**
 * Carga rápida de un gasto. El criterio de §7 es menos de 10 segundos, así que
 * el formulario pide lo mínimo: monto, comercio, categoría, sobre y de dónde
 * salió. La fecha default es hoy.
 *
 * La moneda no se pide: la define la cuenta de gasto elegida (una cuenta = una
 * moneda), y el trigger `entries_validate_account` rechaza cualquier mezcla.
 */
export async function recordExpenseAction(
  _prev: QuickEntryState,
  form: FormData,
): Promise<QuickEntryState> {
  try {
    const user = await getCurrentUser();

    const amount = parseAmountInput(required(form, "amount", "el monto"));
    const expenseAccountId = required(form, "expenseAccountId", "la categoría");
    const envelopeId = required(form, "envelopeId", "el sobre");
    const paidFromAccountId = required(form, "paidFromAccountId", "la cuenta");
    const date = required(form, "date", "la fecha");
    const payeeRaw = form.get("payee");
    const payee =
      typeof payeeRaw === "string" && payeeRaw.trim() ? payeeRaw.trim() : null;

    const currencyRaw = form.get("currency");
    if (currencyRaw !== "ARS" && currencyRaw !== "USD") {
      return { status: "error", message: "Moneda inválida" };
    }

    await recordExpense(db, {
      userId: user.id,
      date,
      amount,
      currency: currencyRaw,
      paidFromAccountId,
      expenseAccountId,
      envelopeId,
      payee,
    });

    refresh();
    return {
      status: "ok",
      message: `Cargado${payee ? `: ${payee}` : ""}`,
      token: crypto.randomUUID(),
    };
  } catch (err) {
    // Los errores de los triggers vienen envueltos por postgres-js: el mensaje
    // útil está en `cause`.
    const e = err as Error & { cause?: Error };
    return {
      status: "error",
      message: (e.cause?.message ?? e.message).split("\n")[0],
    };
  }
}

/**
 * Borra un movimiento entero. Las partidas se van por cascada y el constraint
 * trigger deferido valida al COMMIT con el asiento ya vacío, así que no hay
 * estado intermedio desbalanceado.
 *
 * El saldo de apertura no se puede borrar: es el punto de partida de todo el
 * libro, y borrarlo deja cada cuenta en cero sin que se note hasta que algo no
 * cuadra. Para eso está `npm run db:seed`.
 */
export async function deleteTransactionAction(form: FormData): Promise<void> {
  const user = await getCurrentUser();
  const id = String(form.get("id") ?? "");
  if (!id) return;

  const [opening] = await db
    .select({ id: schema.entries.id })
    .from(schema.entries)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.entries.accountId))
    .where(
      and(
        eq(schema.entries.transactionId, id),
        like(schema.accounts.name, "Equity:Opening%"),
      ),
    )
    .limit(1);
  if (opening) {
    throw new Error("El saldo de apertura no se borra desde acá.");
  }

  await db
    .delete(schema.transactions)
    .where(
      and(eq(schema.transactions.id, id), eq(schema.transactions.userId, user.id)),
    );
  refresh();
}
