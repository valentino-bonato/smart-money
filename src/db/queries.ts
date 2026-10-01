/**
 * Los cálculos derivados de §6, en un solo lugar.
 *
 *   saldo_sobre(envelope, currency) = Σ allocations − Σ gastos tagueados
 *   pool_sin_asignar(currency)      = Σ saldos de cuentas asset − Σ saldos de sobres
 *
 * Están acá y no repetidos en cada pantalla porque es la definición del
 * producto: si el saldo de un sobre se calcula distinto en dos lugares, la app
 * miente en uno de los dos.
 *
 * Sobre "Σ gastos tagueados": se restan TODAS las partidas con `envelope_id`,
 * sin filtrar por tipo de cuenta. El trigger `entries_validate_account` ya
 * garantiza que solo las cuentas expense e income llevan sobre, y el signo
 * sale solo: un gasto entra positivo y resta del sobre; un reembolso entra
 * negativo en la cuenta de ingreso y se lo devuelve.
 *
 * Los saldos de sobre PUEDEN ser negativos: si se gastó más de lo asignado eso
 * pasó en la realidad, y la app no puede obligar al usuario a mentirle.
 */
import { sql } from "drizzle-orm";
import type { db as Database } from "./index";

type Executor = typeof Database | { execute: typeof Database.execute };
type Currency = "ARS" | "USD";

export type EnvelopeBalance = {
  envelopeId: string;
  name: string;
  currency: Currency;
  balance: string;
  allocated: string;
  spent: string;
  displayOrder: number;
};

/** Un renglón por sobre y moneda, salteando los que están en cero. */
export async function envelopeBalances(
  exec: Executor,
  opts: { includeZero?: boolean } = {},
): Promise<EnvelopeBalance[]> {
  const rows = await exec.execute<EnvelopeBalance>(sql`
    select
      e.id                                             as "envelopeId",
      e.name                                           as name,
      c.currency                                       as currency,
      coalesce(al.total, 0)::text                      as allocated,
      coalesce(sp.total, 0)::text                      as spent,
      (coalesce(al.total, 0) - coalesce(sp.total, 0))::text as balance,
      e.display_order                                  as "displayOrder"
    from envelopes e
    cross join (select unnest(enum_range(null::currency)) as currency) c
    left join lateral (
      select sum(a.amount) as total from allocations a
      where a.envelope_id = e.id and a.currency = c.currency
    ) al on true
    left join lateral (
      select sum(en.amount) as total from entries en
      where en.envelope_id = e.id and en.currency = c.currency
    ) sp on true
    where e.archived_at is null
      and (${opts.includeZero ?? false}
           or coalesce(al.total, 0) - coalesce(sp.total, 0) <> 0)
    order by e.display_order, c.currency
  `);
  return rows as unknown as EnvelopeBalance[];
}

export type PoolRow = {
  currency: Currency;
  assets: string;
  enveloped: string;
  pool: string;
};

/**
 * La plata que todavía no tiene propósito, por moneda.
 *
 * Ojo con la fórmula de §6: mira solo las cuentas `asset`, así que una deuda
 * de tarjeta no la baja. Si hay resumen pendiente, el pool se ve más rico de
 * lo que es por el monto de ese resumen.
 */
export async function unassignedPool(exec: Executor): Promise<PoolRow[]> {
  const rows = await exec.execute<PoolRow>(sql`
    with assets as (
      select a.currency, sum(e.amount) as total
      from accounts a join entries e on e.account_id = a.id
      where a.type = 'asset'
      group by a.currency
    ), enveloped as (
      select currency, sum(amount) as total from (
        select currency, amount from allocations
        union all
        select currency, -amount from entries where envelope_id is not null
      ) x group by currency
    )
    select
      c.currency                                               as currency,
      coalesce(a.total, 0)::text                               as assets,
      coalesce(v.total, 0)::text                               as enveloped,
      (coalesce(a.total, 0) - coalesce(v.total, 0))::text       as pool
    from (select unnest(enum_range(null::currency)) as currency) c
    left join assets a on a.currency = c.currency
    left join enveloped v on v.currency = c.currency
    order by c.currency
  `);
  return rows as unknown as PoolRow[];
}

export type AccountBalance = {
  accountId: string;
  name: string;
  type: string;
  currency: Currency;
  balance: string;
  displayOrder: number;
};

export async function accountBalances(
  exec: Executor,
): Promise<AccountBalance[]> {
  const rows = await exec.execute<AccountBalance>(sql`
    select
      a.id                              as "accountId",
      a.name                            as name,
      a.type::text                      as type,
      a.currency                        as currency,
      coalesce(sum(e.amount), 0)::text  as balance,
      a.display_order                   as "displayOrder"
    from accounts a left join entries e on e.account_id = a.id
    where a.archived_at is null
    group by a.id, a.name, a.type, a.currency, a.display_order
    having coalesce(sum(e.amount), 0) <> 0
    order by a.display_order
  `);
  return rows as unknown as AccountBalance[];
}

/**
 * Patrimonio en una moneda, convirtiendo las demás al precio indicado.
 * Suma llana de asset + liability: los pasivos ya vienen negativos.
 */
export async function netWorth(
  exec: Executor,
  opts: { in: Currency; rate: string; from: Currency },
): Promise<string> {
  const rows = await exec.execute<{ total: string }>(sql`
    with bal as (
      select a.currency, sum(e.amount) as total
      from accounts a join entries e on e.account_id = a.id
      where a.type in ('asset', 'liability')
      group by a.currency
    )
    select coalesce(sum(
      case when b.currency = ${opts.from} then b.total * ${opts.rate}::numeric
           else b.total end
    ), 0)::text as total
    from bal b
  `);
  return (rows as unknown as { total: string }[])[0].total;
}
