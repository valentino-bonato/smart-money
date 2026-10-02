/**
 * Esquema de smart-money — §6 de la spec.
 *
 * Dos reglas verificadas contra drizzle-orm@0.45.3 (no de memoria):
 *
 *  1. `numeric()` mapea a `string` en JS (PgNumericBuilderInitial: dataType 'string',
 *     data: string, mapFromDriverValue(): string). La plata NUNCA pasa por `number`:
 *     no se usa `numeric({ mode: 'number' })` en ningún punto del codigo.
 *  2. El tercer callback de `pgTable` devuelve un ARRAY (`PgTableExtraConfigValue[]`).
 *     La forma objeto está marcada `@deprecated` en los tipos de esta versión.
 *
 * Los nombres de columna se escriben explícitos en snake_case para no depender
 * de la config de `casing` de drizzle-kit.
 */
import { relations } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ enums */

export const currency = pgEnum("currency", ["ARS", "USD"]);
export const accountType = pgEnum("account_type", [
  "asset",
  "liability",
  "income",
  "expense",
  "equity",
]);
export const envelopeKind = pgEnum("envelope_kind", ["spending", "goal"]);
export const rolloverMode = pgEnum("rollover_mode", ["accumulate", "reset"]);
export const incomeTier = pgEnum("income_tier", [
  "base",
  "recurring_variable",
  "milestone",
]);
export const planStatus = pgEnum("plan_status", ["draft", "approved", "closed"]);
export const inflowStatus = pgEnum("inflow_status", [
  "expected",
  "received",
  "cancelled",
]);
export const contributionRule = pgEnum("contribution_rule", [
  "fixed",
  "deadline",
  "remainder",
  "percent",
]);

/* ------------------------------------------------------------------ users */

// Un solo usuario en el v1, pero user_id está presente en todas las tablas
// raíz desde el día 1 para que multiusuario + RLS no requiera migrar datos.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* -------------------------------------------------------- núcleo contable */

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: accountType("type").notNull(),
    // Una cuenta = una moneda. Cocos son dos cuentas.
    currency: currency("currency").notNull(),
    institution: text("institution"),
    // Equity:Opening:*, Equity:FX:* — las maneja la app, el usuario no las ve.
    isSystem: boolean("is_system").notNull().default(false),
    archivedAt: date("archived_at"),
    displayOrder: integer("display_order").notNull().default(0),
  },
  (t) => [unique("accounts_user_name").on(t.userId, t.name)],
);

