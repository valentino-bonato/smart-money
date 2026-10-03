import { cn } from "cn";
import { institutionFor } from "@/lib/institutions";

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
