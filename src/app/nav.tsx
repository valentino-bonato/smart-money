"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Navegación compartida. Antes cada pantalla repetía sus propios links, así que
 * agregar una obligaba a tocar las cinco y era fácil olvidarse de alguna.
 */
const LINKS = [
  { href: "/", label: "Cargar" },
  { href: "/mover", label: "Mover" },
  { href: "/sobres", label: "Sobres" },
  { href: "/plan", label: "Plan" },
  { href: "/conciliacion", label: "Conciliar" },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-10 border-b border-black/10 dark:border-white/10 bg-background/85 backdrop-blur">
      <div className="mx-auto w-full max-w-6xl px-5 h-14 flex items-center gap-5">
        <span className="text-sm font-semibold shrink-0">smart money</span>
        {/* En el teléfono la barra se desplaza sola si no entran los cinco. */}
        <nav className="flex gap-4 overflow-x-auto text-sm">
          {LINKS.map((l) => {
            const active =
              l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap py-1 border-b-2 -mb-[1px] ${
                  active
                    ? "border-foreground opacity-100"
                    : "border-transparent opacity-55 hover:opacity-90"
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
