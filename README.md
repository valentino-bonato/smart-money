# smart-money

App de finanzas personales de un solo usuario, en ARS y USD. El valor principal
no es registrar gastos: es el **planner** — dado lo que entró, decir cuánto va a
cada destino y qué transferencias hacer.

Spec de diseño del v1 (fuente de verdad):
[Smart Money — diseño y spec del v1](https://app.notion.com/p/3ec6a57ed8b281a1bc5dd65216dda7b0)

Stack: Next.js (App Router) + Postgres + Drizzle.

## Puesta en marcha

```bash
npm install
createdb smart_money
cp .env.example .env.local   # ajustar DATABASE_URL
npm run db:migrate           # esquema + triggers del invariante
npm run db:seed              # datos reales al 1-oct-2026
npm run dev
```

| Script | Qué hace |
| --- | --- |
| `npm run db:generate` | genera una migración desde `src/db/schema.ts` |
| `npm run db:migrate` | aplica las migraciones pendientes |
| `npm run db:seed` | borra y recarga los datos reales al 1-oct-2026, y verifica los números contra la spec |
| `npm run db:verify` | prueba los 3 casos raros de §8 contra el invariante real |
| `npm run db:reset` | borra el esquema completo (destructivo, solo local) |
| `npm run db:studio` | Drizzle Studio |

## El modelo, en tres frases

- **¿Dónde está la plata?** → la cuenta. **¿Para qué es la plata?** → el sobre.
  Son dos dimensiones separadas.
- **Partida doble por moneda.** `SUM(entries.amount) = 0` por cada
  (transacción, moneda), siempre. Transferencias, pago del resumen de la
  tarjeta y compra de dólares salen del mismo mecanismo; ninguno es un gasto.
- **`allocations` es un libro separado del contable.** Asignar 1.277.000 al
  viaje no mueve plata de ninguna cuenta: es una fila ahí.

Las conversiones ARS↔USD pasan por cuentas de FX (`Equity:FX:*`), no por precio
inline, para que el invariante no tenga excepciones y pueda vivir como
constraint en la base (`entries_balanced`, `DEFERRABLE INITIALLY DEFERRED`).

## Los tres casos raros

Transferencia, pago del resumen de la tarjeta y compra de dólares salen todos de
`src/db/ledger.ts` y **ninguno es un gasto**. `npm run db:verify` lo prueba
contra la base: commitea cada caso de verdad (si hiciera rollback el constraint
trigger deferido no llegaría a correr y la prueba no probaría nada), verifica
los saldos y el total de gasto del mes, y después limpia.

La compra de dólares pasa por las cuentas de FX: la pata ARS cierra contra
`Equity:FX:ARS` y la pata USD contra `Equity:FX:USD`. Cruzar monedas en un mismo
asiento sin esas patas tira un error explícito antes de tocar la base.

## Reglas no negociables del código

1. **La plata es `string`, nunca `number`.** `numeric` mapea a `string` en
   Drizzle y así se queda. No usar `numeric({ mode: "number" })` ni `Number(...)`
   sobre un monto para hacer aritmética. Las sumas se hacen en SQL.
2. **Nunca guardar un saldo convertido.** Cada cuenta tiene su moneda; el sobre
   tiene saldo *por* moneda. La conversión existe solo al registrar la
   operación de cambio y en la vista.
3. **Una cuenta = una moneda.**
4. **El tercer callback de `pgTable` devuelve un array**, no un objeto (la forma
   objeto está `@deprecated` en `drizzle-orm@0.45.x`).
