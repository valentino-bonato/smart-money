"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { db } from "@/db";
import { convertEnvelopeAllocation } from "@/db/envelopes";
import { exchangeCurrency, fxAccountFor, recordTransfer } from "@/db/ledger";
import * as schema from "@/db/schema";
import { MoneyParseError, parseAmountInput } from "@/lib/money";
import { getCurrentUser } from "@/lib/user";

export type MoveMoneyState =
  | { status: "idle" }
  | { status: "ok"; message: string; token: string }
  | { status: "error"; message: string };

/**
 * Mover plata entre cuentas propias. Cubre los tres casos de §8 que NO son
 * gastos y que rompen cualquier app de lista de movimientos:
 *
 *   · pasar plata a Mercado Pago para gastar después
 *   · pagar el resumen de la tarjeta
 *   · comprar dólares
 *
 * Los tres salen del mismo mecanismo. La diferencia la hace la moneda: si las
 * dos cuentas son de la misma, es una transferencia; si no, es un cambio y la
 * app mete sola las partidas de FX, porque el invariante es por moneda y un
 * asiento no puede tener pesos de un lado y dólares del otro.
 *
 * Ninguno toca un sobre: el propósito de la plata no cambia porque cambie de
 * cuenta. La excepción es comprar dólares para un sobre concreto, que además
 * convierte su asignación — si no, el sobre dice tener pesos que ya no están.
 */
export async function moveMoneyAction(
  _prev: MoveMoneyState,
  form: FormData,
): Promise<MoveMoneyState> {
  try {
    const user = await getCurrentUser();

    const fromId = String(form.get("fromAccountId") ?? "");
    const toId = String(form.get("toAccountId") ?? "");
    const date = String(form.get("date") ?? "");
    const descriptionRaw = form.get("description");
    const description =
      typeof descriptionRaw === "string" && descriptionRaw.trim()
        ? descriptionRaw.trim()
        : null;

    if (!fromId || !toId) {
      return { status: "error", message: "Falta la cuenta de origen o destino" };
    }
    if (fromId === toId) {
      return { status: "error", message: "Las dos cuentas son la misma" };
    }

    const accounts = await db
      .select()
      .from(schema.accounts)
      .where(eq(schema.accounts.userId, user.id));
    const from = accounts.find((a) => a.id === fromId);
    const to = accounts.find((a) => a.id === toId);
    if (!from || !to) {
      return { status: "error", message: "Cuenta inexistente" };
    }

    const amount = parseAmountInput(String(form.get("amount") ?? ""));

    if (from.currency === to.currency) {
      await recordTransfer(db, {
        userId: user.id,
        date,
        amount,
        currency: from.currency,
        fromAccountId: from.id,
        toAccountId: to.id,
        description:
          description ??
          (to.type === "liability"
            ? `Pago del resumen · ${to.name}`
            : `${from.name} → ${to.name}`),
      });
      refresh();
      return {
        status: "ok",
        message:
          to.type === "liability"
            ? "Resumen pagado. No es un gasto: los consumos ya salieron de su sobre."
            : "Transferido. Ningún sobre cambió: la plata cambió de cuenta, no de propósito.",
        token: crypto.randomUUID(),
      };
    }

    // Monedas distintas: es un cambio.
    const received = parseAmountInput(String(form.get("receivedAmount") ?? ""));
    const envelopeId = String(form.get("envelopeId") ?? "");

    // Las cuentas de FX se resuelven ANTES de abrir la transacción: leer con la
    // conexión de afuera mientras la transacción la tiene tomada se cuelga si
    // el pool está en una sola conexión, y en cualquier caso lee de afuera.
    const fromFxAccountId = await fxAccountFor(db, {
      userId: user.id,
      currency: from.currency,
    });
    const toFxAccountId = await fxAccountFor(db, {
      userId: user.id,
      currency: to.currency,
    });

    await db.transaction(async (tx) => {
      await exchangeCurrency(tx, {
        userId: user.id,
        date,
        fromAccountId: from.id,
        fromAmount: amount,
        fromCurrency: from.currency,
        fromFxAccountId,
        toAccountId: to.id,
        toAmount: received,
        toCurrency: to.currency,
        toFxAccountId,
        description: description ?? `Cambio ${from.currency} → ${to.currency}`,
      });

      // Comprar dólares mueve las cuentas pero no las asignaciones. Si esta
      // plata era de un sobre, su asignación tiene que convertirse también.
      if (envelopeId) {
        await convertEnvelopeAllocation(tx, {
          envelopeId,
          fromAmount: amount,
          fromCurrency: from.currency,
          toAmount: received,
          toCurrency: to.currency,
          date,
          note: description ?? "Cambio de moneda",
        });
      }
    });

    refresh();
    return {
      status: "ok",
      message: envelopeId
        ? "Cambio registrado, y la asignación del sobre pasó a la nueva moneda."
        : "Cambio registrado. No es un gasto.",
      token: crypto.randomUUID(),
    };
  } catch (err) {
    if (err instanceof MoneyParseError) {
      return { status: "error", message: err.message };
    }
    const e = err as Error & { cause?: Error };
    return {
      status: "error",
      message: (e.cause?.message ?? e.message).split("\n")[0],
    };
  }
}
