/**
 * El motor del planner: la cascada de tres niveles de §4.
 *
 * Es el punto de toda la app. El dolor no es registrar gastos, es decidir cada
 * mes a dónde va la plata, y hoy eso se rehace a mano cada vez que se cobra.
 *
 * ## Por qué hay niveles
 *
 * "Porcentaje del ingreso" no sirve con ingreso variable: un mes flojo deja una
 * meta sin aporte y no se detecta hasta que la fecha está encima. Entonces:
 *
 *   · Nivel 1 · piso — el sueldo, fijo y el día 1. Cubre las obligaciones y la
 *     meta con fecha dura. Lo que sobra va al fondo de emergencia.
 *   · Nivel 2 · variable recurrente — la consultoría. Completa el fondo de
 *     emergencia primero, porque con ingreso variable el fondo no es un colchón
 *     contra imprevistos: es lo que sostiene los aportes en un mes flojo.
 *   · Nivel 3 · hitos — misma cascada que el nivel 2.
 *
 * El promedio se calcula POR NIVEL y no sobre el total: si no, un mes
 * excepcional hace que el planner espere lo mismo al siguiente.
 *
 * ## De dónde sale el orden
 *
 * No hay una tabla de cascada: el rol de cada sobre se deduce de sus propias
 * columnas, que es lo que evita una configuración paralela que se desincronice.
 *
 *   contribution_rule = 'fixed'              → obligación del piso
 *   deadline_hard = true                     → meta del piso (el viaje)
 *   target sin target_date                   → absorbe el sobrante del piso y
 *                                              se completa primero en el nivel 2
 *                                              (el fondo de emergencia)
 *   target_date con deadline_hard = false    → meta del nivel 2 (el auto)
 *   contribution_rule = 'remainder'          → se lleva el resto (CEDEARs)
 *   contribution_rule = null                 → no entra; se carga a mano
 *
 * Entre las obligaciones del piso manda `display_order`.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { db as Database } from "./index";
import { fromMinor, toMinor, toScaled } from "./ledger";
import { goalProgress, type GoalProgress } from "./queries";
import * as schema from "./schema";

type Currency = (typeof schema.currency.enumValues)[number];
type Tier = (typeof schema.incomeTier.enumValues)[number];
type Executor = typeof Database;

export type PlannedLine = {
  /** Sobre al que se asigna, o null si es una línea de pago. */
  envelopeId: string | null;
  envelopeName: string | null;
  /** Cuenta a pagar, para las líneas de pago (el resumen de la tarjeta). */
  accountId: string | null;
  accountName: string | null;
  amount: string;
  currency: Currency;
  tier: Tier;
  ruleApplied: string;
  sequence: number;
  /**
   * true si esta línea ya se aprobó y generó su asignación. No se recalcula y
   * no entra en las transferencias pendientes: ya está hecha.
   */
  alreadyApplied: boolean;
};

export type PlannedTransfer = {
  accountId: string;
  accountName: string;
  /** Moneda en la que el plan asignó: siempre ARS en el v1. */
  currency: Currency;
  /** Moneda de la cuenta destino. */
  destinationCurrency: Currency;
  /** true si hay que comprar la moneda del destino antes de mandar. */
  needsExchange: boolean;
  /** Saldo actual de la cuenta destino, para contexto. */
  accountBalance: string;
  /** Lo que hay que mandar. Siempre positivo. */
  amount: string;
};

export type ComputedPlan = {
  period: string;
  rate: string;
  available: Record<Tier, string>;
  /**
   * De dónde salió cada monto disponible. `expected` solo puede pasar en el
   * piso: el sueldo es fijo y cae el día 1, así que si todavía no hay asiento
   * se usa el esperado. Los niveles variables son siempre `received`.
   */
  availableSource: Record<Tier, "received" | "expected">;
  /** Niveles que ya se aprobaron y materializaron en este período. */
  applied: Record<Tier, boolean>;
  lines: PlannedLine[];
  /** Cobros registrados y todavía no recibidos: se muestran, no se asignan. */
  expected: {
    id: string;
    source: string;
    amount: string;
    currency: Currency;
    expectedDate: string | null;
  }[];
  transfers: PlannedTransfer[];
  /** Lo que la cascada no llegó a asignar, por nivel. */
  leftover: Record<Tier, string>;
};

