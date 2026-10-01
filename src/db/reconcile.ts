/**
 * Conciliación: pegar los saldos del homebanking y que la app diga la
 * diferencia y qué falta cargar.
 *
 * Es el chequeo de §8 que decide si se puede confiar en el resto: "al cierre
 * los saldos de la app tienen que coincidir al peso con el homebanking". Si no
 * coinciden, el planner está comiendo de un historial incompleto.
 *
 * Lo que la hace útil no es la resta — eso es trivial — sino la segunda mitad:
 * qué es lo más probable que falte. Dos fuentes concretas, las dos derivables:
 * los gastos fijos del mes que todavía no se cargaron, y los cobros esperados
 * cuya fecha ya pasó.
 */
import { and, eq, sql } from "drizzle-orm";
import type { db as Database } from "./index";
import { toMinor } from "./ledger";
import * as schema from "./schema";

type Currency = (typeof schema.currency.enumValues)[number];
type Executor = typeof Database;

export type ReconcilableAccount = {
  accountId: string;
  name: string;
  type: "asset" | "liability";
  currency: Currency;
  /** El saldo según la app. */
  computedBalance: string;
  /** El último saldo pegado del homebanking, si hubo. */
  lastStatementBalance: string | null;
  lastReconciledAt: string | null;
  lastDifference: string | null;
};

/** Las cuentas que tienen un homebanking contra el que comparar. */
export async function reconcilableAccounts(
  db: Executor,
  opts: { userId: string },
): Promise<ReconcilableAccount[]> {
  const rows = await db.execute<ReconcilableAccount>(sql`
    select
      a.id                                   as "accountId",
      a.name                                 as name,
      a.type::text                           as type,
      a.currency                             as currency,
      coalesce((select sum(e.amount) from entries e
                 where e.account_id = a.id), 0)::text as "computedBalance",
      r.statement_balance::text              as "lastStatementBalance",
      r.date::text                           as "lastReconciledAt",
      r.difference::text                     as "lastDifference"
    from accounts a
    left join lateral (
      select statement_balance, date, difference
      from reconciliations
      where account_id = a.id
      order by date desc, id desc
      limit 1
    ) r on true
    where a.user_id = ${opts.userId}
      and a.type in ('asset', 'liability')
      and a.is_system = false
      and a.archived_at is null
    order by a.display_order
  `);
  return rows as unknown as ReconcilableAccount[];
}

export type MissingHint =
  | {
      kind: "recurring";
      name: string;
      amount: string;
      currency: Currency;
      accountId: string;
      accountName: string;
    }
  | {
      kind: "inflow";
      name: string;
      amount: string;
      currency: Currency;
      expectedDate: string | null;
    };

/**
 * Qué es lo más probable que falte cargar.
 *
 * No intenta adivinar gastos sueltos: eso no se puede. Apunta a lo que la app
 * ya sabe que tiene que pasar y todavía no vio.
 */
export async function missingEntries(
  db: Executor,
  opts: { userId: string; period: string; today: string },
): Promise<MissingHint[]> {
  const recurring = await db.execute<{
    name: string;
    amount: string;
    currency: Currency;
    accountId: string;
    accountName: string;
  }>(sql`
    select r.name as name, r.amount::text as amount, r.currency as currency,
           a.id as "accountId", a.name as "accountName"
    from recurring_expenses r
    join accounts a on a.id = r.account_id
    where r.user_id = ${opts.userId} and r.active = true
      and not exists (
        select 1 from transactions t
        where t.recurring_expense_id = r.id
          and t.date >= ${opts.period}::date
          and t.date < (${opts.period}::date + interval '1 month')
      )
    order by r.name
  `);

  const inflows = await db.execute<{
    name: string;
    amount: string;
    currency: Currency;
    expectedDate: string | null;
  }>(sql`
    select s.name as name, i.amount::text as amount, i.currency as currency,
           i.expected_date::text as "expectedDate"
    from expected_inflows i
    join income_sources s on s.id = i.income_source_id
    where s.user_id = ${opts.userId}
      and i.status = 'expected'
      and (i.expected_date is null or i.expected_date <= ${opts.today}::date)
    order by i.expected_date nulls last
  `);

  return [
    ...(recurring as unknown as {
      name: string;
      amount: string;
      currency: Currency;
      accountId: string;
      accountName: string;
    }[]).map((r) => ({ kind: "recurring" as const, ...r })),
    ...(inflows as unknown as {
      name: string;
      amount: string;
      currency: Currency;
      expectedDate: string | null;
    }[]).map((r) => ({ kind: "inflow" as const, ...r })),
  ];
}

