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

export type GoalProgress = {
  envelopeId: string;
  name: string;
  targetAmount: string;
  targetCurrency: Currency;
  targetDate: string | null;
  deadlineHard: boolean;
  /** Σ allocations, en la moneda del objetivo. */
  progress: string;
  /** Lo que todavía falta juntar. */
  remaining: string;
  /** Plata del sobre todavía sin gastar: progreso − gastado. */
  available: string;
  /** Ya convertido en viaje/auto de verdad. */
  spent: string;
  /** Meses desde el período hasta target_date. null si no tiene fecha. */
  monthsRemaining: number | null;
  /** Catch-up: faltante ÷ meses restantes. Sin fecha, el faltante entero. */
  suggestedContribution: string;
};

/**
 * Progreso de las metas, con el catch-up de §4.
 *
 * El progreso es **Σ allocations**, no el saldo del sobre. Son dos números
 * distintos y confundirlos rompe el catch-up:
 *
 *   · El target es el costo TOTAL de la meta (los 7.295 USD del viaje).
 *   · Gastar del sobre en la meta misma — el hostel de Amsterdam — es la meta
 *     cumpliéndose, no plata que haya que volver a juntar. Cuenta como
 *     progreso.
 *   · `available` es otra cosa: la plata del sobre que todavía no se gastó.
 *     Sirve para "¿me queda plata del viaje?", no para el catch-up.
 *
 * Si el progreso restara los gastos, cada pago adelantado pediría ahorrar ese
 * monto dos veces.
 *
 * `excludePlanId` saca las allocations de un plan para poder recalcularlo sin
 * contar su propio aporte: es lo que hace falta para replanificar.
 */
export async function goalProgress(
  exec: Executor,
  opts: {
    /** ARS por USD. Solo para valuar las allocations de la otra moneda. */
    rate: string;
    /** Día 1 del mes que se está planificando. */
    period: string;
    excludePlanId?: string | null;
  },
): Promise<GoalProgress[]> {
  const rows = await exec.execute<GoalProgress>(sql`
    with alloc as (
      select a.envelope_id, a.currency, sum(a.amount) as total
      from allocations a
      where ${opts.excludePlanId ?? null}::uuid is null
         or a.plan_id is distinct from ${opts.excludePlanId ?? null}::uuid
      group by a.envelope_id, a.currency
    ), spent as (
      select en.envelope_id, en.currency, sum(en.amount) as total
      from entries en where en.envelope_id is not null
      group by en.envelope_id, en.currency
    ), inTarget as (
      -- Todo llevado a la moneda del objetivo. La conversión vive solo en la
      -- vista: no se guarda ningún saldo convertido.
      select
        e.id,
        coalesce(sum(
          case when a.currency = e.target_currency then a.total
               when e.target_currency = 'USD' then a.total / ${opts.rate}::numeric
               else a.total * ${opts.rate}::numeric end
        ), 0) as progress,
        coalesce(sum(
          case when s.currency = e.target_currency then s.total
               when e.target_currency = 'USD' then s.total / ${opts.rate}::numeric
               else s.total * ${opts.rate}::numeric end
        ), 0) as spent
      from envelopes e
      left join alloc a on a.envelope_id = e.id
      left join spent s on s.envelope_id = e.id and s.currency = a.currency
      where e.kind = 'goal' and e.target_amount is not null
      group by e.id
    )
    select
      e.id                                    as "envelopeId",
      e.name                                  as name,
      e.target_amount::text                   as "targetAmount",
      e.target_currency                       as "targetCurrency",
      e.target_date::text                     as "targetDate",
      e.deadline_hard                         as "deadlineHard",
      round(t.progress, 4)::text              as progress,
      round(e.target_amount - t.progress, 4)::text as remaining,
      round(t.progress - t.spent, 4)::text    as available,
      round(t.spent, 4)::text                 as spent,
      m.months                                as "monthsRemaining",
      -- Catch-up: faltante ÷ meses restantes. Al peso, que es como se usa.
      round(
        case when m.months is null or m.months <= 0
             then e.target_amount - t.progress
             else (e.target_amount - t.progress) / m.months end,
        0
      )::text                                 as "suggestedContribution"
    from envelopes e
    join inTarget t on t.id = e.id
    cross join lateral (
      select case when e.target_date is null then null else
        (extract(year from e.target_date) * 12 + extract(month from e.target_date))
        - (extract(year from ${opts.period}::date) * 12
           + extract(month from ${opts.period}::date))
      end::int as months
    ) m
    where e.archived_at is null
    order by e.display_order
  `);
  return rows as unknown as GoalProgress[];
}

