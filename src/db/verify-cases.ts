/**
 * Prueba de los 3 casos raros de §8, contra la base de verdad.
 *
 *   "Probar los 3 casos raros: compra de dólares, pago de resumen,
 *    transferencia al auto. Ninguno debe aparecer como gasto del mes."
 *
 * Cada caso se COMMITEA de verdad, porque el invariante vive en un constraint
 * trigger deferido: si se hiciera rollback, el trigger no llegaría a correr y
 * la prueba no probaría nada. Al final se borran los asientos de prueba y se
 * revalida que la base quedó como estaba.
 *
 * Correr después del seed: `npm run db:seed && npm run db:verify`
 */
import { eq, sql as dsql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadEnv } from "./env";
import {
  convert,
  createTransaction,
  exchangeCurrency,
  rateAt,
  recordCardPayment,
  recordExpense,
  recordTransfer,
  sumAmounts,
} from "./ledger";
import * as schema from "./schema";

async function main() {
  const client = postgres(loadEnv(), { max: 1 });
  const db = drizzle(client, { schema });

  const DATE = "2026-10-05";
  let failures = 0;
  const created: string[] = [];

  const money = (v: string) =>
    Number(v).toLocaleString("es-AR", { maximumFractionDigits: 4 });

  function check(label: string, actual: string, expected: string) {
    const ok = Number(actual) === Number(expected);
    if (!ok) failures++;
    console.log(
      `  ${ok ? "✓" : "✗"} ${label}: ${money(actual)}${ok ? "" : `  (esperado ${money(expected)})`}`,
    );
  }

  async function balance(name: string): Promise<string> {
    const [row] = await db.execute<{ total: string }>(dsql`
      select coalesce(sum(e.amount), 0)::text as total
      from accounts a left join entries e on e.account_id = a.id
      where a.name = ${name}
    `);
    return row.total;
  }

  async function envelopeBalance(name: string, currency: "ARS" | "USD") {
    const [row] = await db.execute<{ total: string }>(dsql`
      select (
        coalesce((select sum(al.amount) from allocations al
                  join envelopes e on e.id = al.envelope_id
                  where e.name = ${name} and al.currency = ${currency}), 0)
        - coalesce((select sum(en.amount) from entries en
                    join envelopes e on e.id = en.envelope_id
                    join accounts a on a.id = en.account_id
                    where e.name = ${name} and en.currency = ${currency}
                      and a.type = 'expense'), 0)
      )::text as total
    `);
    return row.total;
  }

  /** Gasto imputado a cuentas `expense` dentro de una transacción. */
  async function expenseOf(transactionId: string): Promise<string> {
    const [row] = await db.execute<{ total: string }>(dsql`
      select coalesce(sum(e.amount), 0)::text as total
      from entries e join accounts a on a.id = e.account_id
      where e.transaction_id = ${transactionId} and a.type = 'expense'
    `);
    return row.total;
  }

  const [user] = await db.select().from(schema.users).limit(1);
  const accounts = await db.select().from(schema.accounts);
  const envelopes = await db.select().from(schema.envelopes);
  const acct = (name: string) => {
    const row = accounts.find((a) => a.name === name);
    if (!row) throw new Error(`Cuenta inexistente: ${name}`);
    return row.id;
  };
  const env = (name: string) => {
    const row = envelopes.find((e) => e.name === name);
    if (!row) throw new Error(`Sobre inexistente: ${name}`);
    return row.id;
  };

  /* ---------------------------------------------------------------- caso 0 --- */
  console.log("\n### Caso 0 · un gasto normal SÍ es gasto, y sale de su sobre");
  {
    const before = await envelopeBalance("Comida y súper", "ARS");
    const { id } = await recordExpense(db, {
      userId: user.id,
      date: DATE,
      amount: "25000",
      currency: "ARS",
      paidFromAccountId: acct("Mercado Pago"),
      expenseAccountId: acct("Gastos:Comida y súper"),
      envelopeId: env("Comida y súper"),
      payee: "Coto",
    });
    created.push(id);
    check("gasto imputado", await expenseOf(id), "25000");
    check("saldo del sobre", await envelopeBalance("Comida y súper", "ARS"), "55000");
    check("Mercado Pago", await balance("Mercado Pago"), "-10000");
    console.log(`    (el sobre venía en ${money(before)})`);
  }

  /* ---------------------------------------------------------------- caso 1 --- */
  console.log("\n### Caso 1 · transferencia al auto — NO es gasto");
  {
    const { id } = await recordTransfer(db, {
      userId: user.id,
      date: DATE,
      amount: "450000",
      currency: "ARS",
      fromAccountId: acct("BBVA caja de ahorro"),
      toAccountId: acct("BBVA cuenta corriente"),
      description: "Plata del auto",
    });
    created.push(id);
    check("gasto imputado", await expenseOf(id), "0");
    check("BBVA corriente", await balance("BBVA cuenta corriente"), "450000");
    check("BBVA caja de ahorro", await balance("BBVA caja de ahorro"), "2241000");
    check(
      "sobre Auto — corriente intacto",
      await envelopeBalance("Auto — corriente", "ARS"),
      "450000",
    );
  }

  /* ---------------------------------------------------------------- caso 2 --- */
  console.log("\n### Caso 2 · pago del resumen de la tarjeta — NO es gasto");
  {
    check("deuda antes del pago", await balance("Tarjeta de crédito BBVA — ARS"), "-200000");
    const { id } = await recordCardPayment(db, {
      userId: user.id,
      date: DATE,
      amount: "200000",
      currency: "ARS",
      fromAccountId: acct("BBVA caja de ahorro"),
      cardAccountId: acct("Tarjeta de crédito BBVA — ARS"),
    });
    created.push(id);
    check("gasto imputado", await expenseOf(id), "0");
    check("deuda después del pago", await balance("Tarjeta de crédito BBVA — ARS"), "0");
    check("BBVA caja de ahorro", await balance("BBVA caja de ahorro"), "2041000");
  }

  /* ---------------------------------------------------------------- caso 3 --- */
  console.log("\n### Caso 3 · compra de dólares — NO es gasto");
  {
    const rate = await rateAt(db, {
      date: DATE,
      base: "USD",
      quote: "ARS",
      source: "oficial",
    });
    const ars = "2000000";
    // ARS / (ARS por USD) = USD. Se trunca: no se pueden comprar centavos que
    // el banco no te dio.
    const [{ usd }] = await db.execute<{ usd: string }>(
      dsql`select trunc(${ars}::numeric / ${rate}::numeric, 4)::text as usd`,
    );
    console.log(`    ${money(ars)} ARS @ ${money(rate)} = ${money(usd)} USD`);

    const { id } = await exchangeCurrency(db, {
      userId: user.id,
      date: DATE,
      fromAccountId: acct("BBVA caja de ahorro"),
      fromAmount: ars,
      fromCurrency: "ARS",
      fromFxAccountId: acct("Equity:FX:ARS"),
      toAccountId: acct("Cocos Capital — fondo USD"),
      toAmount: usd,
      toCurrency: "USD",
      toFxAccountId: acct("Equity:FX:USD"),
    });
    created.push(id);
    check("gasto imputado", await expenseOf(id), "0");
    check("BBVA caja de ahorro", await balance("BBVA caja de ahorro"), "41000");
    check("Cocos fondo USD", await balance("Cocos Capital — fondo USD"), sumAmounts(["1495", usd]));
    check("Equity:FX:ARS", await balance("Equity:FX:ARS"), ars);
    check("Equity:FX:USD", await balance("Equity:FX:USD"), `-${usd}`);
    // El conversor de la app tiene que dar lo mismo que la cuenta a mano.
    // 1290,3225 x 1550 = 1.999.999,875: el truncado deja 0,125 ARS sin
    // convertir, que es exactamente la diferencia de cambio que queda en las
    // cuentas de FX.
    check("convert() reconstruye los ARS", await convert(db, usd, rate), "1999999.875");
  }

  /* -------------------------------------------------- lo que debe fallar --- */
  console.log("\n### Rechazos esperados");
  async function mustFail(label: string, fn: () => Promise<unknown>) {
    try {
      await fn();
      failures++;
      console.log(`  ✗ ${label}: NO falló, y debía fallar`);
    } catch (err) {
      // El mensaje útil de un error de trigger viene en `cause`, no en el
      // "Failed query" que envuelve postgres-js.
      const e = err as Error & { cause?: Error };
      const msg = (e.cause?.message ?? e.message).split("\n")[0];
      console.log(`  ✓ ${label}: ${msg.slice(0, 95)}`);
    }
  }

  await mustFail("cruzar monedas sin cuentas de FX", () =>
    createTransaction(db, {
      userId: user.id,
      date: DATE,
      description: "compra de dólares mal hecha",
      entries: [
        { accountId: acct("BBVA caja de ahorro"), amount: "-1550", currency: "ARS" },
        { accountId: acct("Cocos Capital — fondo USD"), amount: "1", currency: "USD" },
      ],
    }),
  );

  await mustFail("sobre en una partida de cuenta asset", () =>
    createTransaction(db, {
      userId: user.id,
      date: DATE,
      description: "sobre mal puesto",
      entries: [
        {
          accountId: acct("BBVA caja de ahorro"),
          amount: "-1000",
          currency: "ARS",
          envelopeId: env("Amigos"),
        },
        { accountId: acct("Mercado Pago"), amount: "1000", currency: "ARS" },
      ],
    }),
  );

  await mustFail("monto con 5 decimales en numeric(20,4)", () =>
    recordTransfer(db, {
      userId: user.id,
      date: DATE,
      amount: "100.12345",
      currency: "ARS",
      fromAccountId: acct("Mercado Pago"),
      toAccountId: acct("BBVA caja de ahorro"),
    }),
  );

  /* ------------------------------------------------------------ gasto del mes */
  console.log("\n### Gasto de octubre por categoría");
  // Agrupado POR MONEDA: sumar ARS y USD en un mismo total daría un número
  // que no significa nada.
  const monthly = await db.execute<{
    name: string;
    currency: string;
    total: string;
  }>(dsql`
    select a.name, e.currency, sum(e.amount)::text as total
    from entries e
    join accounts a on a.id = e.account_id
    join transactions t on t.id = e.transaction_id
    where a.type = 'expense' and t.date >= '2026-10-01' and t.date < '2026-11-01'
    group by a.name, e.currency order by e.currency, a.name
  `);
  for (const r of monthly) {
    console.log(
      `  ${r.name.padEnd(28)} ${r.currency} ${money(r.total).padStart(12)}`,
    );
  }
  const totalBy = (currency: string) =>
    sumAmounts(
      monthly.filter((r) => r.currency === currency).map((r) => r.total),
    );
  // En ARS, solo el caso 0: los otros tres movieron plata y no son gasto.
  check("gasto del mes en ARS", totalBy("ARS"), "25000");
  // En USD, el resumen de la tarjeta que trae el seed: 77 + 100 + 42 + 2.
  check("gasto del mes en USD", totalBy("USD"), "221");

  /* --------------------------------------------------------------- limpieza */
  console.log("\n### Limpieza");
  for (const id of created) {
    await db.delete(schema.transactions).where(eq(schema.transactions.id, id));
  }
  const [{ unbalanced }] = await db.execute<{ unbalanced: number }>(dsql`
    select count(*)::int as unbalanced from (
      select transaction_id, currency from entries
      group by transaction_id, currency having sum(amount) <> 0
    ) x
  `);
  check("transacciones desbalanceadas", String(unbalanced), "0");
  check("BBVA caja de ahorro restaurado", await balance("BBVA caja de ahorro"), "2691000");
  check("Tarjeta ARS restaurada", await balance("Tarjeta de crédito BBVA — ARS"), "-200000");
  check("Tarjeta USD intacta", await balance("Tarjeta de crédito BBVA — USD"), "-221");
  check("Equity:FX:ARS restaurado", await balance("Equity:FX:ARS"), "0");

  console.log(failures === 0 ? "\nTodos los casos OK.\n" : `\n${failures} fallas.\n`);
  await client.end();
  if (failures > 0) process.exit(1);

}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
