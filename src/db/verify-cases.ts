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
import { payeeSuggestions } from "./queries";
import { MoneyParseError, parseAmountInput } from "../lib/money";
import { prepareRecurringCharges } from "./recurring";
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

  /* ------------------------------------------- parseo de montos (UI) --- */
  // Cómo se escribe plata de verdad en Argentina. El caso que importa es
  // "1.550": en esta app es mil quinientos cincuenta, no uno con 55.
  console.log("\n### Parseo de montos");
  for (const [input, expected] of [
    ["25000", "25000"],
    ["25.000", "25000"],
    ["25.000,50", "25000.50"],
    ["25000.50", "25000.50"],
    ["1.550", "1550"],
    ["1.55", "1.55"],
    ["1.234.567", "1234567"],
    ["113,82", "113.82"],
    [" 240000 ", "240000"],
  ] as const) {
    const got = parseAmountInput(input);
    const ok = got === expected;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "✓" : "✗"} "${input}" → ${got}${ok ? "" : `  (esperado ${expected})`}`,
    );
  }
  for (const bad of ["", "0", "abc", "1,2,3", "1.0000001", "1.5500", "25,12345"]) {
    try {
      parseAmountInput(bad);
      failures++;
      console.log(`  ✗ "${bad}": NO falló, y debía fallar`);
    } catch (err) {
      if (!(err instanceof MoneyParseError)) throw err;
      console.log(`  ✓ "${bad}" rechazado: ${err.message}`);
    }
  }

  /* --------------------------------- sugerencia por comercio (UI) --- */
  // El corazón de la reducción de fricción de §8: la segunda vez que cargás
  // "Coto" no tenés que elegir ni categoría ni sobre.
  console.log("\n### Sugerencia por comercio");
  {
    const before = await payeeSuggestions(db, { userId: user.id });
    check(
      "Carrefour todavía no se conoce",
      String(before.filter((s) => s.payee === "Carrefour").length),
      "0",
    );

    // Dos cargas en Carrefour, la segunda desde otra cuenta.
    for (const paidFrom of ["Mercado Pago", "BBVA caja de ahorro"]) {
      const { id } = await recordExpense(db, {
        userId: user.id,
        date: DATE,
        amount: "18000",
        currency: "ARS",
        paidFromAccountId: acct(paidFrom),
        expenseAccountId: acct("Gastos:Comida y súper"),
        envelopeId: env("Comida y súper"),
        payee: "Carrefour",
      });
      created.push(id);
    }

    const after = await payeeSuggestions(db, { userId: user.id });
    const coto = after.find((s) => s.payee === "Carrefour");
    if (!coto) {
      failures++;
      console.log("  ✗ Carrefour no apareció en las sugerencias");
    } else {
      check("Carrefour · veces usado", String(coto.timesUsed), "2");
      check(
        "Carrefour · sugiere la categoría",
        coto.expenseAccountId === acct("Gastos:Comida y súper") ? "1" : "0",
        "1",
      );
      check(
        "Carrefour · sugiere el sobre",
        coto.envelopeId === env("Comida y súper") ? "1" : "0",
        "1",
      );
      // La cuenta sugerida es la de la ÚLTIMA carga, no la primera.
      check(
        "Carrefour · sugiere la última cuenta usada",
        coto.paidFromAccountId === acct("BBVA caja de ahorro") ? "1" : "0",
        "1",
      );
      // El más usado va primero: ordena la lista del comercio.
      check(
        "Carrefour · primero en la lista",
        after[0].payee === "Carrefour" ? "1" : "0",
        "1",
      );
    }
  }

  /* ------------------------------------------------ gastos recurrentes --- */
  console.log("\n### Gastos recurrentes · preparar el resumen del mes");
  {
    // Octubre ya trae del seed los 3 cargos de suscripciones, con el monto
    // real del resumen. Las clases de inglés, en cambio, todavía no se
    // pagaron: el saldo de apertura de la caja de ahorro es el sueldo sin
    // tocar. Así que preparar octubre crea una sola cosa.
    const oct = await prepareRecurringCharges(db, {
      userId: user.id,
      period: "2026-10-01",
    });
    for (const c of oct) if (c.transactionId) created.push(c.transactionId);
    check(
      "octubre · suscripciones ya estaban",
      String(oct.filter((c) => c.alreadyThere).length),
      "3",
    );
    check(
      "octubre · solo se crea el inglés",
      String(oct.filter((c) => !c.alreadyThere).map((c) => c.name).length),
      "1",
    );
    check(
      "octubre · deuda en dólares sin cambios",
      await balance("Tarjeta de crédito BBVA — USD"),
      "-221",
    );
    check(
      "octubre · sobre Inglés consumido",
      await envelopeBalance("Inglés", "ARS"),
      "0",
    );

    // Noviembre no tiene nada: se crean los cuatro con el precio de lista.
    const nov = await prepareRecurringCharges(db, {
      userId: user.id,
      period: "2026-11-01",
    });
    for (const c of nov) {
      console.log(
        `    ${c.name.padEnd(18)} ${c.date}  ${money(c.amount).padStart(9)} ${c.currency}`,
      );
      if (c.transactionId) created.push(c.transactionId);
    }
    check(
      "noviembre · creados",
      String(nov.filter((c) => !c.alreadyThere).length),
      "4",
    );
    // Por moneda: sumar ARS y USD daría un número sin significado.
    const novBy = (currency: string) =>
      sumAmounts(
        nov.filter((c) => c.currency === currency).map((c) => c.amount),
      );
    // 100 + 12 + 1,82 de precio de lista, no los 144 del resumen de octubre.
    check("noviembre · suscripciones (USD)", novBy("USD"), "113.82");
    check("noviembre · inglés (ARS)", novBy("ARS"), "240000");

    // Y una segunda corrida de noviembre no duplica nada.
    const novAgain = await prepareRecurringCharges(db, {
      userId: user.id,
      period: "2026-11-01",
    });
    check(
      "noviembre · idempotente",
      String(novAgain.filter((c) => c.alreadyThere).length),
      "4",
    );
    check(
      "noviembre · deuda sin cambios",
      await balance("Tarjeta de crédito BBVA — USD"),
      "-334.82",
    );
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
  // En ARS: el caso 0 (25.000), las dos cargas de Coto de la prueba de
  // sugerencias (18.000 x 2) y las clases de inglés que creó la prueba de
  // recurrentes (240.000). Los tres casos raros movieron plata y no aparecen
  // acá, que es el punto de §8.
  check("gasto del mes en ARS", totalBy("ARS"), "301000");
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