export const envelopes = pgTable(
  "envelopes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: envelopeKind("kind").notNull(),
    rollover: rolloverMode("rollover").notNull(),
    archivedAt: date("archived_at"),
    displayOrder: integer("display_order").notNull().default(0),
    // Solo si es meta:
    targetAmount: numeric("target_amount", { precision: 20, scale: 4 }),
    targetCurrency: currency("target_currency"),
    targetDate: date("target_date"),
    deadlineHard: boolean("deadline_hard").notNull().default(false),
    contributionRule: contributionRule("contribution_rule"),
    contributionAmount: numeric("contribution_amount", {
      precision: 20,
      scale: 4,
    }),
    // El aporte tiene su propia moneda: el del viaje son 824 USD y el de
    // "Auto — corriente" son 450.000 ARS. No se puede derivar de
    // target_currency, porque un sobre de gasto puede tener aporte en USD sin
    // tener objetivo (las suscripciones cuestan 113,82 USD y se pagan con una
    // tarjeta en ARS).
    contributionCurrency: currency("contribution_currency"),
    // Dónde tiene que vivir físicamente la plata de este sobre. La spec no lo
    // modela: §5 deduce a mano que los 450.000 del auto van a la cuenta
    // corriente y los 7.441.000 de las metas a Cocos. Sin esta columna el
    // planner no puede devolver la lista de transferencias concretas, que es
    // el criterio de éxito de la pantalla del plan en §7.
    // null = la plata se queda donde está (no hay transferencia que hacer).
    settlementAccountId: uuid("settlement_account_id").references(
      (): AnyPgColumn => accounts.id,
      { onDelete: "set null" },
    ),
  },
  (t) => [
    unique("envelopes_user_name").on(t.userId, t.name),
    // Si hay monto objetivo tiene que haber moneda objetivo, y viceversa.
    check(
      "envelopes_target_currency_pair",
      sql`(${t.targetAmount} is null) = (${t.targetCurrency} is null)`,
    ),
    check(
      "envelopes_contribution_currency_pair",
      sql`(${t.contributionAmount} is null) = (${t.contributionCurrency} is null)`,
    ),
  ],
);

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Día 1 del mes.
    period: date("period").notNull(),
    status: planStatus("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (t) => [unique("plans_user_period").on(t.userId, t.period)],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    description: text("description"),
    payee: text("payee"),
    planId: uuid("plan_id").references(() => plans.id, {
      onDelete: "set null",
    }),
    // Si el asiento lo generó una suscripción, queda linkeado para que
    // regenerar el mes no duplique el cargo.
    recurringExpenseId: uuid("recurring_expense_id").references(
      (): AnyPgColumn => recurringExpenses.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("transactions_user_date_idx").on(t.userId, t.date),
    index("transactions_payee_idx").on(t.userId, t.payee),
    index("transactions_plan_idx").on(t.planId),
    // Una suscripción genera como máximo un asiento por mes: hace que el
    // generador sea idempotente sin tener que consultar antes de escribir.
    uniqueIndex("transactions_recurring_month_idx")
      // Cast explícito a timestamp: date_trunc sobre una columna `date`
      // resuelve a la variante timestamptz, que es STABLE y Postgres no la
      // acepta en una expresión de índice.
      .on(t.recurringExpenseId, sql`date_trunc('month', ${t.date}::timestamp)`)
      .where(sql`${t.recurringExpenseId} is not null`),
  ],
);

export const entries = pgTable(
  "entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    // string en JS. Nunca number.
    amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
    // Desnormalizado a propósito (duplica accounts.currency) para que el
    // trigger del invariante no necesite join. entries_currency_matches_account
    // valida que coincidan.
    currency: currency("currency").notNull(),
    // Solo tiene sentido en cuentas expense (de qué sobre salió) y en income
    // para reembolsos. Se valida con trigger porque requiere join a
    // accounts.type — es la única regla de integridad no declarativa.
    envelopeId: uuid("envelope_id").references(() => envelopes.id),
  },
  (t) => [
    check("entries_amount_nonzero", sql`${t.amount} <> 0`),
    index("entries_transaction_idx").on(t.transactionId),
    index("entries_account_idx").on(t.accountId, t.currency),
    index("entries_envelope_idx").on(t.envelopeId, t.currency),
  ],
);

/* -------------------------------------------------------- sobres y metas */

// Libro SEPARADO del contable. Asignar 1.277.000 al viaje no mueve plata de
// ninguna cuenta: es una fila acá. Mover entre sobres son dos filas.
// Devolver al pool es una fila negativa.
export const allocations = pgTable(
  "allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    envelopeId: uuid("envelope_id")
      .notNull()
      .references(() => envelopes.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
    currency: currency("currency").notNull(),
    planId: uuid("plan_id").references(() => plans.id, { onDelete: "cascade" }),
    // Qué línea del plan materializó esta asignación. Sin esto no se puede
    // saber qué parte del plan ya se aplicó, y replanificar el mes vuelve a
    // proponer lo que ya se hizo. Matchear por sobre no alcanza: el viaje
    // tiene una línea en el piso y otra en el nivel variable.
    planLineId: uuid("plan_line_id").references((): AnyPgColumn => planLines.id, {
      onDelete: "set null",
    }),
    note: text("note"),
  },
  (t) => [
    check("allocations_amount_nonzero", sql`${t.amount} <> 0`),
    index("allocations_envelope_idx").on(t.envelopeId, t.currency),
    index("allocations_plan_idx").on(t.planId),
  ],
);

