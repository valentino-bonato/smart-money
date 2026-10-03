import * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "cn";

/**
 * Un `<select>` nativo con la pinta del Select de shadcn.
 *
 * El del registry es un listbox de Radix, y en el teléfono eso es peor: pierde
 * la rueda nativa de iOS y Android, que es la razón por la que elegir sobre y
 * categoría cuesta dos toques. §8 pone el límite en ~10 segundos por gasto, así
 * que acá gana la plataforma y shadcn pone solo el estilo.
 *
 * Además sigue siendo un control de formulario de verdad: se envía con `name`
 * en un server action sin input oculto ni estado controlado.
 */
function NativeSelect({
  className,
  children,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <div className="relative grid w-full">
      <select
        data-slot="native-select"
        className={cn(
          "col-start-1 row-start-1 h-9 w-full appearance-none rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon
        className="pointer-events-none col-start-1 row-start-1 size-4 self-center justify-self-end mr-2.5 text-muted-foreground"
        aria-hidden
      />
    </div>
  );
}

export { NativeSelect };
