/**
 * Capa de escritura del libro contable.
 *
 * Toda transacción se escribe por acá. Es el único lugar que arma partidas, y
 * existe para que los tres casos que rompen cualquier app de lista-de-gastos
 * salgan del mismo mecanismo: transferencia, pago del resumen de la tarjeta y
 * compra de dólares. Ninguno de los tres es un gasto.
 *
 * El invariante (`SUM(entries.amount) = 0` por transacción y moneda) lo
 * garantiza la base con el constraint trigger deferido `entries_balanced`.
 * Acá se valida igual, antes de escribir, solo para dar un error legible en vez
 * de una excepción de plpgsql.
 *
 * La plata es `string` de punta a punta. Las sumas de control se hacen con
 * BigInt sobre centésimas de centavo (4 decimales, igual que numeric(20,4)),
 * nunca con `number`.
 */
import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import type { db as Database } from "./index";
import * as schema from "./schema";

type Currency = (typeof schema.currency.enumValues)[number];
type Tx = Parameters<Parameters<typeof Database.transaction>[0]>[0];
/** Acepta tanto el `db` de la app como una transacción abierta. */
type Executor = typeof Database | Tx;

export type EntryInput = {
  accountId: string;
  /** Monto con signo, como string. Positivo = debe, negativo = haber. */
  amount: string;
  currency: Currency;
  /** Solo en cuentas expense (de qué sobre salió) o income (reembolsos). */
  envelopeId?: string | null;
};

export type TransactionInput = {
  userId: string;
  date: string;
  description?: string | null;
  payee?: string | null;
  planId?: string | null;
  recurringExpenseId?: string | null;
  entries: EntryInput[];
};

const SCALE = 4n;
const SCALE_POW = 10n ** SCALE;

/** "-1234.5" -> -12345000n (unidades de 10^-4). Exacto, sin float. */
export function toMinor(amount: string): bigint {
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(amount.trim());
  if (!match || (!match[2] && !match[3])) {
    throw new Error(`Monto inválido: ${JSON.stringify(amount)}`);
  }
  const [, sign, whole = "", frac = ""] = match;
  if (frac.length > Number(SCALE)) {
    throw new Error(
      `Monto con más de ${SCALE} decimales: ${amount} (numeric(20,4))`,
    );
  }
  const padded = frac.padEnd(Number(SCALE), "0");
  const value = BigInt(whole || "0") * SCALE_POW + BigInt(padded || "0");
  return sign === "-" ? -value : value;
}

