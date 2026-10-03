import { THEME_SCRIPT } from "@/lib/theme";

/**
 * El script que pone la clase del tema ANTES del primer pintado.
 *
 * Tiene que ser bloqueante y renderizado en el servidor: si la clase se
 * aplicara al hidratar, la app arrancaría en claro y pegaría un flash a oscuro
 * en cada carga. Por eso es un `<script>` inline y no un efecto.
 *
 * Desde un Server Component el `<script>` es legal y corre. Desde uno de
 * cliente —que es lo que hace `next-themes`— React 19 lo rechaza.
 */
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
