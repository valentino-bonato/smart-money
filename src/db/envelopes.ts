/**
 * Operaciones sobre el libro de sobres.
 *
 * `allocations` es un libro SEPARADO del contable: asignar 1.277.000 al viaje
 * no mueve plata de ninguna cuenta, es una fila acá. Por eso estas operaciones
 * no pasan por `ledger.ts` ni tocan `entries`, y el invariante de partida doble
 * no aplica: una asignación no tiene contrapartida.
 *
 * Las cuatro formas, tal como las define §6:
 *   · asignar del pool   → una fila positiva
 *   · devolver al pool   → una fila negativa
 *   · mover entre sobres → dos filas
 *   · pasar de moneda    → dos filas en el mismo sobre
 */
import { and, eq, sql } from "drizzle-orm";
import type { db as Database } from "./index";
import { toMinor } from "./ledger";
import * as schema from "./schema";

type Currency = (typeof schema.currency.enumValues)[number];
type Tx = Parameters<Parameters<typeof Database.transaction>[0]>[0];
type Executor = typeof Database | Tx;

function runIn<T>(exec: Executor, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const isTransaction = typeof (exec as Tx).rollback === "function";
  return isTransaction
    ? fn(exec as Tx)
    : (exec as typeof Database).transaction(fn);
}

function assertPositive(amount: string, what: string): bigint {
  const minor = toMinor(amount);
  if (minor <= 0n) {
    throw new Error(`${what} va en positivo, vino ${amount}`);
  }
  return minor;
}

/** Asigna plata del pool sin propósito a un sobre. */
export async function assignFromPool(
  exec: Executor,
  input: {
    envelopeId: string;
    amount: string;
    currency: Currency;
    date: string;
    note?: string | null;
    planId?: string | null;
  },
) {
  assertPositive(input.amount, "Una asignación");
  const [row] = await (exec as Tx)
    .insert(schema.allocations)
    .values({
      envelopeId: input.envelopeId,
      date: input.date,
      amount: input.amount,
      currency: input.currency,
      planId: input.planId ?? null,
      note: input.note ?? null,
    })
    .returning({ id: schema.allocations.id });
  return [row.id];
}

/** Devuelve plata de un sobre al pool: una fila negativa. */
export async function returnToPool(
  exec: Executor,
  input: {
    envelopeId: string;
    amount: string;
    currency: Currency;
    date: string;
    note?: string | null;
  },
) {
  const minor = assertPositive(input.amount, "Una devolución al pool");
  const [row] = await (exec as Tx)
    .insert(schema.allocations)
    .values({
      envelopeId: input.envelopeId,
      date: input.date,
      amount: `-${input.amount.replace(/^\+/, "")}`,
      currency: input.currency,
      note: input.note ?? null,
    })
    .returning({ id: schema.allocations.id });
  void minor;
  return [row.id];
}

/**
 * Mueve plata de un sobre a otro: dos filas, en una sola transacción.
 *
 * Se permite dejar el sobre de origen en negativo. §8: prohibirlo obliga a
 * mentirle a la app, y el saldo negativo es justamente la señal de que hay algo
 * que cubrir.
 */
export async function moveBetweenEnvelopes(
  exec: Executor,
  input: {
    fromEnvelopeId: string;
    toEnvelopeId: string;
    amount: string;
    currency: Currency;
    date: string;
    note?: string | null;
  },
) {
  assertPositive(input.amount, "Un movimiento entre sobres");
  if (input.fromEnvelopeId === input.toEnvelopeId) {
    throw new Error("El sobre de origen y el de destino son el mismo");
  }
  return runIn(exec, async (tx) => {
    const rows = await tx
      .insert(schema.allocations)
      .values([
        {
          envelopeId: input.fromEnvelopeId,
          date: input.date,
          amount: `-${input.amount}`,
          currency: input.currency,
          note: input.note ?? null,
        },
        {
          envelopeId: input.toEnvelopeId,
          date: input.date,
          amount: input.amount,
          currency: input.currency,
          note: input.note ?? null,
        },
      ])
      .returning({ id: schema.allocations.id });
    return rows.map((r) => r.id);
  });
}

/**
 * Pasa la asignación de un sobre de una moneda a otra: dos filas en el MISMO
 * sobre.
 *
 * Hace falta porque comprar dólares mueve las cuentas pero no las asignaciones.
 * El viaje tiene 1.044.579 ARS asignados que en algún momento se vuelven
 * dólares; si la asignación no se convierte también, el sobre queda diciendo
 * que tiene pesos que ya no existen.
 *
 * Los dos montos se pasan por separado y no se calculan con un precio: el que
 * vale es el del cambio que de verdad se hizo.
 */
export async function convertEnvelopeAllocation(
  exec: Executor,
  input: {
    envelopeId: string;
    fromAmount: string;
    fromCurrency: Currency;
    toAmount: string;
    toCurrency: Currency;
    date: string;
    note?: string | null;
  },
) {
  assertPositive(input.fromAmount, "El monto de origen");
  assertPositive(input.toAmount, "El monto de destino");
  if (input.fromCurrency === input.toCurrency) {
    throw new Error("Para la misma moneda usá moveBetweenEnvelopes()");
  }
  return runIn(exec, async (tx) => {
    const rows = await tx
      .insert(schema.allocations)
      .values([
        {
          envelopeId: input.envelopeId,
          date: input.date,
          amount: `-${input.fromAmount}`,
          currency: input.fromCurrency,
          note: input.note ?? null,
        },
        {
          envelopeId: input.envelopeId,
          date: input.date,
          amount: input.toAmount,
          currency: input.toCurrency,
          note: input.note ?? null,
        },
      ])
      .returning({ id: schema.allocations.id });
    return rows.map((r) => r.id);
  });
}

/** Lo asignado a cada sobre en un mes, para el contexto de la pantalla. */
export async function allocatedInMonth(
  exec: Executor,
  opts: { period: string },
) {
  const rows = await (exec as typeof Database).execute<{
    envelopeId: string;
    currency: Currency;
    total: string;
  }>(sql`
    select
      envelope_id                as "envelopeId",
      currency                   as currency,
      sum(amount)::text          as total
    from allocations
    where date >= ${opts.period}::date
      and date < (${opts.period}::date + interval '1 month')
    group by envelope_id, currency
    having sum(amount) <> 0
  `);
  return rows as unknown as {
    envelopeId: string;
    currency: Currency;
    total: string;
  }[];
}

/** Borra las allocations generadas por un plan: deshace su aprobación. */
export async function unapprovePlan(exec: Executor, planId: string) {
  return runIn(exec, async (tx) => {
    await tx
      .delete(schema.allocations)
      .where(eq(schema.allocations.planId, planId));
    await tx
      .update(schema.plans)
      .set({ status: "draft", approvedAt: null })
      .where(and(eq(schema.plans.id, planId)));
  });
}