export type PayeeSuggestion = {
  payee: string;
  /** Categoría usada la última vez con este comercio. */
  expenseAccountId: string | null;
  envelopeId: string | null;
  paidFromAccountId: string | null;
  currency: Currency | null;
  /** Cuántas veces se cargó. Ordena la lista. */
  timesUsed: number;
  lastUsed: string;
};

/**
 * Qué categoría, sobre y cuenta se usaron la última vez con cada comercio.
 *
 * Esto es el corazón de la reducción de fricción de §8: la segunda vez que
 * cargás "Coto" no tenés que elegir nada. Arranca vacío y aprende del uso —
 * no hay lista precargada de comercios.
 *
 * `distinct on` se queda con la fila más reciente de cada payee — por fecha y
 * después por `created_at`, no por id — y la cuenta de usos sale aparte, solo
 * para ordenar las sugerencias.
 */
export async function payeeSuggestions(
  exec: Executor,
  opts: { userId: string; limit?: number },
): Promise<PayeeSuggestion[]> {
  const rows = await exec.execute<PayeeSuggestion>(sql`
    with tagged as (
      -- La partida de gasto de cada transacción con payee: de ahí salen la
      -- categoría, el sobre y la moneda.
      select
        t.id, t.payee, t.date, t.created_at,
        e.account_id  as expense_account_id,
        e.envelope_id as envelope_id,
        e.currency    as currency
      from transactions t
      join entries e on e.transaction_id = t.id
      join accounts a on a.id = e.account_id
      where t.user_id = ${opts.userId}
        and t.payee is not null
        and a.type = 'expense'
    ), counted as (
      select payee, count(*)::int as times_used, max(date)::text as last_used
      from tagged group by payee
    ), latest as (
      select distinct on (payee)
        payee, id, expense_account_id, envelope_id, currency
      from tagged
      -- created_at y no id: con varias cargas el mismo día, ordenar por uuid
      -- elegía una fila al azar como "la última".
      order by payee, date desc, created_at desc
    )
    select
      l.payee                                  as payee,
      l.expense_account_id                     as "expenseAccountId",
      l.envelope_id                            as "envelopeId",
      l.currency                               as currency,
      -- De dónde salió la plata: la contrapartida del mismo asiento.
      (select e2.account_id from entries e2
         join accounts a2 on a2.id = e2.account_id
        where e2.transaction_id = l.id
          and a2.type in ('asset', 'liability')
        limit 1)                               as "paidFromAccountId",
      c.times_used                             as "timesUsed",
      c.last_used                              as "lastUsed"
    from latest l
    join counted c on c.payee = l.payee
    order by c.times_used desc, c.last_used desc
    limit ${opts.limit ?? 50}
  `);
  return rows as unknown as PayeeSuggestion[];
}

export type MovementKind =
  | "gasto"
  | "ingreso"
  | "transferencia"
  | "pago"
  | "cambio"
  | "apertura"
  | "ajuste";

export type RecentTransaction = {
  id: string;
  date: string;
  payee: string | null;
  description: string | null;
  kind: MovementKind;
  envelope: string | null;
  category: string | null;
  /** Lo que entró, por moneda. Un asiento puede tocar varias. */
  inflows: { currency: Currency; amount: string }[];
  /** Lo que salió, por moneda. Solo se muestra en un cambio de moneda. */
  outflows: { currency: Currency; amount: string }[];
};

/**
 * Los últimos movimientos, para confirmar de un vistazo que entró bien.
 *
 * Un asiento NO tiene "un monto": tiene partidas, y pueden ser muchas y en
 * varias monedas. El saldo de apertura son siete. Mostrar una sola —la más
 * grande, pongamos— da un número que no significa nada.
 *
 * Entonces se devuelven los totales por moneda de lo que entró, salteando las
 * cuentas de sistema (`Equity:*`), que el usuario no ve y que solo son la
 * contrapartida técnica. Para un gasto eso es el gasto, para una transferencia
 * lo transferido, para un pago lo pagado, y para la apertura lo que había.
 */