export type ReconciliationResult = {
  accountId: string;
  name: string;
  currency: Currency;
  statementBalance: string;
  computedBalance: string;
  difference: string;
  matched: boolean;
};

/**
 * Registra una conciliación por cuenta.
 *
 * `difference = statement − computed`. Positiva significa que el banco tiene
 * más de lo que la app sabe: falta cargar un ingreso, o hay un gasto cargado
 * que no existió. Se guarda igual cuando da cero, porque saber que una cuenta
 * cerró es información: es la línea del checklist de §8.
 */
export async function recordReconciliation(
  db: Executor,
  opts: {
    userId: string;
    date: string;
    balances: { accountId: string; statementBalance: string }[];
  },
): Promise<ReconciliationResult[]> {
  if (!opts.balances.length) return [];

  const accounts = await reconcilableAccounts(db, { userId: opts.userId });
  const results: ReconciliationResult[] = [];

  await db.transaction(async (tx) => {
    for (const b of opts.balances) {
      const account = accounts.find((a) => a.accountId === b.accountId);
      if (!account) {
        throw new Error(`Cuenta inexistente o no conciliable: ${b.accountId}`);
      }
      // La resta se hace en la base, con numeric: nada de aritmética en JS.
      const [row] = await tx
        .insert(schema.reconciliations)
        .values({
          accountId: b.accountId,
          date: opts.date,
          statementBalance: b.statementBalance,
          computedBalance: account.computedBalance,
          difference: sql`${b.statementBalance}::numeric - ${account.computedBalance}::numeric`,
          resolvedAt: sql`case when ${b.statementBalance}::numeric
                                 = ${account.computedBalance}::numeric
                            then now() else null end`,
        })
        .returning({
          difference: schema.reconciliations.difference,
        });

      results.push({
        accountId: account.accountId,
        name: account.name,
        currency: account.currency,
        statementBalance: b.statementBalance,
        computedBalance: account.computedBalance,
        difference: row.difference,
        matched: toMinor(row.difference) === 0n,
      });
    }
  });

  return results;
}

/** Las últimas conciliaciones, para ver si una cuenta viene arrastrando. */
export async function reconciliationHistory(
  db: Executor,
  opts: { userId: string; limit?: number },
) {
  const rows = await db.execute<{
    id: string;
    date: string;
    account: string;
    currency: Currency;
    statementBalance: string;
    computedBalance: string;
    difference: string;
    resolved: boolean;
  }>(sql`
    select r.id as id, r.date::text as date, a.name as account,
           a.currency as currency,
           r.statement_balance::text as "statementBalance",
           r.computed_balance::text  as "computedBalance",
           r.difference::text        as difference,
           (r.resolved_at is not null) as resolved
    from reconciliations r
    join accounts a on a.id = r.account_id
    where a.user_id = ${opts.userId}
    order by r.date desc, r.id desc
    limit ${opts.limit ?? 20}
  `);
  return rows as unknown as {
    id: string;
    date: string;
    account: string;
    currency: Currency;
    statementBalance: string;
    computedBalance: string;
    difference: string;
    resolved: boolean;
  }[];
}

/** Marca una conciliación como resuelta a mano. */
export async function resolveReconciliation(
  db: Executor,
  opts: { id: string },
) {
  await db
    .update(schema.reconciliations)
    .set({ resolvedAt: sql`now()` })
    .where(and(eq(schema.reconciliations.id, opts.id)));
}