export type ComputeOptions = {
  userId: string;
  /** Día 1 del mes. */
  period: string;
  /** ARS por USD, para las reglas expresadas en dólares. */
  rate: string;
  /**
   * Cuánto distribuir por nivel. Si no se pasa, se deriva: el piso del monto
   * esperado de la fuente `base` (el sueldo es fijo y cae el día 1) y los
   * niveles variables SOLO de lo efectivamente cobrado — nunca de un esperado,
   * porque §4 es explícito en que los cobros esperados no se asignan hasta que
   * entran.
   */
  available?: Partial<Record<Tier, string>>;
  /** Puntuales del mes: no hay regla que los invente. */
  extras?: { envelopeId: string; amount: string; note: string }[];
};

const RATE_SCALE = 6;

/**
 * USD → ARS, redondeado al peso: es la unidad con la que se transfiere de
 * verdad, y asignar centavos que después no se pueden mover solo genera
 * diferencias que hay que conciliar.
 *
 * El producto va a escala 4+6; se redondea desde ahí sin pasar por float.
 */
function usdToArs(amountUsd: string, rate: string): string {
  const product = toMinor(amountUsd) * toScaled(rate, RATE_SCALE);
  const unit = 10n ** BigInt(4 + RATE_SCALE);
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const pesos = (abs + unit / 2n) / unit;
  return fromMinor((negative ? -pesos : pesos) * 10n ** 4n);
}

/** Saca los ceros de más: "450000.0000" -> "450000". */
function tidy(amount: string): string {
  return fromMinor(toMinor(amount));
}