/** -12345000n -> "-1234.5" */
export function fromMinor(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / SCALE_POW;
  const frac = (abs % SCALE_POW).toString().padStart(Number(SCALE), "0");
  const trimmed = frac.replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${trimmed ? `.${trimmed}` : ""}`;
}

/** Suma exacta de montos string. Para totales de control, no para persistir. */
export function sumAmounts(amounts: string[]): string {
  return fromMinor(amounts.reduce((acc, a) => acc + toMinor(a), 0n));
}

function assertBalanced(entries: EntryInput[]) {
  if (entries.length < 2) {
    throw new Error("Una transacción necesita al menos dos partidas");
  }
  const byCurrency = new Map<Currency, bigint>();
  for (const e of entries) {
    const minor = toMinor(e.amount);
    if (minor === 0n) {
      throw new Error("Una partida no puede ser 0 (entries_amount_nonzero)");
    }
    byCurrency.set(e.currency, (byCurrency.get(e.currency) ?? 0n) + minor);
  }
  for (const [currency, total] of byCurrency) {
    if (total !== 0n) {
      throw new Error(
        `Transacción desbalanceada en ${currency}: ${fromMinor(total)}. ` +
          `Las partidas suman cero POR MONEDA, no en total. Para cruzar ` +
          `monedas usá exchangeCurrency(), que mete las partidas de FX.`,
      );
    }
  }
}

/** Escribe una transacción con sus partidas. Un solo asiento, atómico. */
export async function createTransaction(
  exec: Executor,
  input: TransactionInput,
): Promise<{ id: string }> {
  assertBalanced(input.entries);

  const run = async (tx: Tx) => {
    const [row] = await tx
      .insert(schema.transactions)
      .values({
        userId: input.userId,
        date: input.date,
        description: input.description ?? null,
        payee: input.payee ?? null,
        planId: input.planId ?? null,
        recurringExpenseId: input.recurringExpenseId ?? null,
      })
      .returning({ id: schema.transactions.id });

    await tx.insert(schema.entries).values(
      input.entries.map((e) => ({
        transactionId: row.id,
        accountId: e.accountId,
        amount: e.amount,
        currency: e.currency,
        envelopeId: e.envelopeId ?? null,
      })),
    );

    return { id: row.id };
  };

  // Si ya venimos dentro de una transacción, no abrimos otra: el trigger
  // deferido tiene que validar al COMMIT de la transacción externa.
  return "transaction" in exec ? exec.transaction(run) : run(exec as Tx);
}

/* --------------------------------------------------------------- precios --- */

/**
 * Último precio conocido menor o igual a la fecha — el fallback definido en §6.
 * `source` permite distinguir el dólar oficial del tipo de cambio efectivo de
 * la tarjeta, que incluye impuestos y spread y no es el mismo número.
 */
export async function rateAt(
  exec: Executor,
  opts: {
    date: string;
    base: Currency;
    quote: Currency;
    source?: string;
    fallbackSource?: string;
  },
): Promise<string> {
  const sources = [opts.source, opts.fallbackSource].filter(
    (s): s is string => !!s,
  );
  for (const source of sources.length ? sources : [undefined]) {
    const [row] = await exec
      .select({ rate: schema.prices.rate })
      .from(schema.prices)
      .where(
        and(
          eq(schema.prices.base, opts.base),
          eq(schema.prices.quote, opts.quote),
          lte(schema.prices.date, opts.date),
          source ? eq(schema.prices.source, source) : isNotNull(schema.prices.id),
        ),
      )
      .orderBy(sql`${schema.prices.date} desc`)
      .limit(1);
    if (row) return row.rate;
  }
  throw new Error(
    `Sin precio ${opts.base}/${opts.quote} al ${opts.date}` +
      (sources.length ? ` (fuentes probadas: ${sources.join(", ")})` : ""),
  );
}

/** Convierte montos string multiplicando en la base, con `numeric`. */
export async function convert(
  exec: Executor,
  amount: string,
  rate: string,
  rounding: "round" | "trunc" = "round",
): Promise<string> {
  const fn = rounding === "round" ? sql`round` : sql`trunc`;
  const [row] = await exec.execute<{ value: string }>(
    sql`select ${fn}(${amount}::numeric * ${rate}::numeric, 4)::text as value`,
  );
  return row.value;
}

/* ----------------------------------------------- los casos del día a día --- */

/**
 * Un gasto: sale plata de una cuenta (asset) o se endeuda la tarjeta
 * (liability), y entra a la cuenta de gasto, que ES la categoría.
 * El sobre va en la partida de gasto: de ahí sale el saldo del sobre.
 */
export async function recordExpense(
  exec: Executor,
  input: {
    userId: string;
    date: string;
    amount: string;
    currency: Currency;
    /** De dónde sale: caja de ahorro, Mercado Pago, la tarjeta. */
    paidFromAccountId: string;
    /** La categoría. */
    expenseAccountId: string;
    envelopeId: string;
    payee?: string | null;
    description?: string | null;
    recurringExpenseId?: string | null;
  },
) {
  const minor = toMinor(input.amount);
  if (minor <= 0n) {
    throw new Error(`Un gasto se carga en positivo, vino ${input.amount}`);
  }
  return createTransaction(exec, {
    userId: input.userId,
    date: input.date,
    payee: input.payee,
    description: input.description,
    recurringExpenseId: input.recurringExpenseId,
    entries: [
      {
        accountId: input.expenseAccountId,
        amount: input.amount,
        currency: input.currency,
        envelopeId: input.envelopeId,
      },
      {
        accountId: input.paidFromAccountId,
        amount: fromMinor(-minor),
        currency: input.currency,
      },
    ],
  });
}

/**
 * Caso raro 1 — transferencia entre cuentas propias de la misma moneda
 * (mandar los 450.000 del auto a la cuenta corriente). NO es un gasto: no
 * toca ninguna cuenta de gasto ni ningún sobre.
 */
export async function recordTransfer(
  exec: Executor,
  input: {
    userId: string;
    date: string;
    amount: string;
    currency: Currency;
    fromAccountId: string;
    toAccountId: string;
    description?: string | null;
  },
) {
  const minor = toMinor(input.amount);
  if (minor <= 0n) {
    throw new Error(`Una transferencia va en positivo, vino ${input.amount}`);
  }
  return createTransaction(exec, {
    userId: input.userId,
    date: input.date,
    description: input.description,
    entries: [
      {
        accountId: input.toAccountId,
        amount: input.amount,
        currency: input.currency,
      },
      {
        accountId: input.fromAccountId,
        amount: fromMinor(-minor),
        currency: input.currency,
      },
    ],
  });
}

/**
 * Caso raro 2 — pago del resumen de la tarjeta. Tampoco es un gasto: los
 * consumos ya se cargaron como gasto cuando se consumieron y ya salieron de su
 * sobre. Esto solo cancela el pasivo. Es idéntico a una transferencia, pero se
 * expone aparte porque conceptualmente es otra cosa y porque es el caso donde
 * más se equivoca una app de lista-de-gastos.
 */
export async function recordCardPayment(
  exec: Executor,
  input: {
    userId: string;
    date: string;
    amount: string;
    currency: Currency;
    fromAccountId: string;
    cardAccountId: string;
    description?: string | null;
  },
) {
  const minor = toMinor(input.amount);
  if (minor <= 0n) {
    throw new Error(`Un pago de resumen va en positivo, vino ${input.amount}`);
  }
  return createTransaction(exec, {
    userId: input.userId,
    date: input.date,
    description: input.description ?? "Pago del resumen",
    entries: [
      // Sube el pasivo hacia 0 (se debe menos).
      {
        accountId: input.cardAccountId,
        amount: input.amount,
        currency: input.currency,
      },
      {
        accountId: input.fromAccountId,
        amount: fromMinor(-minor),
        currency: input.currency,
      },
    ],
  });
}

/**
 * Caso raro 3 — compra de dólares. Tampoco es un gasto.
 *
 * El invariante es por moneda, así que un asiento no puede tener 2.000.000 ARS
 * de un lado y 1.290 USD del otro. La conversión pasa por las cuentas de FX:
 * la pata ARS cierra contra Equity:FX:ARS y la pata USD contra Equity:FX:USD.
 * Las cuentas de FX acumulan la diferencia de cambio. El usuario nunca las ve.
 */
export async function exchangeCurrency(
  exec: Executor,
  input: {
    userId: string;
    date: string;
    fromAccountId: string;
    fromAmount: string;
    fromCurrency: Currency;
    fromFxAccountId: string;
    toAccountId: string;
    toAmount: string;
    toCurrency: Currency;
    toFxAccountId: string;
    description?: string | null;
  },
) {
  if (input.fromCurrency === input.toCurrency) {
    throw new Error("Para la misma moneda usá recordTransfer()");
  }
  const out = toMinor(input.fromAmount);
  const into = toMinor(input.toAmount);
  if (out <= 0n || into <= 0n) {
    throw new Error("Los montos de un cambio van en positivo");
  }
  return createTransaction(exec, {
    userId: input.userId,
    date: input.date,
    description:
      input.description ??
      `Cambio ${input.fromCurrency} → ${input.toCurrency}`,
    entries: [
      // Pata de origen: sale la plata, cierra contra el FX de su moneda.
      {
        accountId: input.fromAccountId,
        amount: fromMinor(-out),
        currency: input.fromCurrency,
      },
      {
        accountId: input.fromFxAccountId,
        amount: input.fromAmount,
        currency: input.fromCurrency,
      },
      // Pata de destino: entra la plata, cierra contra el FX de su moneda.
      {
        accountId: input.toAccountId,
        amount: input.toAmount,
        currency: input.toCurrency,
      },
      {
        accountId: input.toFxAccountId,
        amount: fromMinor(-into),
        currency: input.toCurrency,
      },
    ],
  });
}
