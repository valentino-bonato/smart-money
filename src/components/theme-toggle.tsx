"use client";

import { useCallback, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { readTheme, writeTheme, THEME_EVENT, type Theme } from "@/lib/theme";

/**
 * Tres opciones y no un switch de dos: "seguir al sistema" es el default y la
 * que más se usa — el teléfono ya cambia solo de noche. Las otras dos son para
 * cuando el sistema se equivoca.
 *
 * La preferencia se lee con `useSyncExternalStore` y no con un efecto: el
 * proyecto rechaza `setState` adentro de un efecto
 * (`react-hooks/set-state-in-effect`), y además esto es exactamente lo que
 * `useSyncExternalStore` resuelve — un dato que vive fuera de React.
 *
 * El ícono no se renderiza según el tema elegido: en el render del servidor
 * todavía no se sabe cuál es, así que parpadearía. Se muestran el sol y la luna
 * y los esconde CSS, que ya corre con la clase puesta por el script del layout.
 */
function subscribe(onChange: () => void) {
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function ThemeToggle() {
  const theme = useSyncExternalStore<Theme>(
    subscribe,
    readTheme,
    // En el servidor no hay preferencia que leer. Da igual para el pintado: la
    // clase ya la puso el script, esto solo marca cuál opción está tildada.
    () => "system",
  );

  const onSelect = useCallback((value: string) => {
    writeTheme(value as Theme);
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Cambiar el tema">
          <Sun className="dark:hidden" />
          <Moon className="hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme} onValueChange={onSelect}>
          <DropdownMenuRadioItem value="light">
            <Sun /> Claro
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon /> Oscuro
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor /> El del sistema
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