export async function computePlan(
  db: Executor,
  opts: ComputeOptions,
): Promise<ComputedPlan> {
  const envelopes = await db
    .select()
    .from(schema.envelopes)
    .where(
      and(
        eq(schema.envelopes.userId, opts.userId),
        isNull(schema.envelopes.archivedAt),
      ),
    )
    .orderBy(schema.envelopes.displayOrder);

  // Recalcular un período tiene que IGNORAR lo que el plan de ese mismo
  // período ya asignó. Si no, su propio aporte cuenta como progreso de la meta
  // y el catch-up sale más bajo: el mes se cuenta pendiente y pagado a la vez.
  const [existing] = await db
    .select({ id: schema.plans.id })
    .from(schema.plans)
    .where(
      and(
        eq(schema.plans.userId, opts.userId),
        eq(schema.plans.period, opts.period),
      ),
    );
  const excludePlanId = existing?.id ?? null;

  const goals = await goalProgress(db, {
    rate: opts.rate,
    period: opts.period,
    excludePlanId,
  });
  const goalOf = (id: string) => goals.find((g) => g.envelopeId === id);

  const tiers: Tier[] = ["base", "recurring_variable", "milestone"];
  const available = {} as Record<Tier, string>;
  const availableSource = {} as Record<Tier, "received" | "expected">;
  for (const tier of tiers) {
    const override = opts.available?.[tier];
    if (override !== undefined) {
      available[tier] = override;
      availableSource[tier] = "received";
      continue;
    }
    const derived = await receivedInTier(db, opts, tier);
    available[tier] = derived.amount;
    availableSource[tier] = derived.source;
  }

  // Lo que este período ya aprobó y materializó. §4 pide replanificación
  // incremental: "el planner agrega líneas del nivel 2 sin tocar las del piso".
  // Sin esto, abrir el plan a mitad de mes vuelve a proponer las
  // transferencias que ya se hicieron.
  const stored = excludePlanId
    ? await storedLines(db, excludePlanId)
    : { lines: [], applied: {} as Record<Tier, boolean> };
  const applied: Record<Tier, boolean> = {
    base: stored.applied.base ?? false,
    recurring_variable: stored.applied.recurring_variable ?? false,
    milestone: stored.applied.milestone ?? false,
  };

  const lines: PlannedLine[] = [];
  let sequence = 0;
  const push = (line: Omit<PlannedLine, "sequence" | "alreadyApplied">) => {
    if (toMinor(line.amount) === 0n) return;
    lines.push({ ...line, alreadyApplied: false, sequence: ++sequence });
  };
  /** Las líneas ya aplicadas de un nivel, tal como quedaron guardadas. */
  const pushApplied = (tier: Tier) => {
    for (const l of stored.lines.filter((x) => x.tier === tier)) {
      lines.push({ ...l, alreadyApplied: true, sequence: ++sequence });
    }
  };

  /* ------------------------------------------------- nivel 1 · el piso --- */
  // Si el piso ya se aplicó, sus líneas se emiten tal cual y no se recalculan.
  let floor = applied.base ? 0n : toMinor(available.base);

  // 1. El resumen de la tarjeta, por su monto real. No es una asignación:
  //    los consumos ya se tagearon a su sobre al consumirse, así que reservar
  //    un sobre para el resumen contaría doble.
  // El pago del resumen se calcula siempre del saldo actual, aplicado o no:
  // aprobar un plan no paga nada, así que la línea sigue ahí hasta que la
  // deuda se cancele. Y se mantiene sola: cuando se paga, el saldo baja y la
  // línea desaparece.
  for (const card of await untaggedCardDebt(db, opts.userId)) {
    const owed = toMinor(card.owed);
    if (owed <= 0n) continue;
    const inArs =
      card.currency === "ARS" ? owed : toMinor(usdToArs(card.owed, opts.rate));
    push({
      envelopeId: null,
      envelopeName: null,
      accountId: card.accountId,
      accountName: card.name,
      amount: card.owed,
      currency: card.currency,
      tier: "base",
      ruleApplied: "statement · monto real del resumen",
    });
    floor -= inArs;
  }

  // Lo ya aplicado se emite después del pago, que es la primera línea de la
  // cascada de §4.
  if (applied.base) pushApplied("base");

  // 2. Las obligaciones fijas, en el orden del sobre.
  for (const e of applied.base ? [] : envelopes) {
    if (e.contributionRule !== "fixed" || !e.contributionAmount) continue;
    const amount =
      e.contributionCurrency === "USD"
        ? usdToArs(e.contributionAmount, opts.rate)
        : e.contributionAmount;
    push({
      envelopeId: e.id,
      envelopeName: e.name,
      accountId: null,
      accountName: null,
      amount,
      currency: "ARS",
      tier: "base",
      ruleApplied:
        e.contributionCurrency === "USD"
          ? `fixed · ${tidy(e.contributionAmount)} USD @ ${tidy(opts.rate)}`
          : `fixed · ${tidy(e.contributionAmount)}/mes`,
    });
    floor -= toMinor(amount);
  }

  // 3. Los puntuales del mes.
  for (const extra of applied.base ? [] : (opts.extras ?? [])) {
    const e = envelopes.find((x) => x.id === extra.envelopeId);
    push({
      envelopeId: extra.envelopeId,
      envelopeName: e?.name ?? null,
      accountId: null,
      accountName: null,
      amount: extra.amount,
      currency: "ARS",
      tier: "base",
      ruleApplied: `one_off · ${extra.note}`,
    });
    floor -= toMinor(extra.amount);
  }

  // 4. La meta con fecha dura, con catch-up. Si el piso no alcanza, entra lo
  //    que haya y el faltante lo completa el nivel variable: es la única meta
  //    que no puede quedar corta.
  const hardGoals = envelopes.filter(
    (e) => e.deadlineHard && goalOf(e.id) && e.contributionRule === "deadline",
  );
  const shortfall = new Map<string, bigint>();
  for (const e of hardGoals) {
    const goal = goalOf(e.id)!;
    const wanted = toMinor(
      goal.targetCurrency === "USD"
        ? usdToArs(goal.suggestedContribution, opts.rate)
        : goal.suggestedContribution,
    );

    // Con el piso ya aplicado no se recalcula nada, pero igual hay que saber
    // si quedó corto: ese faltante es lo que el nivel variable tiene que
    // completar, y es la única meta que no puede quedarse corta.
    if (applied.base) {
      const already = stored.lines
        .filter((l) => l.envelopeId === e.id && l.tier === "base")
        .reduce((acc, l) => acc + toMinor(l.amount), 0n);
      if (already < wanted) shortfall.set(e.id, wanted - already);
      continue;
    }

    const given = floor > 0n ? (wanted < floor ? wanted : floor) : 0n;
    if (given > 0n) {
      push({
        envelopeId: e.id,
        envelopeName: e.name,
        accountId: null,
        accountName: null,
        amount: fromMinor(given),
        currency: "ARS",
        tier: "base",
        ruleApplied:
          given < wanted
            ? "deadline · parcial, el piso no cubre el aporte"
            : `deadline · ${tidy(goal.suggestedContribution)} ${goal.targetCurrency} @ ${tidy(opts.rate)}`,
      });
      floor -= given;
    }
    if (given < wanted) shortfall.set(e.id, wanted - given);
  }

  // 5. El sobrante del piso al fondo de emergencia: la meta con objetivo y sin
  //    fecha. Puede ser cero.
  const reserve = envelopes.find(
    (e) =>
      e.kind === "goal" &&
      e.targetAmount !== null &&
      e.targetDate === null &&
      e.contributionRule !== "remainder",
  );
  if (reserve && !applied.base && floor > 0n) {
    push({
      envelopeId: reserve.id,
      envelopeName: reserve.name,
      accountId: null,
      accountName: null,
      amount: fromMinor(floor),
      currency: "ARS",
      tier: "base",
      ruleApplied: "remainder_of_tier · sobrante del piso",
    });
    floor = 0n;
  }

  /* --------------------------------- niveles 2 y 3 · lo variable --------- */
  // El nivel 3 usa la misma cascada que el nivel 2, así que se corren juntos
  // sobre la suma. Las líneas quedan etiquetadas con el nivel que aportó más.
  const variableTier: Tier =
    toMinor(available.milestone) > toMinor(available.recurring_variable)
      ? "milestone"
      : "recurring_variable";
  const variableApplied = applied.recurring_variable || applied.milestone;
  if (variableApplied) {
    pushApplied("recurring_variable");
    pushApplied("milestone");
  }
  let variable = variableApplied
    ? 0n
    : toMinor(available.recurring_variable) + toMinor(available.milestone);

  // 1. Completar el fondo de emergencia hasta su objetivo.
  if (reserve && variable > 0n) {
    const goal = goalOf(reserve.id);
    if (goal) {
      const wanted = toMinor(
        goal.targetCurrency === "USD"
          ? usdToArs(goal.remaining, opts.rate)
          : goal.remaining,
      );
      // Lo que ya le dio el piso este mes no hace falta pedirlo de nuevo.
      const fromFloor = lines
        .filter((l) => l.envelopeId === reserve.id && l.tier === "base")
        .reduce((acc, l) => acc + toMinor(l.amount), 0n);
      const pending = wanted - fromFloor;
      const given = pending > 0n ? (pending < variable ? pending : variable) : 0n;
      if (given > 0n) {
        push({
          envelopeId: reserve.id,
          envelopeName: reserve.name,
          accountId: null,
          accountName: null,
          amount: fromMinor(given),
          currency: "ARS",
          tier: variableTier,
          ruleApplied: `fill_to_target · completa ${tidy(goal.targetAmount)} ${goal.targetCurrency}`,
        });
        variable -= given;
      }
    }
  }

  // 2. El faltante de la meta con fecha dura, antes que cualquier otra meta.
  for (const [envelopeId, missing] of shortfall) {
    if (variable <= 0n) break;
    const e = envelopes.find((x) => x.id === envelopeId)!;
    const given = missing < variable ? missing : variable;
    push({
      envelopeId,
      envelopeName: e.name,
      accountId: null,
      accountName: null,
      amount: fromMinor(given),
      currency: "ARS",
      tier: variableTier,
      ruleApplied: "deadline · completa el aporte que el piso no cubrió",
    });
    variable -= given;
  }

  // 3. Las metas con fecha blanda, con catch-up.
  for (const e of envelopes) {
    if (variable <= 0n) break;
    if (e.contributionRule !== "deadline" || e.deadlineHard) continue;
    if (!e.targetDate) continue;
    const goal = goalOf(e.id);
    if (!goal) continue;
    const wanted = toMinor(
      goal.targetCurrency === "USD"
        ? usdToArs(goal.suggestedContribution, opts.rate)
        : goal.suggestedContribution,
    );
    const given = wanted < variable ? wanted : variable;
    push({
      envelopeId: e.id,
      envelopeName: e.name,
      accountId: null,
      accountName: null,
      amount: fromMinor(given),
      currency: "ARS",
      tier: variableTier,
      ruleApplied: `deadline · ${tidy(goal.suggestedContribution)} ${goal.targetCurrency} @ ${tidy(opts.rate)}`,
    });
    variable -= given;
  }

  // 4. El resto, al sobre sin techo.
  const remainderEnvelope = envelopes.find(
    (e) => e.contributionRule === "remainder",
  );
  if (remainderEnvelope && variable > 0n) {
    push({
      envelopeId: remainderEnvelope.id,
      envelopeName: remainderEnvelope.name,
      accountId: null,
      accountName: null,
      amount: fromMinor(variable),
      currency: "ARS",
      tier: variableTier,
      ruleApplied: "remainder · sin techo",
    });
    variable = 0n;
  }

  const expected = await pendingInflows(db, opts);
  const transfers = await computeTransfers(db, { userId: opts.userId, lines });

  return {
    period: opts.period,
    rate: opts.rate,
    available,
    availableSource,
    applied,
    lines,
    expected,
    transfers,
    leftover: {
      base: fromMinor(floor > 0n ? floor : 0n),
      recurring_variable: fromMinor(
        variableTier === "recurring_variable" && variable > 0n ? variable : 0n,
      ),
      milestone: fromMinor(
        variableTier === "milestone" && variable > 0n ? variable : 0n,
      ),
    },
  };
}

