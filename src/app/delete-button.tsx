"use client";

import { useState } from "react";
import { XIcon } from "lucide-react";
import { deleteTransactionAction } from "./actions";
import { Button } from "@/components/ui/button";

/**
 * Borrar pide un segundo clic. No es un diálogo: es el mismo botón que cambia.
 * Un `confirm()` en una lista que se recorre rápido se acepta sin leer, y un
 * borrado de un solo clic al lado de cada renglón se dispara solo.
 */
export function DeleteButton({ id }: { id: string }) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => setArmed(true)}
        aria-label="Borrar movimiento"
        className="shrink-0 text-muted-foreground opacity-50 hover:opacity-100"
      >
        <XIcon />
      </Button>
    );
  }

  return (
    <span className="flex shrink-0 items-center gap-1">
      <form action={deleteTransactionAction}>
        <input type="hidden" name="id" value={id} />
        <Button type="submit" variant="destructive" size="xs">
          Borrar
        </Button>
      </form>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => setArmed(false)}
      >
        No
      </Button>
    </span>
  );
}
