"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  CheckCheck,
  House,
  PlusCircle,
  Receipt,
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
 * **Dos formas, una sola lista.** Barra arriba en el teléfono, columna a la
 * izquierda en `lg:`. No es una preferencia estética: con ocho pantallas la
 * barra horizontal ya envolvía a dos renglones en un notebook, y cada renglón
 * que crece empuja el contenido hacia abajo en la pantalla donde se carga un
 * gasto. La columna no tiene ese techo — la novena entrada no mueve nada.
 *
 * El teléfono sigue con la barra: un sidebar ahí es un cajón que hay que abrir,
 * y el criterio de §8 son ~10 segundos por gasto. Un toque de más por pantalla
 * los gasta.
 *
 * Nada de alto fijo ni de bordes que se salgan de la caja: la primera versión
 * usaba `h-14` con `overflow-x-auto` y un `border-b` con margen negativo, y en
 * macOS la barra de scroll se comía los links y les cortaba el borde.
 *
 * Los íconos solo aparecen en `sm:` en la barra: en el teléfono el texto solo
 * entra en dos renglones y agregarles un ícono a cada uno lo manda a tres. En
 * la columna van siempre, que es donde sirven de ancla.
 */
const LINKS = [
  // Inicio no es la raíz: la raíz sigue siendo Cargar, que es la pantalla que
  // se abre quince veces por semana. Mudarla costaría un redirect y un cambio
  // de hábito para ganar una URL más corta en la pantalla que se mira de vez
  // en cuando.
  { href: "/inicio", label: "Inicio", icon: House },
  { href: "/", label: "Cargar", icon: PlusCircle },
  // Presupuesto va segunda: después de cargar un gasto, la pregunta que sigue
  // es "¿cuánto me queda de eso?". Estaba quinta, detrás de tres pantallas que
  // se abren mucho menos.
  { href: "/presupuesto", label: "Presupuesto", icon: Scale },
  { href: "/mover", label: "Mover", icon: ArrowLeftRight },
  { href: "/sobres", label: "Sobres", icon: Wallet },
  { href: "/plan", label: "Plan", icon: Target },
  { href: "/conciliacion", label: "Conciliar", icon: CheckCheck },
  // Última: el libro completo se abre para buscar algo puntual o para revisar,
  // no todos los días. Cargar sigue siendo la puerta de entrada.
  { href: "/movimientos", label: "Movimientos", icon: Receipt },
] as const;

function useActive() {
  const pathname = usePathname();
  return (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function Nav() {
  return (
    <>
      <TopBar />
      <Sidebar />
    </>
  );
}

/** Teléfono y tablet: la barra de siempre. */
function TopBar() {
  const isActive = useActive();

  return (
    <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur-md lg:hidden">
      <div className="mx-auto flex w-full max-w-xl flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
        <span className="mr-1 shrink-0 font-heading text-sm font-semibold tracking-tight">
          smart money
        </span>
        <nav className="flex flex-wrap items-center gap-0.5 text-sm">
          {LINKS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={isActive(href) ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 whitespace-nowrap transition-colors",
                isActive(href)
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icon className="hidden size-3.5 sm:block" aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

/**
 * Escritorio: la columna.
 *
 * `h-dvh` y `sticky` para que no se vaya con el scroll de una lista larga —
 * la de movimientos es justamente eso. El `shrink-0` es necesario: sin él el
 * flex del body le come ancho a la columna cuando el contenido no entra, y los
 * labels se parten.
 */
function Sidebar() {
  const isActive = useActive();

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 border-r bg-muted/30 px-3 py-5 lg:flex">
      <span className="px-2 pb-4 font-heading text-sm font-semibold tracking-tight">
        smart money
      </span>

      <nav className="flex flex-col gap-0.5 text-sm">
        {LINKS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(href) ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-2 transition-colors",
              isActive(href)
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
          </Link>
        ))}
      </nav>

      <div className="mt-auto border-t pt-3">
        <ThemeToggle />
      </div>
    </aside>
  );
}
