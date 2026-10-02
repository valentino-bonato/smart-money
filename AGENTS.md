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
- `src/db/seed.ts` — datos reales al 1-oct-2026, con asserts contra la spec.
  **TRUNCA todo**, así que se niega a correr si hay movimientos cargados; hay
  que pedirlo con `npm run db:seed -- --force`.

## Dos bases, no una

- **`DATABASE_URL`** → `smart_money`, los datos reales. Acá corre la app y
  `db:migrate`.
- **`TEST_DATABASE_URL`** → `smart_money_test`. Acá y solo acá corren
  `db:seed`, `db:verify`, `db:plan` y `db:reset` (`loadEnv({ scratch: true })`).

No es una preferencia: el seed trunca todo y los verificadores asumen que la
base tiene exactamente lo que el seed dejó. Contra la base real una de dos cosas
pasa — o le borran los movimientos al usuario, o fallan porque encuentran
movimientos que no esperaban. Las dos ya pasaron.

Para migrar la de pruebas: `npm run db:migrate:test`.
- `BACKLOG.md` — lo pendiente, con el motivo de cada cosa

`income_sources.account_id` vincula cada fuente con su cuenta de ingreso. Es por
id y no por nombre: el planner lee de ahí lo cobrado por nivel, y un match por
nombre devolvería 0 si la fuente se renombra — o sea, "no entró nada", que es el
peor modo de falla posible en la cascada porque no asignar se ve igual que no
tener plata.

## Gastos fijos: no hay cron

Son cuatro: las 3 suscripciones (en USD, contra la tarjeta en dólares) y las
clases de inglés (240.000 ARS, desde la caja de ahorro).

`prepareRecurringCharges()` en `recurring.ts` **no** se dispara por fecha. Los
cargos aparecen cuando cierra el resumen y el resumen se paga el 1 junto con el
sueldo; el día en que cobra cada suscripción no se sigue y no cambia nada. Así
que la operación es "preparar el resumen de este mes": deja los tres cargos con
su precio de lista para corregirlos después contra el resumen real.

`day_of_month = 1` en las tres significa eso — el día en que se paga el
resumen —, no el día de cada cobro.

Es idempotente por el índice único parcial `transactions_recurring_month_idx`:
un asiento por (gasto recurrente, mes). No consultar antes de escribir; se
intenta el insert y se trata la violación de unique (23505) como "ya estaba".

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

## Los CEDEARs están en USD

`Cocos Capital — CEDEARs` es una cuenta en **dólares**, aunque los CEDEARs se
compren y se coticen en pesos. §8 lo deja como decisión explícita del usuario
("sigue al dólar, pero es renta variable"), y la tomó así.

El motivo es el catch-up del auto: valuados en pesos a valor libro, una suba del
dólar mostraría la meta **yendo para atrás**, cuando en realidad los CEDEARs
subieron en pesos junto con él. En dólares el progreso queda estable.

Dos consecuencias que no hay que olvidar:

- **Transferir pesos ahí lo rechaza el trigger.** Mandar plata a CEDEARs es
  comprar dólares: va por `/mover` con las dos monedas. El plan lo marca con
  `needsExchange`.
- **Conciliar contra Cocos sale directo**: Cocos tiene su propio toggle
  ARS/US$ y muestra la cartera en dólares. (Esto corrige una suposición previa
  de que mostraba solo pesos.)
- Sigue siendo **valor libro**: no se revalúa ni por el dólar ni por el S&P. Al
  2-oct la brecha real era de 31,88 USD contra lo que valuaba Cocos. La
  revaluación está fuera del v1 (`BACKLOG.md`).

## Sobres

Son 11, no los 9 de la spec. Se agregaron dos gastos fijos que §4 no tiene:

- **Suscripciones**: la cascada trata la tarjeta solo como un pago y dejaba
  ~176.000 ARS por mes sin propósito asignado.
- **Inglés**: 240.000 ARS por mes que la spec no registra en ningún lado.

Los dos acumulan en vez de resetear: si el precio sube y el aporte no, el sobre
queda en negativo y se ve, en vez de resetear y esconder la deriva.

El aporte tiene moneda propia (`contribution_currency`), columna que la spec no
tiene. Hace falta porque el de Suscripciones son 113,82 **USD** aunque el sobre
se consuma en ARS: no se puede inferir de `target_currency`, que solo existe en
las metas.

