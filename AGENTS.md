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