/**
 * Las líneas guardadas de un plan, y qué niveles ya se materializaron.
 *
 * Un nivel está aplicado si alguna de sus líneas tiene su asignación creada.
 * Aprobar materializa niveles enteros, así que con una alcanza.
 *
 * El vínculo es `allocations.plan_line_id` y no el sobre: el viaje tiene una
 * línea en el piso y otra en el nivel variable, así que matchear por sobre
 * daría el piso como aplicado cuando se aplicó el variable, o al revés.
 */
async function storedLines(
  db: Executor,
  planId: string,
): Promise<{
  lines: Omit<PlannedLine, "sequence" | "alreadyApplied">[];
  applied: Record<Tier, boolean>;
}> {
  type Row = {
    envelopeId: string | null;
    envelopeName: string | null;
    amount: string;
    currency: Currency;
    tier: Tier;
    ruleApplied: string | null;
    materialized: boolean;
  };
  const rows = (await db.execute<Row>(sql`
    select
      l.envelope_id   as "envelopeId",
      e.name          as "envelopeName",
      l.amount::text  as amount,
      l.currency      as currency,
      l.tier          as tier,
      l.rule_applied  as "ruleApplied",
      exists (select 1 from allocations al where al.plan_line_id = l.id)
                      as materialized
    from plan_lines l
    left join envelopes e on e.id = l.envelope_id
    where l.plan_id = ${planId}
    order by l.sequence
  `)) as unknown as Row[];

  const applied = {} as Record<Tier, boolean>;
  for (const r of rows) if (r.materialized) applied[r.tier] = true;

  return {
    // Las líneas de pago no se devuelven: el pago del resumen se recalcula
    // siempre del saldo real de la tarjeta.
    lines: rows
      .filter((r) => r.envelopeId !== null && applied[r.tier])
      .map((r) => ({
        envelopeId: r.envelopeId,
        envelopeName: r.envelopeName,
        accountId: null,
        accountName: null,
        amount: r.amount,
        currency: r.currency,
        tier: r.tier,
        ruleApplied: r.ruleApplied ?? "",
      })),
    applied,
  };
}