export async function recentTransactions(
  exec: Executor,
  opts: { userId: string; limit?: number },
): Promise<RecentTransaction[]> {
  const rows = await exec.execute<RecentTransaction>(sql`
    with legs as (
      select t.id, e.amount, e.currency, e.envelope_id,
             a.type as account_type, a.is_system, a.name as account_name
      from transactions t
      join entries e on e.transaction_id = t.id
      join accounts a on a.id = e.account_id
      where t.user_id = ${opts.userId}
    ), recent as (
      select t.id, t.date, t.payee, t.description, t.created_at
      from transactions t
      where t.user_id = ${opts.userId}
      order by t.date desc, t.created_at desc
      limit ${opts.limit ?? 15}
    )
    select
      r.id                     as id,
      r.date::text             as date,
      r.payee                  as payee,
      r.description            as description,
      case
        when exists (select 1 from legs l
                      where l.id = r.id and l.account_type = 'expense')
          then 'gasto'
        when exists (select 1 from legs l
                      where l.id = r.id and l.account_name like 'Equity:Opening%')
          then 'apertura'
        when exists (select 1 from legs l
                      where l.id = r.id and l.account_name like 'Equity:FX%')
          then 'cambio'
        when exists (select 1 from legs l
                      where l.id = r.id and l.account_name like 'Equity:Ajustes%')
          then 'ajuste'
        when exists (select 1 from legs l
                      where l.id = r.id and l.account_type = 'income')
          then 'ingreso'
        when exists (select 1 from legs l
                      where l.id = r.id and l.account_type = 'liability'
                        and l.amount > 0)
          then 'pago'
        else 'transferencia'
      end                      as kind,
      (select e.name from legs l join envelopes e on e.id = l.envelope_id
        where l.id = r.id limit 1)            as envelope,
      (select l.account_name from legs l
        where l.id = r.id and l.account_type = 'expense' limit 1) as category,
      coalesce((
        select json_agg(json_build_object('currency', x.currency,
                                          'amount', x.total::text)
                        order by x.total desc)
        from (select l.currency, sum(l.amount) as total from legs l
               where l.id = r.id and not l.is_system and l.amount > 0
               group by l.currency) x
      ), '[]'::json)                          as inflows,
      coalesce((
        select json_agg(json_build_object('currency', x.currency,
                                          'amount', (-x.total)::text)
                        order by x.total)
        from (select l.currency, sum(l.amount) as total from legs l
               where l.id = r.id and not l.is_system and l.amount < 0
               group by l.currency) x
      ), '[]'::json)                          as outflows
    from recent r
    order by r.date desc, r.created_at desc
  `);
  return rows as unknown as RecentTransaction[];
}

/**
 * El precio para valuar en la vista: último USD/ARS conocido <= fecha.
 *
 * Vive acá y no en `ledger.rateAt` porque son dos usos distintos: ahí es para
 * registrar una operación de cambio, acá es solo para mostrar. Nunca se guarda
 * un saldo convertido.
 */
export async function rateForView(
  exec: Executor,
  opts: { date: string; source?: string },
): Promise<string> {
  const rows = await exec.execute<{ rate: string }>(sql`
    select rate::text as rate from prices
    where base = 'USD' and quote = 'ARS' and date <= ${opts.date}::date
      ${opts.source ? sql`and source = ${opts.source}` : sql``}
    order by date desc
    limit 1
  `);
  const row = (rows as unknown as { rate: string }[])[0];
  if (!row) throw new Error(`Sin precio USD/ARS al ${opts.date}`);
  return row.rate;
}

/**
 * El próximo mes a planificar: el primero sin plan aprobado.
 *
 * Importa para el catch-up. Si octubre ya está aprobado y se calcula el aporte
 * "desde octubre", el mes se cuenta como pendiente mientras su asignación ya
 * está sumada al progreso, y el aporte sugerido sale más bajo de lo que es.
 */
export async function nextPlanningPeriod(
  exec: Executor,
  opts: { userId: string; today: string },
): Promise<string> {
  const rows = await exec.execute<{ period: string }>(sql`
    select coalesce(
      (select (max(period) + interval '1 month')::date
         from plans
        where user_id = ${opts.userId} and status = 'approved'
          and period >= date_trunc('month', ${opts.today}::date)::date),
      date_trunc('month', ${opts.today}::date)::date
    )::text as period
  `);
  return (rows as unknown as { period: string }[])[0].period;
}
