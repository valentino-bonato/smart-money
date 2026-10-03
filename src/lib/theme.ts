/**
 * El tema: claro, oscuro o el del sistema.
 *
 * Son treinta líneas propias en vez de `next-themes` porque su provider es un
 * componente de cliente que renderiza un `<script>`, y React 19 lo rechaza
 * ("Encountered a script tag while rendering React component"): el overlay de
 * error de dev terminaba tapando la pantalla entera.
 */
export const THEME_KEY = "smart-money-theme";

export type Theme = "light" | "dark" | "system";

/** Evento propio: `storage` solo se dispara en OTRAS pestañas, no en esta. */
export const THEME_EVENT = "smart-money-theme-change";

/**
 * Corre antes del primer pintado, desde el layout. Sin esto la app arranca en
 * claro y pega un flash a oscuro en cada carga.
 *
 * Va envuelto en try/catch porque en Safari con el almacenamiento bloqueado
 * `localStorage` tira, y si eso explota no se pinta nada.
 */
export const THEME_SCRIPT = `(function(){var K=${JSON.stringify(THEME_KEY)};var m=window.matchMedia("(prefers-color-scheme: dark)");function a(){var t="system";try{t=localStorage.getItem(K)||"system";}catch(e){}document.documentElement.classList.toggle("dark",t==="dark"||(t==="system"&&m.matches));}a();m.addEventListener("change",a);})();`;

export function applyTheme(theme: Theme): void {
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // Almacenamiento bloqueado: se sigue con el del sistema.
  }
  return "system";
}

export function writeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Igual se aplica en esta sesión aunque no se pueda recordar.
  }
  applyTheme(theme);
  window.dispatchEvent(new Event(THEME_EVENT));
}
