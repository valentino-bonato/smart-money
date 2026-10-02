"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Navegación compartida. Antes cada pantalla repetía sus propios links, así que
 * agregar una obligaba a tocar las cinco.
 *
 * Nada de alto fijo ni de bordes que se salgan de la caja: la primera versión
 * usaba `h-14` con `overflow-x-auto` y un `border-b` con margen negativo, y en
 * macOS la barra de scroll se comía los links y les cortaba el borde. Ahora la
 * barra crece con su contenido, los links envuelven si no entran, y el activo
 * se marca con un fondo en vez de un borde que sobresale.
 */
const LINKS = [
  { href: "/", label: "Cargar" },
  { href: "/mover", label: "Mover" },
  { href: "/sobres", label: "Sobres" },
  { href: "/plan", label: "Plan" },
  { href: "/presupuesto", label: "Presupuesto" },
  { href: "/conciliacion", label: "Conciliar" },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 border-b border-black/10 dark:border-white/10 bg-background/90 backdrop-blur">
      <div className="mx-auto w-full max-w-6xl px-5 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-sm font-semibold shrink-0 mr-1">smart money</span>
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          {LINKS.map((l) => {
            const active =
              l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-2 py-1 whitespace-nowrap transition-opacity ${
                  active
                    ? "bg-black/[0.07] dark:bg-white/[0.12] font-medium"
                    : "opacity-60 hover:opacity-100"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