/** Lo efectivamente cobrado en el período desde las fuentes de un nivel. */
async function receivedInTier(
  db: Executor,
  opts: { userId: string; period: string },
  tier: Tier,
): Promise<{ amount: string; source: "received" | "expected" }> {
  const rows = await db.execute<{ total: string }>(sql`
    select coalesce(-sum(e.amount), 0)::text as total
    from entries e
    join accounts a on a.id = e.account_id
    join transactions t on t.id = e.transaction_id
    join income_sources s on s.account_id = a.id
    where a.type = 'income'
      and s.tier = ${tier}
      and t.user_id = ${opts.userId}
      and t.date >= ${opts.period}::date
      and t.date < (${opts.period}::date + interval '1 month')
  `);
  const received = (rows as unknown as { total: string }[])[0].total;
  if (toMinor(received) > 0n) return { amount: received, source: "received" };

  // El piso es la excepción: el sueldo es fijo y cae el día 1, así que si
  // todavía no hay asiento se usa el monto esperado de la fuente. Los niveles
  // variables nunca se asumen.
  if (tier !== "base") return { amount: "0", source: "received" };
  const fallback = await db
    .select({ amount: schema.incomeSources.expectedAmount })
    .from(schema.incomeSources)
    .where(
      and(
        eq(schema.incomeSources.userId, opts.userId),
        eq(schema.incomeSources.tier, "base"),
        eq(schema.incomeSources.active, true),
      ),
    );
  const expected = fallback.reduce(
    (acc, r) => (r.amount ? fromMinor(toMinor(acc) + toMinor(r.amount)) : acc),
    "0",
  );
  return { amount: expected, source: "expected" };
}

