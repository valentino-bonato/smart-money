/**
 * Preparar el resumen del mes a partir de los gastos recurrentes.
 *
 * El v1 tiene un solo caso: las tres suscripciones, que se facturan en USD
 * contra la tarjeta en dólares. No se generan "el día que cobra cada una" —
 * eso no se sigue y no cambia nada. Aparecen cuando cierra el resumen, y el
 * resumen se paga el 1 junto con el sueldo. Así que esto no es un cron: es la
 * acción de "preparar el resumen de este mes", que deja los cargos cargados
 * con el precio de lista para después corregirlos contra el resumen real.
 *
 * Esa corrección es el caso de §8: el precio de lista de Notion son 12 USD y
 * el resumen de octubre trajo 42. El estimado se carga igual y se corrige.
 *
 * Es idempotente: el índice único parcial `transactions_recurring_month_idx`
 * admite un solo asiento por (gasto recurrente, mes). Correrlo dos veces no
 * duplica nada, y no hace falta consultar antes de escribir.
 */
import { and, eq } from "drizzle-orm";
import type { db as Database } from "./index";
import { recordExpense } from "./ledger";
import * as schema from "./schema";

/** Violación de unique en Postgres. */
const UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === UNIQUE_VIOLATION || e?.cause?.code === UNIQUE_VIOLATION;
}

export type PreparedCharge = {
  recurringExpenseId: string;
  name: string;
  amount: string;
  currency: "ARS" | "USD";
  date: string;
  transactionId: string | null;
  /** true si ya existía el cargo de ese mes y no se tocó nada. */
  alreadyThere: boolean;
};

/** Último día del mes de `period`, para no caer en el 31 de febrero. */
function chargeDate(period: string, dayOfMonth: number): string {
  const [year, month] = period.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(dayOfMonth, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Crea los cargos que falten del período. Devuelve uno por gasto recurrente
 * activo, diciendo si lo creó o si ya estaba.
 *
 * @param period día 1 del mes, en formato YYYY-MM-DD.
 */
export async function prepareRecurringCharges(
  db: typeof Database,
  opts: { userId: string; period: string },
): Promise<PreparedCharge[]> {
  const items = await db
    .select()
    .from(schema.recurringExpenses)
    .where(
      and(
        eq(schema.recurringExpenses.userId, opts.userId),
        eq(schema.recurringExpenses.active, true),
      ),
    );

  const out: PreparedCharge[] = [];

  for (const item of items) {
    const date = chargeDate(opts.period, item.dayOfMonth);
    const base = {
      recurringExpenseId: item.id,
      name: item.name,
      amount: item.amount,
      currency: item.currency,
      date,
    };

    // Cada cargo va en su propia transacción: si uno choca con el índice, los
    // demás tienen que crearse igual.
    try {
      const { id } = await recordExpense(db, {
        userId: opts.userId,
        date,
        amount: item.amount,
        currency: item.currency,
        paidFromAccountId: item.accountId,
        expenseAccountId: item.expenseAccountId,
        envelopeId: item.envelopeId,
        payee: item.name,
        recurringExpenseId: item.id,
      });
      out.push({ ...base, transactionId: id, alreadyThere: false });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      out.push({ ...base, transactionId: null, alreadyThere: true });
    }
  }

  return out;
}