## El motor del planner

`src/db/planner.ts`. Es el punto de toda la app: el dolor no es registrar
gastos, es decidir cada mes a dónde va la plata.

**El orden de la cascada no está en una tabla.** El rol de cada sobre se deduce
de sus propias columnas, lo que evita una configuración paralela que se
desincronice:

| columna | rol en la cascada |
| --- | --- |
| `contribution_rule = 'fixed'` | obligación del piso, en orden de `display_order` |
| `deadline_hard = true` | meta del piso (el viaje) |
| `target_amount` sin `target_date` | absorbe el sobrante del piso y se completa primero en el nivel 2 (el fondo de emergencia) |
| `target_date` con `deadline_hard = false` | meta del nivel 2 (el auto) |
| `contribution_rule = 'remainder'` | se lleva el resto (CEDEARs) |
| `contribution_rule = null` | no entra; se carga como puntual del mes |

Invariantes del motor, cada uno con su assert en `npm run db:plan`:

- **Recalcular un período excluye el plan de ese período.** Si no, su propio
  aporte cuenta como progreso de la meta y el catch-up sale más bajo: el mes se
  cuenta pendiente y pagado a la vez.
- **Un nivel ya aplicado no se recalcula: se emite tal cual.** §4 pide
  replanificación incremental, "el planner agrega líneas del nivel 2 sin tocar
  las del piso". Sin esto, abrir el plan a mitad de mes vuelve a proponer las
  transferencias que ya se hicieron, y la primera vez que se abre con datos
  reales se pierde la confianza. Un nivel está aplicado si alguna de sus líneas
  tiene su asignación creada, por `allocations.plan_line_id` — **no** por sobre:
  el viaje tiene una línea en el piso y otra en el variable, así que matchear
  por sobre daría uno de los dos mal.
- **El pago del resumen se calcula siempre del saldo actual**, aplicado o no.
  Aprobar un plan no paga nada, así que la línea sigue hasta que la deuda se
  cancele de verdad — y desaparece sola cuando se paga.
- **El faltante de una meta con fecha dura se calcula igual con el piso
  aplicado**, comparando el catch-up contra lo que las líneas guardadas ya le
  dieron. Es lo que el nivel variable tiene que completar.
- **Del resumen de tarjeta solo entra la parte que ningún sobre cubre.** Los
  220,82 USD de octubre ya salieron de sus sobres al consumirse (el hostel del Viaje,
  las suscripciones de Suscripciones); pedirle al piso otros 221 reservaría la
  misma plata dos veces. Los 200.000 en pesos vienen del saldo de apertura y no
  tienen sobre detrás: esos sí.
- **Los niveles variables solo cuentan lo cobrado, nunca un esperado.** El piso
  es la única excepción: el sueldo es fijo y cae el día 1, así que si todavía no
  hay asiento se usa `expected_amount` — y `availableSource` lo dice. Aprobar
  materializa allocations solo de los niveles cuyo cobro entró.
- **La suma de las transferencias es igual al total de lo PENDIENTE.** Todo peso
  asignado tiene un destino (`envelopes.settlement_account_id`), incluso cuando
  el destino es la cuenta donde ya está.

`npm run db:plan` corre el motor sobre octubre con los montos de §5 y lo compara
con el plan que el seed armó a mano desde la spec. La tolerancia por línea es de
500 pesos porque §5 redondeó los montos en dólares (824 USD a 1.550 son
1.277.200 y la spec escribió 1.277.000); los totales por nivel sí tienen que dar
exactos.

## Pantalla de sobres

`src/app/sobres/` — saldo por sobre y moneda, progreso de metas, pool sin
asignar, y mover plata de propósito.

- Las operaciones del libro de sobres están en `src/db/envelopes.ts` y **no**
  pasan por `ledger.ts`: `allocations` es un libro separado y una asignación no
  tiene contrapartida, así que el invariante de partida doble no aplica.
  Asignar del pool es una fila; devolver, una negativa; mover entre sobres, dos;
  pasar de moneda, dos en el mismo sobre.
- `convertEnvelopeAllocation` existe porque comprar dólares mueve las cuentas
  pero no las asignaciones. Si no se convierte también la asignación, el sobre
  dice tener pesos que ya no existen.