/* ---------------------------------------------------------------- ingresos */

export const incomeSources = pgTable(
  "income_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tier: incomeTier("tier").notNull(),
    // La cuenta de ingreso que representa esta fuente. Sin esto el planner
    // tiene que adivinar el vínculo por nombre, y un renombre lo haría leer
    // "no entró nada" en silencio — el peor modo de falla posible en la
    // cascada, porque no asignar se ve igual que no tener plata.
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    expectedAmount: numeric("expected_amount", { precision: 20, scale: 4 }),
    currency: currency("currency").notNull(),
    dayOfMonth: integer("day_of_month"),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    unique("income_sources_user_name").on(t.userId, t.name),
    check(
      "income_sources_day_of_month_range",
      sql`${t.dayOfMonth} is null or (${t.dayOfMonth} between 1 and 28)`,
    ),
  ],
);

// Los hitos futuros se registran con monto y fecha estimada, se muestran y
// NO se asignan hasta que entran.
export const expectedInflows = pgTable("expected_inflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  incomeSourceId: uuid("income_source_id")
    .notNull()
    .references(() => incomeSources.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
  currency: currency("currency").notNull(),
  expectedDate: date("expected_date"),
  confidence: numeric("confidence", { precision: 5, scale: 4 }),
  status: inflowStatus("status").notNull().default("expected"),
  receivedTransactionId: uuid("received_transaction_id").references(
    () => transactions.id,
    { onDelete: "set null" },
  ),
});

/* ----------------------------------------------------------------- planner */

export const planLines = pgTable(
  "plan_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    // Línea de asignación a un sobre...
    envelopeId: uuid("envelope_id").references(() => envelopes.id),
    // ...o línea de pago a una cuenta (el resumen de la tarjeta no es una
    // asignación: los consumos ya se tagearon a su sobre al consumirse, así
    // que reservar un sobre "Tarjeta" contaría doble).
    accountId: uuid("account_id").references(() => accounts.id),
    amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
    currency: currency("currency").notNull(),
    tier: incomeTier("tier").notNull(),
    ruleApplied: text("rule_applied"),
    sequence: integer("sequence").notNull(),
  },
  (t) => [
    unique("plan_lines_plan_sequence").on(t.planId, t.sequence),
    check(
      "plan_lines_target_exactly_one",
      sql`(${t.envelopeId} is null) <> (${t.accountId} is null)`,
    ),
  ],
);

/* --------------------------------------------------------------- operación */

// Fallback al último precio conocido menor o igual a la fecha.
export const prices = pgTable(
  "prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date").notNull(),
    base: currency("base").notNull(),
    quote: currency("quote").notNull(),
    rate: numeric("rate", { precision: 20, scale: 6 }).notNull(),
    source: text("source").notNull(),
  },
  (t) => [
    unique("prices_date_base_quote_source").on(t.date, t.base, t.quote, t.source),
    check("prices_base_not_quote", sql`${t.base} <> ${t.quote}`),
    // Fallback al último precio conocido <= fecha.
    index("prices_lookup_idx").on(t.base, t.quote, t.date),
  ],
);

export const reconciliations = pgTable("reconciliations", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  statementBalance: numeric("statement_balance", {
    precision: 20,
    scale: 4,
  }).notNull(),
  computedBalance: numeric("computed_balance", {
    precision: 20,
    scale: 4,
  }).notNull(),
  difference: numeric("difference", { precision: 20, scale: 4 }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const recurringExpenses = pgTable(
  "recurring_expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // De dónde sale la plata (asset o liability).
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // La categoría: la cuenta de gasto.
    expenseAccountId: uuid("expense_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    envelopeId: uuid("envelope_id")
      .notNull()
      .references(() => envelopes.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 20, scale: 4 }).notNull(),
    currency: currency("currency").notNull(),
    dayOfMonth: integer("day_of_month").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    unique("recurring_expenses_user_name").on(t.userId, t.name),
    check(
      "recurring_expenses_day_of_month_range",
      sql`${t.dayOfMonth} between 1 and 28`,
    ),
  ],
);

/* -------------------------------------------------------------- relaciones */

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  envelopes: many(envelopes),
  transactions: many(transactions),
  plans: many(plans),
  incomeSources: many(incomeSources),
  recurringExpenses: many(recurringExpenses),
}));

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
  entries: many(entries),
  reconciliations: many(reconciliations),
}));

