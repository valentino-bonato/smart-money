"use client";

import { useState } from "react";
import { deleteTransactionAction } from "./actions";

/**
 * Borrar pide un segundo clic. No es un diálogo: es el mismo botón que cambia.
 * Un `confirm()` en una lista que se recorre rápido se acepta sin leer, y un
 * borrado de un solo clic al lado de cada renglón se dispara solo.
 */
export function DeleteButton({ id }: { id: string }) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        aria-label="Borrar movimiento"
        className="text-xs opacity-30 hover:opacity-80 px-1"
      >
        ✕
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2 text-xs">
      <form action={deleteTransactionAction}>
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          className="text-red-600 dark:text-red-400 underline"
        >
          borrar
        </button>
      </form>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="opacity-50 underline"
      >
        no
      </button>
    </span>
  );
}
