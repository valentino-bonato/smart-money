import Image from "next/image";
import { HandCoins } from "lucide-react";
import { cn } from "cn";
import { institutionFor } from "@/lib/institutions";

/**
 * El logo de la institución, dentro de un chip de medida fija.
 *
 * **El chip existe por el tema oscuro.** Los logos de marca vienen pensados
 * para fondo claro — el de BBVA es azul marino casi negro — así que sobre el
 * fondo oscuro de la app desaparecen. El chip blanco los deja legibles en los
 * dos temas sin tener que mantener una variante por marca.
 *
 * Mide siempre 54×34 aunque los logos no: así la columna de texto arranca
 * alineada en todas las tarjetas. Lo que cambia por marca es el tamaño del
 * logo adentro, que vive en `institutions.ts`.
 *
 * Una cuenta sin institución —"Me deben", "Percepciones a recuperar"— no es un
 * error: lleva un ícono gris, y arriba dice "Por cobrar" en vez del banco.
 */
export function AccountLogo({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const institution = institutionFor(name);

  return (
    <span
      className={cn(
        "flex h-[34px] w-[54px] shrink-0 items-center justify-center rounded-[9px] border",
        institution ? "bg-white" : "bg-muted",
        className,
      )}
    >
      {institution ? (
        <Image
          src={institution.logo.src}
          alt={institution.label}
          width={institution.logo.width}
          height={institution.logo.height}
          unoptimized
        />
      ) : (
        <HandCoins className="size-[18px] text-muted-foreground" aria-hidden />
      )}
    </span>
  );
}

/**
 * El nombre de una cuenta con el punto de color de su institución.
 *
 * Todo lugar donde se lee un nombre de cuenta pasa por acá, por la misma razón
 * que los montos pasan por `<Amount>`: si el punto de BBVA se arma a mano en
 * cuatro pantallas, en la quinta falta.
 *
 * Una cuenta sin institución reconocida —"Me deben"— se dibuja igual, con el
 * gris del tema. Saltear el punto desalinearía la columna de texto.
 */
export function AccountName({
  name,
  className,
  children,
}: {
  name: string;
  className?: string;
  /** Sufijo al lado del nombre: "· pago", un badge, lo que sea. */
  children?: React.ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-baseline gap-2", className)}>
      <AccountDot name={name} />
      <span>
        {name}
        {children}
      </span>
    </span>
  );
}

/** El punto solo, para donde el nombre ya está puesto (el label de un campo). */
export function AccountDot({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const institution = institutionFor(name);

  return (
    <span
      aria-hidden
      title={institution?.label}
      className={cn(
        "size-2.5 shrink-0 self-center rounded-full",
        !institution && "bg-muted-foreground/40",
        className,
      )}
      // Una clase armada como `bg-bank-${key}` no la ve el escáner de Tailwind:
      // compila en dev y sale sin color en el build.
      style={
        institution ? { backgroundColor: `var(${institution.cssVar})` } : undefined
      }
    />
  );
}