export const envelopesRelations = relations(envelopes, ({ one, many }) => ({
  user: one(users, { fields: [envelopes.userId], references: [users.id] }),
  settlementAccount: one(accounts, {
    fields: [envelopes.settlementAccountId],
    references: [accounts.id],
  }),
  allocations: many(allocations),
  entries: many(entries),
  planLines: many(planLines),
}));

export const transactionsRelations = relations(
  transactions,
  ({ one, many }) => ({
    user: one(users, { fields: [transactions.userId], references: [users.id] }),
    plan: one(plans, { fields: [transactions.planId], references: [plans.id] }),
    recurringExpense: one(recurringExpenses, {
      fields: [transactions.recurringExpenseId],
      references: [recurringExpenses.id],
    }),
    entries: many(entries),
  }),
);

export const entriesRelations = relations(entries, ({ one }) => ({
  transaction: one(transactions, {
    fields: [entries.transactionId],
    references: [transactions.id],
  }),
  account: one(accounts, {
    fields: [entries.accountId],
    references: [accounts.id],
  }),
  envelope: one(envelopes, {
    fields: [entries.envelopeId],
    references: [envelopes.id],
  }),
}));

export const allocationsRelations = relations(allocations, ({ one }) => ({
  planLine: one(planLines, {
    fields: [allocations.planLineId],
    references: [planLines.id],
  }),
  envelope: one(envelopes, {
    fields: [allocations.envelopeId],
    references: [envelopes.id],
  }),
  plan: one(plans, { fields: [allocations.planId], references: [plans.id] }),
}));

export const plansRelations = relations(plans, ({ one, many }) => ({
  user: one(users, { fields: [plans.userId], references: [users.id] }),
  lines: many(planLines),
  allocations: many(allocations),
}));

export const planLinesRelations = relations(planLines, ({ one }) => ({
  plan: one(plans, { fields: [planLines.planId], references: [plans.id] }),
  envelope: one(envelopes, {
    fields: [planLines.envelopeId],
    references: [envelopes.id],
  }),
  account: one(accounts, {
    fields: [planLines.accountId],
    references: [accounts.id],
  }),
}));

export const incomeSourcesRelations = relations(
  incomeSources,
  ({ one, many }) => ({
    user: one(users, { fields: [incomeSources.userId], references: [users.id] }),
    account: one(accounts, {
      fields: [incomeSources.accountId],
      references: [accounts.id],
    }),
    expectedInflows: many(expectedInflows),
  }),
);

export const expectedInflowsRelations = relations(
  expectedInflows,
  ({ one }) => ({
    incomeSource: one(incomeSources, {
      fields: [expectedInflows.incomeSourceId],
      references: [incomeSources.id],
    }),
    receivedTransaction: one(transactions, {
      fields: [expectedInflows.receivedTransactionId],
      references: [transactions.id],
    }),
  }),
);

export const reconciliationsRelations = relations(
  reconciliations,
  ({ one }) => ({
    account: one(accounts, {
      fields: [reconciliations.accountId],
      references: [accounts.id],
    }),
  }),
);

export const recurringExpensesRelations = relations(
  recurringExpenses,
  ({ one }) => ({
    user: one(users, {
      fields: [recurringExpenses.userId],
      references: [users.id],
    }),
    account: one(accounts, {
      fields: [recurringExpenses.accountId],
      references: [accounts.id],
    }),
    expenseAccount: one(accounts, {
      fields: [recurringExpenses.expenseAccountId],
      references: [accounts.id],
    }),
    envelope: one(envelopes, {
      fields: [recurringExpenses.envelopeId],
      references: [envelopes.id],
    }),
  }),
);
