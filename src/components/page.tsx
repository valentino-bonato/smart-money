import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * El chasis de todas las pantallas.
 *
 * Una sola regla: **el teléfono no se toca.** Es donde se cargan los gastos y
 * es el criterio de §8. El contenedor es `max-w-xl` y todo apilado; recién en
 * `lg:` se ensancha a `max-w-6xl` y pasa a dos columnas. Vive acá y no copiado
 * en seis `page.tsx` porque la primera vez estaba copiado y las seis se fueron
 * separando de a poco.
 */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-5 py-6 lg:max-w-6xl lg:py-8">
      {children}
    </main>
  );
}

export function PageHeader({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {title}
        </h1>
        {children ? (
          <div className="max-w-prose text-sm text-muted-foreground">
            {children}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/**
 * Dos columnas en escritorio: izquierda lo que se hace, derecha lo que se mira.
 * `flip` las da vuelta — en sobres el formulario va primero para que el pool
 * quede arriba a la izquierda y la lista de sobres ocupe el alto.
 */
export function TwoColumn({
  main,
  aside,
  flip = false,
}: {
  main: ReactNode;
  aside: ReactNode;
  flip?: boolean;
}) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2 lg:gap-8">
      <div className={cn("flex flex-col gap-6", flip && "lg:order-last")}>
        {main}
      </div>
      <div className={cn("flex flex-col gap-6", flip && "lg:order-first")}>
        {aside}
      </div>
    </div>
  );
}
