"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  CheckCheck,
  PlusCircle,
  Scale,
  Wallet,
  Target,
} from "lucide-react";
import { cn } from "cn";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Navegación compartida. Antes cada pantalla repetía sus propios links, así que
 * agregar una obligaba a tocar las cinco.
 *
 * Nada de alto fijo ni de bordes que se salgan de la caja: la primera versión
 * usaba `h-14` con `overflow-x-auto` y un `border-b` con margen negativo, y en
 * macOS la barra de scroll se comía los links y les cortaba el borde. Ahora la
 * barra crece con su contenido, los links envuelven si no entran, y el activo
 * se marca con un fondo en vez de un borde que sobresale.
 *
 * Los íconos solo aparecen en `sm:`: en el teléfono el texto solo entra en dos
 * renglones y agregarles un ícono a cada uno lo manda a tres.
 */
const LINKS = [
  { href: "/", label: "Cargar", icon: PlusCircle },
  { href: "/mover", label: "Mover", icon: ArrowLeftRight },
  { href: "/sobres", label: "Sobres", icon: Wallet },
  { href: "/plan", label: "Plan", icon: Target },
  { href: "/presupuesto", label: "Presupuesto", icon: Scale },
  { href: "/conciliacion", label: "Conciliar", icon: CheckCheck },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
        <span className="mr-1 shrink-0 font-heading text-sm font-semibold tracking-tight">
          smart money
        </span>
        <nav className="flex flex-wrap items-center gap-0.5 text-sm">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1 whitespace-nowrap transition-colors",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className="hidden size-3.5 sm:block" aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