/**
 * La parte de la deuda de tarjeta que NINGÚN sobre cubre todavía.
 *
 * Es la distinción que hace que la cascada no cuente doble. El resumen en
 * dólares son 221 que ya salieron de sus sobres cuando se consumieron — el
 * hostel del Viaje, las suscripciones de Suscripciones —, así que pedirle al
 * piso otros 221 reservaría la misma plata dos veces. El resumen en pesos, en
 * cambio, viene del saldo de apertura y no tiene sobre detrás: ese sí hay que
 * cubrirlo.
 *
 * El criterio es si la transacción que generó la deuda tiene alguna partida
 * tagueada a un sobre.
 */
async function untaggedCardDebt(db: Executor, userId: string) {
  const rows = await db.execute<{
    accountId: string;
    name: string;
    currency: Currency;
    owed: string;
  }>(sql`
    select a.id as "accountId", a.name as name, a.currency as currency,
           coalesce(-sum(e.amount), 0)::text as owed
    from accounts a
    join entries e on e.account_id = a.id
    where a.user_id = ${userId} and a.type = 'liability'
      and a.archived_at is null
      and not exists (
        select 1 from entries tagged
        where tagged.transaction_id = e.transaction_id
          and tagged.envelope_id is not null
      )
    group by a.id, a.name, a.currency, a.display_order
    having coalesce(-sum(e.amount), 0) > 0
    order by a.display_order
  `);
  return rows as unknown as {
    accountId: string;
    name: string;
    currency: Currency;
    owed: string;
  }[];
}

