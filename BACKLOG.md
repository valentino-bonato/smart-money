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
- **Revaluación de la diferencia de cambio** como resultado separado. Las
  cuentas `Equity:FX:*` ya la acumulan.

## Plan B declarado en §8

Si en dos meses la carga en la app no sucede, el plan B es **Beancount + Fava**.
No es un descarte cerrado: da hoy todo el núcleo contable verificado, y lo que
lo hacía perder era la carga en archivo de texto. Si la fricción gana igual, el
plan B vuelve a la mesa.