- El aporte sugerido de las metas se calcula desde `nextPlanningPeriod` (el
  primer mes sin plan aprobado), **no** desde el mes actual. Contar el mes en
  curso como pendiente mientras su asignación ya suma al progreso da un aporte
  más bajo del real.
- Un archivo `"use server"` solo puede exportar funciones async. La constante
  `POOL` vive en `pool.ts` por eso.

## Mover plata

`src/app/mover/` — pasar plata a Mercado Pago, pagar el resumen y comprar
dólares. Son los tres casos de §8 que **no son gastos** y que rompen una app de
lista de movimientos. Por dentro son el mismo mecanismo; la diferencia la hace
la moneda: igual → `recordTransfer`, distinta → `exchangeCurrency`, que mete
sola las partidas de FX.

Comprar dólares para un sobre además convierte su asignación
(`convertEnvelopeAllocation`) en la misma transacción. Sin eso el sobre queda
diciendo que tiene pesos que ya no existen. El progreso de la meta no cambia más
allá del redondeo del cambio: pasar de moneda no es ahorrar más.

**Las cuentas de FX se resuelven ANTES de abrir la transacción.** Leer con la
conexión de afuera mientras la transacción la tiene tomada cuelga el proceso si
el pool está en una sola conexión — y en cualquier caso lee de afuera. Es el
mismo cuidado que vale para cualquier lectura dentro de un `db.transaction`.

## Conciliación

`src/db/reconcile.ts` + `src/app/conciliacion/`. Es el chequeo de §8 que decide
si se puede confiar en el resto: si los saldos no cierran al peso con el
homebanking, el planner está comiendo de un historial incompleto.

Lo que la hace útil no es la resta — eso es trivial — sino `missingEntries()`:
qué es lo más probable que falte. No intenta adivinar gastos sueltos; apunta a
lo que la app **ya sabe** que tiene que pasar y todavía no vio:

- gastos fijos del mes sin cargo generado (vía `transactions.recurring_expense_id`);
- cobros esperados cuya `expected_date` ya pasó.

Una diferencia se cierra de dos maneras, y la pantalla ofrece las dos:

- **Ajustar** (`adjustAccountBalance`) deja la cuenta en el saldo del
  homebanking con un asiento contra `Equity:Ajustes:<moneda>`. Es para lo que
  NO se arregla cargando un movimiento: la revalorización de los CEDEARs, una
  comisión del fondo, un saldo de apertura que entró mal.
- **Ignorar** solo la saca de la lista, sin tocar saldos. Es para cuando ya se
  sabe qué falta y se va a cargar.

La contrapartida del ajuste va a **equity** y no a una cuenta de ingreso o
gasto, a propósito: una diferencia que no se sabe de qué es no tiene que
ensuciar los promedios por categoría, que son input del planner.

`difference = statement − computed`. Positiva = el banco tiene más, así que
falta cargar un ingreso o hay un gasto cargado que no existió. La resta se hace
en la base con `numeric`. Las cuentas que se dejan en blanco **no** se
concilian: guardar un cero por una cuenta que no se miró sería mentira.

El cero sí es un saldo válido acá, a diferencia de en la carga — `parseAmountInput`
lo rechaza a propósito (un gasto de 0 no existe), así que la acción lo acepta
explícito antes de parsear.

## Layout

Una sola regla: **el teléfono no se toca.** Es donde se cargan los gastos y es
el criterio de §8. El contenedor sigue siendo `max-w-xl` y todo apilado; recién
en `lg:` se ensancha a `max-w-6xl` y pasa a dos columnas.

En cada pantalla la columna izquierda es lo que se hace y la derecha lo que se
mira — salvo en sobres, donde el formulario va con `lg:order-first` para que el
pool quede arriba a la izquierda y la lista de sobres ocupe el alto.

El nav vive en `src/app/nav.tsx` y lo monta el layout. Antes cada pantalla
repetía sus links, así que agregar una obligaba a tocar las cinco.

## Pantalla de carga

`src/app/page.tsx` (server component) + `quick-entry.tsx` (client) +
`actions.ts` (server action). Es la pantalla más importante del v1: §8 dice que
si cargar un gasto pasa de ~10 segundos, la app se abandona en tres semanas.

