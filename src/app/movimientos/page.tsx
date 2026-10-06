import Link from "next/link";
import { asc, eq, inArray, isNull, and, sql } from "drizzle-orm";
import { PlusCircle, Search } from "lucide-react";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { ledgerPage, type LedgerFilters, type MovementKind } from "@/db/queries";
import { formatMoney } from "@/lib/money";
import { getCurrentUser } from "@/lib/user";
import { AccountDot } from "@/components/account-name";
import { Amount } from "@/components/money";
import { PageHeader, PageShell } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Empty, EmptyDescription, EmptyTitle } from "@/components/ui/empty";
import { DeleteButton } from "../delete-button";

export const dynamic = "force-dynamic";

const PER_PAGE = 25;

const KINDS: MovementKind[] = [
  "gasto",
  "ingreso",
  "transferencia",
  "pago",
  "cambio",
  "ajuste",
  "apertura",
];

function todayInBuenosAires(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date());
}

/** "2026-10-03" → "sábado 3 de octubre". El año solo si no es el corriente. */
function dayLabel(date: string, today: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const long = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    ...(date.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
  }).format(d);
  if (date === today) return `Hoy · ${long}`;
  return long.charAt(0).toUpperCase() + long.slice(1);
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

/**
 * El libro contable completo, con su propia pantalla.
 *
 * Separada de Cargar a propósito: cargar un gasto es una tarea de diez
 * segundos en el teléfono y revisar el libro es una de escritorio con tabla
 * ancha. Meter las dos en la misma pantalla obliga a que una de las dos pierda.
 *
 * **Los filtros viven en la URL, no en estado de cliente.** Así la pantalla
 * sigue siendo un server component que consulta lo justo, un filtro se puede
 * compartir o guardar en favoritos, y el botón de atrás hace lo que se espera.
 * El precio es que hay que apretar "Filtrar" en vez de que se aplique solo:
 * barato, porque esto no está en el camino de carga de §8.
 */
