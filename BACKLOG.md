# Backlog

Lo que quedó pendiente, con el motivo. No es una lista de deseos: cada ítem
salió de una decisión concreta que se tomó o se postergó.

## Pedido

- **Usarlo en la web desde la PC.** Hoy la app ya corre en cualquier navegador,
  pero las tres pantallas están armadas en una columna angosta (`max-w-xl`),
  pensada para el teléfono — que es donde se cargan los gastos. Faltan dos
  cosas distintas y conviene no confundirlas:
  1. **Layout de escritorio**: aprovechar el ancho. Los sobres y el plan en
     particular ganan mucho con dos columnas.
  2. **Deploy**: que sea accesible sin `npm run dev`. El stack ya está elegido
     para Vercel; hace falta una Postgres administrada y las variables de
     entorno.

## Corregir lo cargado

**Reportado el 2-oct-2026:** una transferencia hecha sin querer a la cuenta
equivocada, sin forma de volver atrás.

Se construyó lo mínimo — **borrar un movimiento** desde la lista de últimos
movimientos — porque sin eso un monto mal tipeado durante la carga queda para
siempre, y §8 dice que el historial a medias es peor que no tener app. Falta
todo lo demás:

- **Editar un movimiento**: cambiarle el monto, la fecha o el comercio sin
  borrarlo y volver a cargarlo. El caso frecuente es el de §8: la suscripción
  se carga con el precio de lista y se corrige con el monto real del resumen.
- **Cambiar la categoría o el sobre** de un gasto ya cargado. Hoy implica
  borrarlo y rehacerlo, que además pierde la sugerencia por comercio.
- **Editar una transferencia o un cambio de moneda.** El cambio es el más
  delicado: tiene cuatro partidas y, si fue para un sobre, además una
  conversión de asignación que hay que deshacer junto.
- **Deshacer un movimiento de sobres** (una asignación mal hecha). Hoy se
  arregla moviendo en sentido contrario, lo que deja las dos filas en el
  historial.
- **Confirmación proporcional.** Borrar el saldo de apertura rompe todo, así
  que hoy directamente no se ofrece. Editar en vez de borrar lo vuelve menos
  grave.

Lo que ya existe: deshacer la aprobación de un plan, desde `/plan`.

## Ver la cartera en pesos o en dólares

**Pedido el 2-oct-2026**, con la pantalla de Cocos al lado: un toggle
"expresado en ARS / US$" sobre el patrimonio, al **dólar MEP** — no al oficial,
que es el que usa el planner para las reglas.

Lo que hace falta:

- Una segunda fuente de precio. `prices` ya tiene la columna `source` y
  `rateAt()` ya acepta `source` + `fallbackSource`, así que el modelo aguanta
  sin tocar nada: es cargar filas con `source = 'mep'`. Lo que falta decidir es
  de dónde sale ese número — a mano, o de alguna API.
- Mantener separados los dos usos del precio. El oficial decide **cuánta plata
  asigna el planner**; el MEP sería solo para **mirar**. Mezclarlos movería los
  aportes de las metas sin que nadie lo haya pedido.
- Dónde vive el toggle. `netWorth()` en `queries.ts` ya recibe el precio por
  parámetro, así que la cuenta está hecha; falta la pantalla.

**Tensión con §1**, que dice "sin KPIs ni dashboards en el v1". Un toggle de
moneda sobre un número que ya se muestra es una opción de vista, no un tablero.
Pero "patrimonio total" sí es un KPI, y hoy no aparece en ninguna pantalla —
solo en la salida del seed. Decidir si entra es parte del ítem.

## Del v1, sin construir

- **Paso 7 · chat sobre el plan.** La capa conversacional con la Claude API,
  dentro de la pantalla del plan. Es lo único que necesita una API key.
- **Prueba de fricción de §8.** Cronometrar la carga de 10 gastos reales. Si el
  promedio pasa de 15 segundos, la UX de carga necesita otra vuelta *antes* de
  confiar en el planner, porque el planner come de ese historial. Esto lo tiene
  que hacer Valentino, no el código.

## Decisiones postergadas

- **El piso planifica sobre el sueldo, no sobre el saldo de la cuenta.** §4
  define el piso como el sueldo, así que el motor usa `expected_amount` cuando
  todavía no hay asiento, y `availableSource` lo dice en pantalla. Si se
  planifica a mitad de mes después de gastar, asigna más de lo que hay. Acotarlo
  al pool disponible es una línea, pero cambia la semántica de §4.
- **El resumen en pesos de apertura no tiene desglose.** Los 200.000 están como
  saldo de apertura sin detalle, porque no se sabe de qué son. Si aparece el
  detalle, se abre igual que el resumen en dólares.
- **La tarjeta en USD abre en 0.** No se sabe si al 1-oct había saldo en
  dólares pendiente de resúmenes anteriores.
- **Fecha del auto.** Confirmada en sep-2027. La palanca sigue disponible: a
  sep-2028 el aporte baja de 1.337.650 a ~640.000 por mes. Hoy, con la
  consultoría promedio, el compromiso del nivel variable (1.570.271) excede el
  ingreso promedio del nivel (1.500.000) por ~70.000.

## Fuera del v1 por decisión de §7

Están preparados en el modelo y no construidos:

- **Lotes de inversión a costo** para CEDEARs: se agrega con `cost_amount` y
  `cost_currency` en `entries`, sin tocar nada existente.
- **Importación de CSV o resumen de tarjeta**, OCR de tickets.
- **Reportes, gráficos, KPIs.**
- **Cuotas con devengamiento.** Hoy: gasto completo al consumo, pasivo en la
  tarjeta.
- **Multiusuario** con auth real y RLS. `user_id` está en todas las tablas raíz
  desde el día 1, así que no requiere migración de datos — solo reemplazar el
  cuerpo de `getCurrentUser()`.
- **Revaluación** de la cartera a valor de mercado. Hoy el saldo es valor
  libro: no se mueve ni con el dólar ni con el S&P. **Ya hay una brecha real
  medida**: al 2-oct Cocos valuaba los CEDEARs en US$ 2.183,56 y la app dice
  US$ 2.151,68 — 31,88 dólares de diferencia, que es apreciación de mercado más
  MEP contra oficial. Las cuentas `Equity:FX:*` ya acumulan la parte cambiaria.

## Plan B declarado en §8

Si en dos meses la carga en la app no sucede, el plan B es **Beancount + Fava**.
No es un descarte cerrado: da hoy todo el núcleo contable verificado, y lo que
lo hacía perder era la carga en archivo de texto. Si la fricción gana igual, el
plan B vuelve a la mesa.