async function pendingInflows(
  db: Executor,
  opts: { userId: string; period: string },
) {
  const rows = await db.execute<{
    id: string;
    source: string;
    amount: string;
    currency: Currency;
    expectedDate: string | null;
  }>(sql`
    select i.id as id, s.name as source, i.amount::text as amount,
           i.currency as currency, i.expected_date::text as "expectedDate"
    from expected_inflows i
    join income_sources s on s.id = i.income_source_id
    where s.user_id = ${opts.userId} and i.status = 'expected'
    order by i.expected_date nulls last
  `);
  return rows as unknown as {
    id: string;
    source: string;
    amount: string;
    currency: Currency;
    expectedDate: string | null;
  }[];
}

/**
 * Las transferencias concretas a hacer: a dónde va cada peso que el plan
 * asignó.
 *
 * Es el criterio de éxito de la pantalla del plan en §7: no sirve decir
 * "1.338.000 al auto" si después hay que sentarse a calcular qué transferencia
 * hacer. Cada sobre sabe dónde tiene que vivir su plata
 * (`settlement_account_id`), así que las líneas del plan se agrupan por cuenta
 * destino.
 *
 * La suma de las transferencias es igual al total del plan: todo peso asignado
 * tiene un destino, incluso cuando el destino es la cuenta donde ya está.
 *
 * Cuando el destino está en otra moneda, el plan asignó pesos y hay que
 * comprar los dólares: eso se marca con `needsExchange`, porque la compra pasa
 * por las cuentas de FX y además hay que convertir la asignación del sobre.
 */
async function computeTransfers(
  db: Executor,
  opts: { userId: string; lines: PlannedLine[] },
): Promise<PlannedTransfer[]> {
  const rows = await db.execute<{
    envelopeId: string;
    accountId: string;
    accountName: string;
    accountCurrency: Currency;
    accountBalance: string;
  }>(sql`
    select
      e.id       as "envelopeId",
      a.id       as "accountId",
      a.name     as "accountName",
      a.currency as "accountCurrency",
      (select coalesce(sum(en.amount), 0) from entries en
        where en.account_id = a.id)::text as "accountBalance"
    from envelopes e
    join accounts a on a.id = e.settlement_account_id
    where e.user_id = ${opts.userId} and e.archived_at is null
  `);

  const routes = rows as unknown as {
    envelopeId: string;
    accountId: string;
    accountName: string;
    accountCurrency: Currency;
    accountBalance: string;
  }[];

  const byAccount = new Map<string, PlannedTransfer>();
  for (const line of opts.lines) {
    if (line.alreadyApplied) continue; // ya se hizo, no hay nada que transferir
    if (!line.envelopeId) continue; // las líneas de pago se listan aparte
    const route = routes.find((r) => r.envelopeId === line.envelopeId);
    if (!route) continue;
    const entry =
      byAccount.get(route.accountId) ??
      {
        accountId: route.accountId,
        accountName: route.accountName,
        currency: line.currency,
        destinationCurrency: route.accountCurrency,
        needsExchange: route.accountCurrency !== line.currency,
        accountBalance: route.accountBalance,
        amount: "0",
      };
    entry.amount = fromMinor(toMinor(entry.amount) + toMinor(line.amount));
    byAccount.set(route.accountId, entry);
  }

  return [...byAccount.values()]
    .filter((t) => toMinor(t.amount) > 0n)
    .sort((a, b) => (toMinor(b.amount) > toMinor(a.amount) ? 1 : -1));
}

export type { GoalProgress };

/**
 * Guarda un plan calculado como `plan_lines` de un plan en borrador.
 *
 * Reemplaza las líneas que hubiera: recalcular un mes lo pisa entero. Las
 * allocations no se tocan acá — eso lo hace aprobar.
 */