export default async function MovimientosPage({
  searchParams,
}: PageProps<"/movimientos">) {
  const user = await getCurrentUser();
  const today = todayInBuenosAires();
  const params = await searchParams;

  const one = (k: string): string | null => {
    const v = params[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s && s.length ? s : null;
  };

  const kindParam = one("tipo");
  const filters: LedgerFilters = {
    month: one("mes"),
    accountId: one("cuenta"),
    envelopeId: one("sobre"),
    kind: KINDS.includes(kindParam as MovementKind)
      ? (kindParam as MovementKind)
      : null,
    q: one("q"),
  };

  const page = Math.max(1, Number(one("p") ?? 1) || 1);

  const [accounts, envelopes, months, ledger] = await Promise.all([
    db
      .select({ id: schema.accounts.id, name: schema.accounts.name })
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.userId, user.id),
          isNull(schema.accounts.archivedAt),
          eq(schema.accounts.isSystem, false),
          inArray(schema.accounts.type, ["asset", "liability"]),
        ),
      )
      .orderBy(asc(schema.accounts.displayOrder)),
    db
      .select({ id: schema.envelopes.id, name: schema.envelopes.name })
      .from(schema.envelopes)
      .where(
        and(
          eq(schema.envelopes.userId, user.id),
          isNull(schema.envelopes.archivedAt),
        ),
      )
      .orderBy(asc(schema.envelopes.displayOrder)),
    availableMonths(user.id),
    ledgerPage(db, {
      userId: user.id,
      filters,
      limit: PER_PAGE,
      offset: (page - 1) * PER_PAGE,
    }),
  ]);

  const { rows, total, totals } = ledger;
  const lastPage = Math.max(1, Math.ceil(total / PER_PAGE));

  // Agrupadas por día, en el orden en que ya vienen de la base: ordenar acá
  // sería una segunda definición de "último" que se puede desincronizar.
  const days: { date: string; rows: typeof rows }[] = [];
  for (const r of rows) {
    const last = days.at(-1);
    if (last && last.date === r.date) last.rows.push(r);
    else days.push({ date: r.date, rows: [r] });
  }

  const href = (changes: Record<string, string | null>) => {
    const current: Record<string, string | null> = {
      mes: filters.month ?? null,
      cuenta: filters.accountId ?? null,
      sobre: filters.envelopeId ?? null,
      tipo: filters.kind ?? null,
      q: filters.q ?? null,
      p: page > 1 ? String(page) : null,
    };
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...current, ...changes })) {
      if (v && !(k === "p" && v === "1")) next.set(k, v);
    }
    const s = next.toString();
    return s ? `/movimientos?${s}` : "/movimientos";
  };

  const filtered =
    filters.month || filters.accountId || filters.envelopeId || filters.kind || filters.q;

  return (
    <PageShell>
      <PageHeader
        title="Movimientos"
        action={
          <Button asChild>
            <Link href="/">
              <PlusCircle aria-hidden />
              Cargar gasto
            </Link>
          </Button>
        }
      >
        {total} {total === 1 ? "asiento" : "asientos"}
        {filters.month ? ` de ${monthLabel(filters.month)}` : " en el libro"}
        {filtered ? " con este filtro" : ""}.
      </PageHeader>

      {/* Un form GET: los filtros terminan en la URL y la pantalla sigue
          siendo un server component. Los selects son nativos — en el teléfono
          la rueda del sistema gana. */}
      <form method="get" className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              name="q"
              defaultValue={filters.q ?? ""}
              placeholder="Buscar por comercio o descripción"
              className="h-9 pl-9"
              aria-label="Buscar"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-2">
            <NativeSelect
              name="mes"
              defaultValue={filters.month ?? ""}
              className="h-9"
              aria-label="Mes"
            >
              <option value="">Todo</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              name="cuenta"
              defaultValue={filters.accountId ?? ""}
              className="h-9"
              aria-label="Cuenta"
            >
              <option value="">Toda cuenta</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              name="sobre"
              defaultValue={filters.envelopeId ?? ""}
              className="h-9"
              aria-label="Sobre"
            >
              <option value="">Todo sobre</option>
              {envelopes.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              name="tipo"
              defaultValue={filters.kind ?? ""}
              className="h-9"
              aria-label="Tipo"
            >
              <option value="">Todo tipo</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.charAt(0).toUpperCase() + k.slice(1)}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm">
            Filtrar
          </Button>
          {filtered ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/movimientos">Limpiar</Link>
            </Button>
          ) : null}
        </div>
      </form>

      {totals.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {totals.map((t) => (
            <li
              key={`out-${t.currency}`}
              className="flex flex-col gap-1 rounded-xl border p-4"
            >
              <span className="text-xs font-medium text-muted-foreground">
                Salió · {t.currency}
              </span>
              <span className="money font-heading text-lg font-semibold">
                −{formatMoney(t.outflow, t.currency)}
              </span>
            </li>
          ))}
          {totals.map((t) => (
            <li
              key={`in-${t.currency}`}
              className="flex flex-col gap-1 rounded-xl border p-4"
            >
              <span className="text-xs font-medium text-muted-foreground">
                Entró · {t.currency}
              </span>
              <span className="money font-heading text-lg font-semibold">
                {formatMoney(t.inflow, t.currency)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {rows.length ? (
        <div className="overflow-hidden rounded-xl border">
          {/* La cabecera de columnas solo en escritorio: en el teléfono cada
              movimiento se lee como una ficha apilada, no como una fila. */}
          <div className="hidden items-center gap-3 border-b bg-muted/40 px-4 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase lg:flex">
            <span className="flex-1">Movimiento</span>
            <span className="w-56">Salió de</span>
            <span className="w-32">Sobre</span>
            <span className="w-28">Tipo</span>
            <span className="w-40 text-right">Monto</span>
            <span className="w-8" />
          </div>

          {days.map((d) => (
            <section key={d.date}>
              <h2 className="border-b bg-muted/40 px-4 py-1.5 text-xs font-semibold">
                {dayLabel(d.date, today)}
              </h2>
              <ul className="divide-y">
                {d.rows.map((t) => (
                  <li
                    key={t.id}
                    className="flex flex-col gap-1.5 px-4 py-3 lg:flex-row lg:items-center lg:gap-3"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">
                        {t.payee ?? t.description ?? "—"}
                      </span>
                      {t.payee && t.description ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {t.description}
                        </span>
                      ) : null}
                      {t.category ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {t.category.replace(/^Gastos:/, "")}
                        </span>
                      ) : null}
                    </span>

                    <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground lg:w-56">
                      {t.source ? (
                        <>
                          <AccountDot name={t.source} className="size-2" />
                          <span className="truncate">{t.source}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </span>

                    <span className="truncate text-xs text-muted-foreground lg:w-32 lg:text-sm">
                      {t.envelope ?? "—"}
                    </span>

                    <span className="lg:w-28">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {t.kind}
                      </span>
                    </span>

                    <span className="flex flex-col items-start text-sm lg:w-40 lg:items-end">
                      {t.kind === "cambio" && t.outflows.length ? (
                        <span className="money text-xs text-muted-foreground">
                          {t.outflows
                            .map((o) => formatMoney(o.amount, o.currency))
                            .join(" + ")}{" "}
                          →
                        </span>
                      ) : null}
                      {t.inflows.length ? (
                        t.inflows.map((i) => (
                          <Amount key={i.currency} {...i} tone="plain" />
                        ))
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </span>

                    <span className="lg:w-8">
                      {t.kind !== "apertura" ? <DeleteButton id={t.id} /> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <Empty className="rounded-xl border py-10">
          <EmptyTitle>No hay movimientos</EmptyTitle>
          <EmptyDescription>
            {filtered
              ? "Ningún asiento coincide con este filtro."
              : "Todavía no se cargó nada en el libro."}
          </EmptyDescription>
        </Empty>
      )}

      {lastPage > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <span className="money text-sm text-muted-foreground">
            {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, total)} de{" "}
            {total}
          </span>
          <div className="flex gap-2">
            <Button
              asChild={page > 1}
              variant="outline"
              size="sm"
              disabled={page <= 1}
            >
              {page > 1 ? (
                <Link href={href({ p: String(page - 1) })}>Anterior</Link>
              ) : (
                <span>Anterior</span>
              )}
            </Button>
            <Button
              asChild={page < lastPage}
              variant="outline"
              size="sm"
              disabled={page >= lastPage}
            >
              {page < lastPage ? (
                <Link href={href({ p: String(page + 1) })}>Siguiente</Link>
              ) : (
                <span>Siguiente</span>
              )}
            </Button>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}

/** Los meses que tienen algo cargado, para no ofrecer meses vacíos. */
async function availableMonths(userId: string): Promise<string[]> {
  const rows = await db.execute<{ month: string }>(sql`
    select distinct to_char(date, 'YYYY-MM') as month
    from transactions
    where user_id = ${userId}
    order by month desc
  `);
  return (rows as unknown as { month: string }[]).map((r) => r.month);
}
