/**
 * Seed con los datos reales al 1-oct-2026 — paso 2 del orden de construcción (§7).
 *
 * Contenido, según la spec:
 *   · 6 cuentas de usuario + "Me deben" + 6 de gasto + 4 de ingreso
 *     + las de sistema
 *   · 10 sobres (6 de gasto + 4 de tipo meta, de los cuales 3 tienen objetivo)
 *   · saldos de apertura al 1-oct-2026 contra Equity:Opening
 *   · 3 fuentes de ingreso
 *   · 3 metas (objetivo, fecha y aporte mensual)
 *   · el precio del dólar oficial: 1.550
 *   · el plan de octubre 2026, aprobado, con las allocations del nivel piso
 *     (las del nivel variable esperan a que el cobro entre)
 *   · los 2 cobros esperados del nivel variable (consultoría + hito)
 *
 * Toda la plata viaja como `string`: `numeric` mapea a `string` en
 * drizzle-orm@0.45.3 y no se convierte a `number` en ningún punto.
 */
import { sql as dsql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadEnv } from "./env";
import { recordExpense } from "./ledger";
import {
  accountBalances,
  envelopeBalances,
  netWorth,
  unassignedPool,
} from "./queries";
import * as schema from "./schema";

async function main() {
  const url = loadEnv();
  const client = postgres(url, { max: 1 });
  const db = drizzle(client, { schema });

  const OPENING = "2026-10-01";
  const PERIOD = "2026-10-01";
  /** Dólar oficial usado en todo el plan de octubre (§5). */
  const USD_ARS = "1550";

  await db.transaction(async (tx) => {
    // ---------------------------------------------------------------- limpieza
    await tx.execute(dsql`
      truncate table
        ${schema.entries}, ${schema.transactions}, ${schema.allocations},
        ${schema.planLines}, ${schema.plans}, ${schema.expectedInflows},
        ${schema.incomeSources}, ${schema.recurringExpenses},
        ${schema.reconciliations}, ${schema.envelopes}, ${schema.accounts},
        ${schema.prices}, ${schema.users}
      restart identity cascade
    `);

    // -------------------------------------------------------------------- user
    const [user] = await tx
      .insert(schema.users)
      .values({ email: "bonatovalentino016@gmail.com", name: "Valentino Bonato" })
      .returning();

    // ---------------------------------------------------------------- cuentas
    // Las 6 del as-is (§2). Una cuenta = una moneda: Cocos son dos cuentas.
    const userAccounts = [
      {
        name: "BBVA caja de ahorro",
        type: "asset" as const,
        currency: "ARS" as const,
        institution: "BBVA",
      },
      {
        name: "BBVA cuenta corriente",
        type: "asset" as const,
        currency: "ARS" as const,
        institution: "BBVA",
      },
      // La tarjeta son dos cuentas por la misma razón que Cocos: el resumen
      // tiene un saldo en pesos (los gastos extras) y uno en dólares (las
      // suscripciones), y cada uno se paga en su moneda.
      {
        name: "Tarjeta de crédito BBVA — ARS",
        type: "liability" as const,
        currency: "ARS" as const,
        institution: "BBVA",
      },
      {
        name: "Tarjeta de crédito BBVA — USD",
        type: "liability" as const,
        currency: "USD" as const,
        institution: "BBVA",
      },
      {
        name: "Mercado Pago",
        type: "asset" as const,
        currency: "ARS" as const,
        institution: "Mercado Pago",
      },
      {
        name: "Cocos Capital — CEDEARs",
        type: "asset" as const,
        currency: "ARS" as const,
        institution: "Cocos Capital",
      },
      {
        name: "Cocos Capital — fondo USD",
        type: "asset" as const,
        currency: "USD" as const,
        institution: "Cocos Capital",
      },
      // §8, gasto compartido con reembolso: si se pagan 100.000 y devuelven
      // 75.000, cargar gasto 100.000 + ingreso 75.000 distorsiona el promedio
      // de "amigos", que es input del planner. Con esta cuenta el gasto real
      // es 25.000 y los 75.000 son un crédito que se cobra después.
      {
        name: "Me deben",
        type: "asset" as const,
        currency: "ARS" as const,
        institution: null,
      },
    ];

    // Las categorías SON las cuentas de gasto: no hay tabla de categorías
    // aparte. El sobre sigue siendo una dimensión separada.
    const expenseAccounts = (
      [
        ["Gastos:Comida y súper", "ARS"],
        ["Gastos:Salidas y amigos", "ARS"],
        ["Gastos:Rochi", "ARS"],
        ["Gastos:Auto", "ARS"],
        // En USD: las suscripciones se facturan y se pagan en dólares, así que
        // el gasto se incurre en dólares. Una cuenta = una moneda.
        ["Gastos:Suscripciones", "USD"],
        ["Gastos:Extras y regalos", "ARS"],
        // En USD: el hostel de Amsterdam se pagó con la tarjeta en dólares.
        ["Gastos:Viaje", "USD"],
      ] as const
    ).map(([name, currency]) => ({
      name,
      type: "expense" as const,
      currency,
      institution: null,
    }));

    // Una cuenta de ingreso por fuente. El rendimiento de Cocos va aparte
    // porque §8 lo marca: es ingreso, no sueldo, y no entra a la cascada como
    // plata asignable salvo decisión explícita.
    const incomeAccounts = [
      "Ingresos:Sueldo",
      "Ingresos:Consultoría",
      "Ingresos:Desarrollos",
      "Ingresos:Rendimiento Cocos",
    ].map((name) => ({
      name,
      type: "income" as const,
      currency: "ARS" as const,
      institution: null,
    }));

    // Cuentas de sistema: las maneja la app, el usuario no las ve.
    // Equity:Opening se parte por moneda porque "una cuenta = una moneda" y el
    // trigger entries_validate_account exige que la partida coincida con la
    // cuenta. Las de FX acumulan la diferencia de cambio de las conversiones.
    const systemAccounts = (
      [
        ["Equity:Opening:ARS", "ARS"],
        ["Equity:Opening:USD", "USD"],
        ["Equity:FX:ARS", "ARS"],
        ["Equity:FX:USD", "USD"],
      ] as const
    ).map(([name, currency]) => ({
      name,
      type: "equity" as const,
      currency,
      institution: null,
    }));

    const accountRows = await tx
      .insert(schema.accounts)
      .values([
        ...userAccounts.map((a, i) => ({
          ...a,
          userId: user.id,
          isSystem: false,
          displayOrder: i + 1,
        })),
        ...expenseAccounts.map((a, i) => ({
          ...a,
          userId: user.id,
          isSystem: false,
          displayOrder: 20 + i,
        })),
        ...incomeAccounts.map((a, i) => ({
          ...a,
          userId: user.id,
          isSystem: false,
          displayOrder: 40 + i,
        })),
        ...systemAccounts.map((a, i) => ({
          ...a,
          userId: user.id,
          isSystem: true,
          displayOrder: 100 + i,
        })),
      ])
      .returning();

    const acct = (name: string) => {
      const row = accountRows.find((a) => a.name === name);
      if (!row) throw new Error(`Cuenta inexistente: ${name}`);
      return row;
    };

    // ----------------------------------------------------------------- sobres
    // 10 sobres. "Tarjeta" NO es un sobre: los consumos de la tarjeta ya se
    // taguean a su sobre al consumirse, así que reservar un sobre para el
    // resumen contaría doble. El pago del resumen es una línea de plan contra
    // la cuenta de la tarjeta.
    const envelopeRows = await tx
      .insert(schema.envelopes)
      .values([
        {
          userId: user.id,
          name: "Auto — corriente",
          kind: "spending",
          rollover: "accumulate", // acumula
          displayOrder: 1,
          contributionRule: "fixed",
          contributionAmount: "450000",
          contributionCurrency: "ARS",
        },
        {
          userId: user.id,
          name: "Comida y súper",
          kind: "spending",
          rollover: "reset", // se vacía cada mes
          displayOrder: 2,
          contributionRule: "fixed",
          contributionAmount: "80000",
          contributionCurrency: "ARS",
        },
        {
          userId: user.id,
          name: "Amigos",
          kind: "spending",
          rollover: "reset",
          displayOrder: 3,
          contributionRule: "fixed",
          contributionAmount: "150000",
          contributionCurrency: "ARS",
        },
        {
          userId: user.id,
          name: "Rochi",
          kind: "spending",
          rollover: "reset",
          displayOrder: 4,
          contributionRule: "fixed",
          contributionAmount: "150000",
          contributionCurrency: "ARS",
        },
        // El aporte va en USD porque el precio de lista está en USD: Claude
        // 100 + Notion 12 + YouTube 1,82. La tarjeta las cobra en ARS al tipo
        // de cambio efectivo del resumen, que no es el dólar oficial.
        // Acumula para absorber la diferencia entre el cargo estimado y el
        // real cuando llega el resumen.
        {
          userId: user.id,
          name: "Suscripciones",
          kind: "spending",
          rollover: "accumulate",
          displayOrder: 5,
          contributionRule: "fixed",
          contributionAmount: "113.82",
          contributionCurrency: "USD",
        },
        {
          userId: user.id,
          name: "Puntuales del mes",
          kind: "spending",
          rollover: "reset",
          displayOrder: 6,
          // Sin regla: los puntuales se cargan a mano mes a mes.
          contributionRule: null,
        },
        // --- las 3 metas (objetivo + aporte mensual con catch-up) ---
        {
          userId: user.id,
          name: "Viaje",
          kind: "goal",
          rollover: "accumulate",
          displayOrder: 7,
          targetAmount: "7295",
          targetCurrency: "USD",
          targetDate: "2027-06-01", // fecha dura
          deadlineHard: true,
          contributionRule: "deadline",
          contributionAmount: "824",
          contributionCurrency: "USD",
        },
        {
          userId: user.id,
          name: "Auto — ahorro",
          kind: "goal",
          rollover: "accumulate",
          displayOrder: 8,
          targetAmount: "10000",
          targetCurrency: "USD",
          targetDate: "2027-09-01", // blanda
          deadlineHard: false,
          contributionRule: "deadline",
          contributionAmount: "863",
          contributionCurrency: "USD",
        },
        {
          userId: user.id,
          name: "Fondo de emergencia",
          kind: "goal",
          rollover: "accumulate",
          displayOrder: 9,
          targetAmount: "2000",
          targetCurrency: "USD",
          // Sin fecha: prioridad 1 del nivel 2, se completa lo antes posible.
          targetDate: null,
          deadlineHard: false,
          contributionRule: "deadline",
          contributionAmount: null,
        },
        {
          userId: user.id,
          name: "CEDEARs",
          kind: "goal",
          rollover: "accumulate",
          displayOrder: 10,
          // Sin techo: se lleva el resto de la cascada.
          contributionRule: "remainder",
        },
      ])
      .returning();

    const env = (name: string) => {
      const row = envelopeRows.find((e) => e.name === name);
      if (!row) throw new Error(`Sobre inexistente: ${name}`);
      return row;
    };

    // ----------------------------------------------------------------- precio
    await tx.insert(schema.prices).values({
      date: OPENING,
      base: "USD",
      quote: "ARS",
      rate: USD_ARS,
      source: "oficial",
    });

    // ------------------------------------------------- fuentes de ingreso (3)
    const incomeSourceRows = await tx
      .insert(schema.incomeSources)
      .values([
      {
        userId: user.id,
        name: "Sueldo",
        tier: "base",
        expectedAmount: "2717000",
        currency: "ARS",
        dayOfMonth: 1,
      },
      {
        userId: user.id,
        name: "Consultoría por hora",
        tier: "recurring_variable",
        expectedAmount: "1500000", // promedio del nivel, no del total
        currency: "ARS",
      },
      {
        userId: user.id,
        name: "Desarrollos",
        tier: "milestone",
        // Por hitos: mitad al inicio, mitad al cierre. Sin monto esperado fijo.
        expectedAmount: null,
        currency: "ARS",
      },
      ])
      .returning();

    const src = (name: string) => {
      const row = incomeSourceRows.find((s) => s.name === name);
      if (!row) throw new Error(`Fuente de ingreso inexistente: ${name}`);
      return row;
    };

    // Los dos cobros del nivel variable de octubre todavía no entraron: al
    // 1-oct solo el sueldo está acreditado. §4: los cobros esperados se
    // registran con monto y fecha estimada, se muestran y NO se asignan hasta
    // que entran. `expected_date` es un placeholder a fin de mes: la spec no
    // da fecha para ninguno de los dos.
    await tx.insert(schema.expectedInflows).values([
      {
        incomeSourceId: src("Consultoría por hora").id,
        amount: "4780000",
        currency: "ARS",
        expectedDate: "2026-10-31",
        status: "expected",
      },
      {
        incomeSourceId: src("Desarrollos").id,
        amount: "1200000",
        currency: "ARS",
        expectedDate: "2026-10-31",
        status: "expected",
      },
    ]);

    // ------------------------------------------- saldos de apertura (1 asiento)
    // Un solo asiento con las dos monedas. Suma cero por moneda, no en total:
    // ese es el invariante. Las partidas se insertan de a tandas y el trigger
    // `entries_balanced` valida al COMMIT porque es DEFERRABLE INITIALLY DEFERRED.
    const [openingTx] = await tx
      .insert(schema.transactions)
      .values({
        userId: user.id,
        date: OPENING,
        description: "Saldos de apertura al 1-oct-2026",
      })
      .returning();

    // Signo: los pasivos van negativos cuando se debe plata. El patrimonio es
    // la suma llana de asset + liability, sin invertir nada.
    //
    // La cuenta corriente del auto abre en 0: no lleva partida
    // (check entries_amount_nonzero).
    const openingBalances = [
      { account: "BBVA caja de ahorro", amount: "2691000", currency: "ARS" },
      { account: "Mercado Pago", amount: "15000", currency: "ARS" },
      { account: "Cocos Capital — CEDEARs", amount: "3335100", currency: "ARS" },
      { account: "Cocos Capital — fondo USD", amount: "1495", currency: "USD" },
      // La tabla de saldos de apertura de §5 no lista la tarjeta, pero §5 dice
      // que el resumen real es 200.000 y el plan reserva eso para pagarlo. Sin
      // el pasivo, el plan pagaría una deuda que no existe en la base.
      {
        account: "Tarjeta de crédito BBVA — ARS",
        amount: "-200000",
        currency: "ARS",
      },
    ] as const;

    await tx.insert(schema.entries).values(
      openingBalances.map((b) => ({
        transactionId: openingTx.id,
        accountId: acct(b.account).id,
        amount: b.amount,
        currency: b.currency,
      })),
    );

    // Contrapartidas, una por moneda.
    await tx.insert(schema.entries).values([
      {
        transactionId: openingTx.id,
        accountId: acct("Equity:Opening:ARS").id,
        amount: "-5841100", // 2691000 + 15000 + 3335100 - 200000
        currency: "ARS" as const,
      },
      {
        transactionId: openingTx.id,
        accountId: acct("Equity:Opening:USD").id,
        amount: "-1495",
        currency: "USD" as const,
      },
    ]);

    // --------------------------------------- propósito ya asignado a la apertura
    // De los 6.041.100 ARS + 1.495 USD de apertura, esto ya tenía destino.
    // El resto (2.706.000 ARS) es el pool sin asignar: el síntoma exacto del
    // problema que la app resuelve.
    await tx.insert(schema.allocations).values([
      {
        envelopeId: env("Viaje").id,
        date: OPENING,
        amount: "703",
        currency: "USD",
        note: "Saldo de apertura — en el fondo USD de Cocos",
      },
      {
        envelopeId: env("Fondo de emergencia").id,
        date: OPENING,
        amount: "792",
        currency: "USD",
        note: "Saldo de apertura — en el fondo USD de Cocos",
      },
      {
        envelopeId: env("Auto — ahorro").id,
        date: OPENING,
        amount: "790000",
        currency: "ARS",
        // §8: plata de una meta a ~11 meses en renta variable. Decisión
        // explícita del usuario, no un default.
        note: "Saldo de apertura — en CEDEARs del S&P500",
      },
      {
        envelopeId: env("CEDEARs").id,
        date: OPENING,
        amount: "2545100",
        currency: "ARS",
        note: "Saldo de apertura",
      },
    ]);

    // ------------------------------------------- plan de octubre 2026, aprobado
    const [plan] = await tx
      .insert(schema.plans)
      .values({
        userId: user.id,
        period: PERIOD,
        status: "approved",
        approvedAt: new Date(`${OPENING}T12:00:00-03:00`),
      })
      .returning();

    // Nivel 1 (piso, sueldo) + nivel 2/3 (variable + hito), en orden de cascada.
    // Los montos son los de §5. La línea de la tarjeta apunta a la cuenta, no a
    // un sobre: pagar el resumen no es asignar propósito.
    type Line = {
      envelope?: string;
      account?: string;
      amount: string;
      tier: "base" | "recurring_variable" | "milestone";
      ruleApplied: string;
    };

    const lines: Line[] = [
      // --- nivel 1 · piso: sueldo 2.717.000, día 1 ---
      {
        account: "Tarjeta de crédito BBVA — ARS",
        amount: "200000",
        tier: "base",
        ruleApplied: "statement · resumen en pesos (gastos extras)",
      },
      // El lado en dólares del mismo resumen. Se asigna en ARS y se convierte
      // al comprar los dólares, igual que el viaje: el sobre tiene saldo por
      // moneda. 113,82 USD × 1.550 = 176.421 ARS, exacto.
      {
        envelope: "Suscripciones",
        amount: "176421",
        tier: "base",
        ruleApplied: "fixed · 113,82 USD @ 1.550",
      },
      {
        envelope: "Auto — corriente",
        amount: "450000",
        tier: "base",
        ruleApplied: "fixed · 450.000/mes",
      },
      {
        envelope: "Comida y súper",
        amount: "80000",
        tier: "base",
        ruleApplied: "fixed · 80.000/mes",
      },
      {
        envelope: "Amigos",
        amount: "150000",
        tier: "base",
        ruleApplied: "fixed · 150.000/mes",
      },
      {
        envelope: "Rochi",
        amount: "150000",
        tier: "base",
        ruleApplied: "fixed · 150.000/mes",
      },
      {
        envelope: "Puntuales del mes",
        amount: "200000",
        tier: "base",
        ruleApplied: "one_off · cumple de Rochi",
      },
      {
        envelope: "Viaje",
        amount: "1277000",
        tier: "base",
        ruleApplied: "deadline · 824 USD @ 1.550",
      },
      // El sobrante del piso baja de 184.000 a 7.579 porque ahora el piso
      // cubre también las suscripciones. Lo que el fondo deja de recibir acá
      // lo recupera en el nivel 2, que es el que lo completa.
      {
        envelope: "Fondo de emergencia",
        amount: "7579",
        tier: "base",
        ruleApplied: "remainder_of_tier · sobrante del piso",
      },
      // --- nivel 2/3 · variable: consultoría 4.780.000 + hito 1.200.000 ---
      // §4: el nivel 3 usa la misma cascada que el nivel 2, y §5 corre una sola
      // cascada sobre los 5.980.000 juntos. Por eso las tres líneas van con
      // tier = recurring_variable en vez de partirse por fuente.
      {
        envelope: "Fondo de emergencia",
        amount: "1864421",
        tier: "recurring_variable",
        ruleApplied: "fill_to_target · completa los 2.000 USD (incluye hito 1.200.000)",
      },
      {
        envelope: "Auto — ahorro",
        amount: "1338000",
        tier: "recurring_variable",
        ruleApplied: "deadline · 863 USD @ 1.550",
      },
      {
        envelope: "CEDEARs",
        amount: "2777579",
        tier: "recurring_variable",
        ruleApplied: "remainder · sin techo",
      },
    ];

    const planLineRows = await tx
      .insert(schema.planLines)
      .values(
        lines.map((l, i) => ({
          planId: plan.id,
          envelopeId: l.envelope ? env(l.envelope).id : null,
          accountId: l.account ? acct(l.account).id : null,
          amount: l.amount,
          currency: "ARS" as const,
          tier: l.tier,
          ruleApplied: l.ruleApplied,
          sequence: i + 1,
        })),
      )
      .returning();

    // ------------------------------------- resumen en dólares de octubre
    // Los cuatro consumos del resumen que hay que pagar ahora. Van como
    // transacciones reales y no como saldo de apertura, porque sí se sabe de
    // qué son: la atribución al sobre es el punto de la app. El resumen en
    // pesos, en cambio, quedó como saldo de apertura sin detalle.
    //
    // Pasan por recordExpense() dentro de esta misma transacción: el trigger
    // deferido valida todo junto al COMMIT.
    const cardUsd = acct("Tarjeta de crédito BBVA — USD").id;
    const statement = [
      {
        amount: "77",
        payee: "Hostel Amsterdam",
        expense: "Gastos:Viaje",
        envelope: "Viaje",
        // El hostel no es una suscripción: es el viaje, pagado por adelantado.
        description: "Hostel de Amsterdam",
      },
      {
        amount: "100",
        payee: "Claude",
        expense: "Gastos:Suscripciones",
        envelope: "Suscripciones",
        description: null,
      },
      {
        amount: "42",
        payee: "Notion",
        expense: "Gastos:Suscripciones",
        envelope: "Suscripciones",
        // 42 contra 12 de precio de lista: el caso de §8 de cargar estimado y
        // corregir con el resumen. Los 30 de más dejan el sobre corto.
        description: "Atípico — el precio normal son 12 USD/mes",
      },
      {
        amount: "2",
        payee: "YouTube Premium",
        expense: "Gastos:Suscripciones",
        envelope: "Suscripciones",
        description: null,
      },
    ];

    for (const line of statement) {
      await recordExpense(tx, {
        userId: user.id,
        date: OPENING,
        amount: line.amount,
        currency: "USD",
        paidFromAccountId: cardUsd,
        expenseAccountId: acct(line.expense).id,
        envelopeId: env(line.envelope).id,
        payee: line.payee,
        description: line.description,
      });
    }

    // Aprobar un plan materializa sus plan_lines como allocations con ese
    // plan_id. Reversible borrando las allocations del plan.
    //
    // Dos clases de línea NO generan allocation:
    //   · las de pago (la tarjeta): pagar el resumen no asigna propósito;
    //   · las del nivel variable, porque el cobro todavía no entró. Quedan en
    //     el plan como propuesta visible, y el planner las materializa cuando
    //     el expected_inflow correspondiente pasa a `received`.
    await tx.insert(schema.allocations).values(
      planLineRows
        .filter((l) => l.envelopeId !== null && l.tier === "base")
        .map((l) => ({
          envelopeId: l.envelopeId!,
          date: PERIOD,
          amount: l.amount,
          currency: l.currency,
          planId: plan.id,
          note: l.ruleApplied,
        })),
    );
  });

  /* ------------------------------------------------------------ verificación */

  const money = (v: unknown) =>
    Number(v).toLocaleString("es-AR", { maximumFractionDigits: 4 });

  const accounts = await accountBalances(db);
  const envelopes = await envelopeBalances(db);
  const pool = await unassignedPool(db);

  console.log("\n=== Saldos por cuenta ===");
  for (const r of accounts) {
    console.log(
      `  ${r.name.padEnd(30)} ${r.currency}  ${money(r.balance).padStart(14)}`,
    );
  }

  console.log("\n=== Saldos por sobre y moneda ===");
  for (const r of envelopes) {
    const detail =
      Number(r.spent) !== 0
        ? `   (asignado ${money(r.allocated)} − gastado ${money(r.spent)})`
        : "";
    console.log(
      `  ${r.name.padEnd(30)} ${r.currency}  ${money(r.balance).padStart(14)}${detail}`,
    );
  }

  console.log("\n=== Pool sin asignar ===");
  for (const r of pool) {
    console.log(
      `  ${r.currency}  activos ${money(r.assets).padStart(14)}  en sobres ${money(r.enveloped).padStart(14)}  pool ${money(r.pool).padStart(12)}`,
    );
  }

  const inflows = await db.execute(dsql`
    select s.name, i.amount::text as amount, i.currency, i.expected_date::text as expected_date, i.status
    from expected_inflows i join income_sources s on s.id = i.income_source_id
    order by i.expected_date
  `);
  console.log("\n=== Cobros esperados (no asignados) ===");
  for (const r of inflows as unknown as Record<string, string>[]) {
    console.log(
      `  ${r.name.padEnd(24)} ${money(r.amount).padStart(12)} ${r.currency}  ${r.expected_date}  ${r.status}`,
    );
  }

  const planTotals = await db.execute(dsql`
    select tier, sum(amount)::text as total, count(*)::int as lines
    from plan_lines group by tier order by tier
  `);

  // Antes del plan: cuánta plata de la apertura no tenía propósito.
  const openingPool = await db.execute(dsql`
    select (
      (select sum(e.amount) from entries e join accounts a on a.id = e.account_id
       where a.type = 'asset' and a.currency = 'ARS')
      - (select sum(amount) from allocations where currency = 'ARS' and plan_id is null)
    )::text as pool
  `);

  console.log("\n=== Totales del plan de octubre ===");
  for (const r of planTotals as unknown as Record<string, string>[]) {
    console.log(`  ${String(r.tier).padEnd(20)} ${money(r.total).padStart(12)} ARS  (${r.lines} líneas)`);
  }

  /* -------------------------------- asserts contra los números de la spec --- */

  const expect = (label: string, actual: string, expected: string) => {
    if (Number(actual) !== Number(expected)) {
      throw new Error(
        `Seed inconsistente — ${label}: esperado ${expected}, obtenido ${actual}`,
      );
    }
    console.log(`  ✓ ${label}: ${money(actual)}`);
  };

  const row = (r: unknown) => r as unknown as Record<string, string>[];

  console.log("\n=== Contra la spec ===");
  // §5: "2.706.000 ARS estaban sin propósito asignado"
  expect("pool sin asignar a la apertura (ARS)", row(openingPool)[0].pool, "2706000");
  // §5: piso = 2.691.000 (= saldo de apertura de BBVA), variable = 5.980.000
  const totals = Object.fromEntries(row(planTotals).map((r) => [r.tier, r.total]));
  expect("plan · nivel piso (ARS)", totals.base, "2691000");
  expect("plan · nivel variable (ARS)", totals.recurring_variable, "5980000");

  // El fondo de emergencia recibe lo mismo que en §5 (1.872.000 = 1.208 USD,
  // que sobre los 792 que ya tenía completa los 2.000), solo que repartido
  // distinto entre los niveles ahora que el piso cubre las suscripciones.
  const byEnvelope = await db.execute<{ name: string; total: string }>(dsql`
    select e.name, sum(l.amount)::text as total
    from plan_lines l join envelopes e on e.id = l.envelope_id
    group by e.name
  `);
  const perEnvelope = Object.fromEntries(
    (byEnvelope as unknown as { name: string; total: string }[]).map((r) => [
      r.name,
      r.total,
    ]),
  );
  expect("plan · fondo de emergencia (ARS)", perEnvelope["Fondo de emergencia"], "1872000");
  expect("plan · suscripciones (ARS)", perEnvelope["Suscripciones"], "176421");

  const usdCard = await db.execute<{ total: string }>(dsql`
    select sum(e.amount)::text as total from entries e
    join accounts a on a.id = e.account_id
    where a.name = 'Tarjeta de crédito BBVA — USD'
  `);
  expect("resumen en dólares a pagar", row(usdCard)[0].total, "-221");

  const monthlyUsd = await db.execute<{ total: string }>(dsql`
    select sum(e.amount)::text as total
    from entries e join accounts a on a.id = e.account_id
    where a.type = 'expense' and e.currency = 'USD'
  `);
  expect("gasto en dólares de octubre", row(monthlyUsd)[0].total, "221");

  // Lo que queda sin propósito despues de aprobar el piso: los 200.000 del
  // resumen de la tarjeta (que no es un sobre) + los 15.000 que ya estaban en
  // Mercado Pago. Los 5.980.000 del nivel variable no están asignados porque
  // todavía no entraron.
  expect("pool sin asignar post-plan (ARS)", pool[0].pool, "215000");
  // El pool en USD da 221 justo porque la fórmula de §6 no mira los pasivos:
  // son los dólares del fondo que van a pagar el resumen, y que ningún sobre
  // reclama. Mismo efecto que los 200.000 del resumen en pesos.
  expect("pool sin asignar post-plan (USD)", pool[1].pool, "221");

  const worth = await netWorth(db, { in: "ARS", rate: USD_ARS, from: "USD" });
  // §5 da 8.358.100 porque no resta ninguna deuda de tarjeta y redondea el
  // tramo USD. Restando los dos resúmenes a pagar — 200.000 ARS y 221 USD, que
  // a 1.550 son 342.550 — y con el dólar exacto: 7.815.800.
  expect("patrimonio total (ARS)", worth, "7815800");

  const invariant = await db.execute(dsql`
    select count(*)::int as unbalanced from (
      select transaction_id, currency from entries
      group by transaction_id, currency having sum(amount) <> 0
    ) x
  `);
  expect("transacciones desbalanceadas", row(invariant)[0].unbalanced, "0");

  console.log("\nSeed OK.\n");
  await client.end();

}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