export async function savePlan(
  db: Executor,
  opts: { userId: string; period: string; plan: ComputedPlan },
): Promise<string> {
  return db.transaction(async (tx) => {
    const [plan] = await tx
      .insert(schema.plans)
      .values({ userId: opts.userId, period: opts.period, status: "draft" })
      .onConflictDoUpdate({
        target: [schema.plans.userId, schema.plans.period],
        set: { status: "draft", approvedAt: null },
      })
      .returning({ id: schema.plans.id });

    await tx.delete(schema.planLines).where(eq(schema.planLines.planId, plan.id));
    await tx
      .delete(schema.allocations)
      .where(eq(schema.allocations.planId, plan.id));

    if (opts.plan.lines.length) {
      await tx.insert(schema.planLines).values(
        opts.plan.lines.map((l) => ({
          planId: plan.id,
          envelopeId: l.envelopeId,
          accountId: l.accountId,
          amount: l.amount,
          currency: l.currency,
          tier: l.tier,
          ruleApplied: l.ruleApplied,
          sequence: l.sequence,
        })),
      );
    }
    return plan.id;
  });
}

/**
 * Aprueba un plan: cada línea de sobre se materializa como `allocation` con ese
 * `plan_id`. Reversible borrando las allocations del plan.
 *
 * Dos clases de línea NO generan allocation:
 *   · las de pago (el resumen de la tarjeta), que no asignan propósito;
 *   · las de un nivel cuyo cobro todavía no entró. §4: los cobros esperados se
 *     muestran y no se asignan hasta que entran. Aprobar el plan no inventa
 *     plata que no está.
 */
export async function approvePlan(
  db: Executor,
  opts: { userId: string; planId: string; period: string },
): Promise<{ materialized: Tier[]; pending: Tier[] }> {
  // Para materializar solo vale lo efectivamente cobrado: el esperado del
  // sueldo sirve para calcular la cascada, no para asignar plata que no entró.
  const received = {
    base: await receivedInTier(db, opts, "base"),
    recurring_variable: await receivedInTier(db, opts, "recurring_variable"),
    milestone: await receivedInTier(db, opts, "milestone"),
  };

  const lines = await db
    .select()
    .from(schema.planLines)
    .where(eq(schema.planLines.planId, opts.planId));

  const materialized: Tier[] = [];
  const pending: Tier[] = [];
  for (const tier of ["base", "recurring_variable", "milestone"] as Tier[]) {
    if (!lines.some((l) => l.tier === tier)) continue;
    const got = received[tier];
    const real = got.source === "received" && toMinor(got.amount) > 0n;
    // El piso se materializa igual: el sueldo del día 1 es un hecho, no una
    // expectativa, y es lo que permitió armar el plan de apertura.
    (real || tier === "base" ? materialized : pending).push(tier);
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.allocations)
      .where(eq(schema.allocations.planId, opts.planId));

    const toCreate = lines.filter(
      (l) => l.envelopeId !== null && materialized.includes(l.tier),
    );
    if (toCreate.length) {
      await tx.insert(schema.allocations).values(
        toCreate.map((l) => ({
          envelopeId: l.envelopeId!,
          date: opts.period,
          amount: l.amount,
          currency: l.currency,
          planId: opts.planId,
          // El vínculo con la línea es lo que después deja saber qué parte del
          // plan ya se aplicó, para no volver a proponerla.
          planLineId: l.id,
          note: l.ruleApplied,
        })),
      );
    }

    await tx
      .update(schema.plans)
      .set({ status: "approved", approvedAt: new Date() })
      .where(eq(schema.plans.id, opts.planId));
  });

  return { materialized, pending };
}

/** El plan guardado de un período, con sus líneas. */
export async function loadPlan(
  db: Executor,
  opts: { userId: string; period: string },
) {
  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(
      and(
        eq(schema.plans.userId, opts.userId),
        eq(schema.plans.period, opts.period),
      ),
    );
  if (!plan) return null;
  const lines = await db
    .select()
    .from(schema.planLines)
    .where(eq(schema.planLines.planId, plan.id))
    .orderBy(schema.planLines.sequence);
  return { plan, lines };
}
