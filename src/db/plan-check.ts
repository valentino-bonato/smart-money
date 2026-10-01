/**
 * Corre el motor del planner sobre octubre 2026 con los montos de §5 y lo
 * compara con el plan que el seed armó a mano desde la spec.
 *
 * Si el motor reproduce el plan que Valentino calculó a mano, las reglas de §4
 * están bien escritas. Si propone algo que él no haría, la regla está mal — es
 * literalmente la primera línea del checklist de validación de §8.
 */
import { sql as dsql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadEnv } from "./env";
import { computePlan } from "./planner";
import * as schema from "./schema";

async function main() {
  const client = postgres(loadEnv(), { max: 1 });
  const db = drizzle(client, { schema });
  let failures = 0;

  const money = (v: string) =>
    Number(v).toLocaleString("es-AR", { maximumFractionDigits: 2 });

  const [user] = await db.select().from(schema.users).limit(1);
  const envelopes = await db.select().from(schema.envelopes);
  const env = (name: string) => {
    const row = envelopes.find((e) => e.name === name);
    if (!row) throw new Error(`Sobre inexistente: ${name}`);
    return row.id;
  };

  // Los mismos montos de §5: el piso sobre los 2.691.000 que había en la caja
  // de ahorro, y el variable sobre consultoría 4.780.000 + hito 1.200.000.
  // El puntual del mes es el cumple de Rochi: no hay regla que lo invente.
  const plan = await computePlan(db, {
    userId: user.id,
    period: "2026-10-01",
    rate: "1550",
    available: { base: "2691000", recurring_variable: "5980000", milestone: "0" },
    extras: [
      {
        envelopeId: env("Puntuales del mes"),
        amount: "200000",
        note: "cumple de Rochi",
      },
    ],
  });

  console.log("\n### Cascada calculada por el motor");
  for (const l of plan.lines) {
    const target = l.envelopeName ?? `${l.accountName} (pago)`;
    console.log(
      `  ${String(l.sequence).padStart(2)} ${l.tier === "base" ? "piso" : "var "} ` +
        `${target.padEnd(28)} ${money(l.amount).padStart(11)}  ${l.ruleApplied}`,
    );
  }

  // El plan que el seed armó a mano desde §5.
  const seeded = await db.execute<{
    name: string;
    tier: string;
    total: string;
  }>(dsql`
    select coalesce(e.name, a.name || ' (pago)') as name, l.tier,
           sum(l.amount)::text as total
    from plan_lines l
    left join envelopes e on e.id = l.envelope_id
    left join accounts a on a.id = l.account_id
    group by 1, 2
  `);

  const key = (name: string, tier: string) => `${tier}·${name}`;
  const expected = new Map<string, string>();
  for (const r of seeded as unknown as {
    name: string;
    tier: string;
    total: string;
  }[]) {
    expected.set(key(r.name, r.tier), r.total);
  }

  const got = new Map<string, bigint>();
  for (const l of plan.lines) {
    const name = l.envelopeName ?? `${l.accountName} (pago)`;
    const k = key(name, l.tier);
    got.set(k, (got.get(k) ?? 0n) + BigInt(Math.round(Number(l.amount) * 10000)));
  }

  console.log("\n### Motor vs. el plan de §5");
  const keys = new Set([...expected.keys(), ...got.keys()]);
  for (const k of [...keys].sort()) {
    const want = expected.get(k);
    const have = got.get(k);
    const haveStr = have === undefined ? null : (Number(have) / 10000).toString();
    // Tolerancia de 500 pesos por línea: §5 redondeó a mano los montos en
    // dólares (824 USD a 1.550 son 1.277.200 y la spec escribió 1.277.000).
    // El motor calcula exacto; los totales por nivel sí tienen que dar igual.
    const ok =
      want !== undefined &&
      haveStr !== null &&
      Math.abs(Number(want) - Number(haveStr)) <= 500;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "✓" : "✗"} ${k.padEnd(42)} ${
        haveStr === null ? "(falta)" : money(haveStr)
      }${ok ? "" : `   esperado ${want === undefined ? "(nada)" : money(want)}`}`,
    );
  }

  console.log("\n### Transferencias a ejecutar");
  let transferTotal = 0n;
  for (const t of plan.transfers) {
    transferTotal += BigInt(Math.round(Number(t.amount) * 10000));
    console.log(
      `  ${t.accountName.padEnd(28)} mandar ${money(t.amount).padStart(11)} ${t.currency}` +
        (t.needsExchange ? `   → comprar ${t.destinationCurrency}` : ""),
    );
  }
  for (const l of plan.lines.filter((x) => x.accountId)) {
    transferTotal += BigInt(
      Math.round(
        Number(l.amount) * 10000 * (l.currency === "ARS" ? 1 : Number(plan.rate)),
      ),
    );
    console.log(
      `  ${String(l.accountName).padEnd(28)} pagar  ${money(l.amount).padStart(11)} ${l.currency}`,
    );
  }

  // Todo peso asignado tiene un destino: la suma de las transferencias más los
  // pagos tiene que dar el total del plan.
  const planTotal = plan.lines.reduce(
    (acc, l) =>
      acc +
      BigInt(
        Math.round(
          Number(l.amount) * 10000 * (l.currency === "ARS" ? 1 : Number(plan.rate)),
        ),
      ),
    0n,
  );
  const balanced = transferTotal === planTotal;
  if (!balanced) failures++;
  console.log(
    `  ${balanced ? "✓" : "✗"} las transferencias cubren todo el plan: ${money(
      (Number(transferTotal) / 10000).toString(),
    )}${balanced ? "" : ` vs plan ${money((Number(planTotal) / 10000).toString())}`}`,
  );

  console.log("\n### Cobros esperados · se muestran, no se asignan");
  for (const e of plan.expected) {
    console.log(
      `  ${e.source.padEnd(24)} ${money(e.amount).padStart(11)} ${e.currency}  ${e.expectedDate ?? "sin fecha"}`,
    );
  }

  console.log("\n### Totales por nivel");
  for (const tier of ["base", "recurring_variable"] as const) {
    const total = plan.lines
      .filter((l) => l.tier === tier)
      .reduce(
        (acc, l) =>
          acc +
          BigInt(
            Math.round(
              Number(l.amount) *
                10000 *
                (l.currency === "ARS" ? 1 : Number(plan.rate)),
            ),
          ),
        0n,
      );
    const expectedTotal = tier === "base" ? 2691000 : 5980000;
    const got = Number(total) / 10000;
    const ok = Math.abs(got - expectedTotal) < 0.005;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "✓" : "✗"} ${tier.padEnd(20)} ${money(got.toString()).padStart(11)}` +
        (ok ? "" : `   esperado ${money(expectedTotal.toString())}`),
    );
  }

  console.log(
    failures === 0
      ? "\nEl motor reproduce el plan de §5.\n"
      : `\n${failures} diferencias con §5.\n`,
  );
  await client.end();
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
