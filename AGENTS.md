<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# smart-money

Spec de diseño (fuente de verdad): https://app.notion.com/p/3ec6a57ed8b281a1bc5dd65216dda7b0

## Reglas no negociables

1. **La plata es `string`, nunca `number`.** `numeric` mapea a `string` en
   Drizzle. No usar `numeric({ mode: "number" })` ni `Number(monto)` para
   aritmética — las sumas y restas de plata se hacen en SQL (`numeric`).
2. **Nunca guardar un saldo convertido.** Cada cuenta tiene su moneda, el sobre
   tiene saldo *por* moneda. La conversión vive en la operación de cambio
   (cuentas `Equity:FX:*`) y en la vista.
3. **El invariante no tiene excepciones:** `SUM(entries.amount) = 0` por
   (transacción, moneda). Vive como constraint trigger deferido en la base.
   Insertar partidas sueltas está bien *dentro* de una transacción.
4. **El tercer callback de `pgTable` devuelve un array**, no un objeto
   (verificado contra `drizzle-orm@0.45.3`: la forma objeto está `@deprecated`).
5. **Sin dashboards, gráficos ni KPIs en el v1.**

## Dónde está qué

- `src/db/schema.ts` — esquema completo (13 tablas)
- `drizzle/0000_*.sql` — tablas, enums, índices, checks
- `drizzle/0001_invariant_triggers.sql` — `assert_balanced` (deferido) y
  `entries_validate_account` (moneda + sobre según tipo de cuenta)
- `src/db/seed.ts` — datos reales al 1-oct-2026, con asserts contra la spec

## La tarjeta son dos cuentas

`Tarjeta de crédito BBVA — ARS` y `— USD`, por la misma razón que Cocos: el
resumen tiene un saldo en pesos (gastos extras) y uno en dólares (las
suscripciones), y cada uno se paga en su moneda. No hay recargo ni tipo de
cambio de tarjeta: las suscripciones se pagan directamente con dólares, así que
el único precio que interviene es el oficial.

Por eso `Gastos:Suscripciones` es una cuenta de gasto en **USD**: el gasto se
incurre en dólares. El sobre, en cambio, recibe pesos del piso y se convierte
al comprar los dólares — igual que el Viaje, que tiene 703 USD y 1.277.000 ARS
al mismo tiempo.

## Sobres

Son 10, no los 9 de la spec: se agregó **Suscripciones**, porque la cascada de
§4 trata la tarjeta solo como un pago y dejaba ~176.000 ARS por mes de gasto
fijo sin propósito asignado.

El aporte tiene moneda propia (`contribution_currency`), columna que la spec no
tiene. Hace falta porque el de Suscripciones son 113,82 **USD** aunque el sobre
se consuma en ARS: no se puede inferir de `target_currency`, que solo existe en
las metas.

## Cálculos derivados: un solo lugar

`src/db/queries.ts` tiene `envelopeBalances`, `unassignedPool`,
`accountBalances` y `netWorth`. **No reimplementar estas fórmulas en una
pantalla.** Si el saldo de un sobre se calcula distinto en dos lugares, la app
miente en uno de los dos.

El saldo del sobre es `Σ allocations − Σ partidas con envelope_id` — no solo las
allocations. Olvidarse de restar los gastos es el error fácil, y da un sobre que
nunca baja.

Dos límites conocidos de las fórmulas de §6:

- `unassignedPool` mira solo cuentas `asset`, así que un resumen de tarjeta
  pendiente no lo baja: el pool se ve más rico de lo que es por ese monto.
- El progreso de una meta NO es el saldo del sobre (ver abajo).

## Progreso de una meta ≠ saldo del sobre

Son dos números distintos y confundirlos rompe el catch-up:

- **progreso** = `Σ allocations`. El `target_amount` es el costo TOTAL de la
  meta, así que gastar del sobre en la meta misma (el hostel de Amsterdam) es la
  meta cumpliéndose, no plata que haya que volver a juntar.
- **available** = `progreso − gastado`. Responde "¿me queda plata del viaje?".

Si el progreso restara los gastos, cada pago adelantado pediría ahorrar ese
monto dos veces. `goalProgress()` en `queries.ts` lo implementa, y el seed
verifica que el catch-up (faltante ÷ meses restantes) reproduzca los aportes de
§4 — 824 USD del viaje y 863 del auto — desde los datos, sin escribirlos a mano.
Si tocás el modelo de metas y esos dos números se mueven, rompiste algo.

## Convención de signos

Los pasivos van **negativos** cuando se debe plata (igual que Beancount). El
patrimonio es la suma llana de los saldos `asset` + `liability`, sin invertir
el signo de nada.

## Estado del seed (al 1-oct-2026)

- La tarjeta abre con −200.000 (el resumen real de §5, que la tabla de saldos
  de apertura de la spec no lista).
- El plan de octubre está aprobado, pero solo las 7 líneas de sobre del **nivel
  piso** generaron allocation. Las 3 del nivel variable quedan como propuesta:
  los 4.780.000 de consultoría y los 1.200.000 del hito están en
  `expected_inflows` con status `expected`. El planner las materializa cuando
  el cobro pasa a `received`.
- `pool_sin_asignar` = 215.000 ARS (200.000 del resumen de la tarjeta, que no
  es un sobre, + 15.000 de Mercado Pago) y 0 USD.
- Patrimonio: 8.158.350 ARS.

## Escribir en el libro contable

Toda transacción pasa por `src/db/ledger.ts`. No insertar en `entries` a mano
desde fuera de ahí (el seed es la excepción, porque arma la apertura).

- `createTransaction` valida el balance por moneda en TS antes de escribir, solo
  para dar un error legible en vez de una excepción de plpgsql. La garantía real
  sigue siendo el trigger.
- Montos: `toMinor`/`fromMinor`/`sumAmounts` operan con BigInt sobre 4 decimales
  (igual que `numeric(20,4)`). Es la única forma permitida de sumar plata en JS.
- `rateAt` implementa el fallback al último precio ≤ fecha y acepta `source` +
  `fallbackSource`, porque el tipo de cambio efectivo de la tarjeta (con
  impuestos y spread) no es el dólar oficial.
- Si tocás la capa, corré `npm run db:seed && npm run db:verify`.

## Nota de Postgres

`date_trunc` sobre una columna `date` resuelve a la variante `timestamptz`, que
es STABLE: Postgres la rechaza en una expresión de índice. Hay que castear a
`timestamp` (ver `transactions_recurring_month_idx`).
