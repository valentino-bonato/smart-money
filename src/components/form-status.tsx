import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * El resultado de un server action. Lo usaban las cinco pantallas con su propio
 * `<p>` de colores; el problema no era la repetición sino que un error de carga
 * se veía más chico que uno de conciliación.
 *
 * `role="status"` y no `alert`: la carga de un gasto es exitosa casi siempre y
 * un lector de pantalla no tiene que interrumpir por eso.
 */
export function FormStatus({
  status,
  message,
}: {
  status: "idle" | "ok" | "error";
  message?: string;
}) {
  if (status === "idle" || !message) return null;

  return (
    <Alert
      role="status"
      variant={status === "error" ? "destructive" : "default"}
      className={status === "ok" ? "text-positive [&>svg]:text-positive" : ""}
    >
      {status === "error" ? <AlertCircleIcon /> : <CheckCircle2Icon />}
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