Decisiones que no conviene deshacer sin motivo:

- **La moneda no se pide.** La define la cuenta de gasto elegida, y las cuentas
  de origen se filtran a esa misma moneda. Sin eso el trigger rechaza la carga
  recién al enviar.
- **Nada de `setState` en un efecto** (`react-hooks/set-state-in-effect` lo
  rechaza). Después de cargar, los campos se remontan con `key={state.token}`;
  la cuenta de origen efectiva es un valor derivado, no estado espejado.
- **La sugerencia por comercio arranca vacía y aprende del uso**
  (`payeeSuggestions`). No hay lista precargada de comercios.
- El saldo del sobre se muestra junto al selector, porque el momento en que
  importa es justo antes de gastar.
- **Un asiento no tiene "un monto".** Tiene partidas, y pueden ser muchas y en
  varias monedas: el saldo de apertura son siete. `recentTransactions` devuelve
  los totales **por moneda** de lo que entró, salteando las cuentas de sistema,
  y clasifica el movimiento (gasto, ingreso, transferencia, pago, cambio,
  apertura). Mostrar una partida suelta —la más grande, pongamos— da un número
  que no significa nada.

En Next 16: `refresh()` de `next/cache` para refrescar después de mutar (no
`revalidatePath`), y el layout recibe `LayoutProps<"/">` tipado.

## Corregir lo cargado

Hoy solo se puede **borrar** un movimiento, desde la lista de últimos
movimientos (`delete-button.tsx` + `deleteTransactionAction`). El resto de la
historia — editar monto, cambiar categoría o sobre — está en `BACKLOG.md`.

- Las partidas se van por cascada y el constraint trigger deferido valida al
  COMMIT con el asiento ya vacío: no hay estado intermedio desbalanceado. Vale
  igual para un cambio de moneda, que son cuatro partidas en dos monedas.
- **El saldo de apertura no se borra.** Es el punto de partida del libro, y
  borrarlo deja cada cuenta en cero sin que se note hasta que algo no cuadra.
  La acción lo rechaza y la lista ni ofrece el botón.
- Borrar pide un segundo clic, con el mismo botón cambiando. Un `confirm()` en
  una lista que se recorre rápido se acepta sin leer.

## Parseo de montos

`parseAmountInput` en `src/lib/money.ts`. La coma es el separador decimal; un
punto con 1 o 2 dígitos detrás también. **Un monto ambiguo falla, no se
adivina**: "1.0000001" se rechaza en vez de volverse 10.000.001, y los grupos
de miles se validan (el primero de 1 a 3 dígitos, el resto de exactamente 3).
Los casos están en `db:verify`.

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

- Las allocations de apertura se fechan al **30-sep**, no al 1-oct: los saldos
  de cuenta son al 1-oct, pero el propósito ya estaba asignado antes de que
  empezara el mes. Si van al 1-oct, los 703 USD del viaje aparecen como
  "asignado este mes" y cualquier cuenta por período los cuenta dos veces.
- La tarjeta abre con −200.000 ARS (el resumen de §5, que la tabla de saldos de
  apertura de la spec no lista) y −220,82 USD (hostel 77 + Claude 100 + Notion
  42 + YouTube 1,82, cargados como transacciones con su sobre).
- El plan de octubre está aprobado, pero solo las líneas del **nivel piso**
  generaron allocation. Las del nivel variable quedan como propuesta: los
  4.780.000 de consultoría y los 1.200.000 del hito están en
  `expected_inflows` con status `expected`. El planner las materializa cuando
  el cobro pasa a `received`.
- **El piso ya no cubre el aporte al viaje.** Con las clases de inglés adentro,
  los gastos fijos se comen 1.646.421 de los 2.691.000 del sueldo, así que el
  viaje recibe 1.044.579 del piso y los 232.421 que faltan salen del nivel
  variable. No sobra nada para el fondo de emergencia. En un mes flojo de
  consultoría, la meta con fecha dura queda corta.
- `pool_sin_asignar` = 215.000 ARS y 220,82 USD. Los dos son resúmenes a pagar que
  ningún sobre reclama: la fórmula de §6 no mira los pasivos.
- Patrimonio: 7.816.083 ARS.

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
