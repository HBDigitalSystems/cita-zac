// Bitácora de auditoría del panel de administración.
//
// Es el registro de quién cambió qué y cuándo en las tablas sensibles. Existe
// desde la Fase 1 —lo escriben triggers— pero nunca se había podido consultar
// desde la aplicación.
//
// Cuidado con lo que se muestra: `old_data` y `new_data` traen la fila entera,
// y en tablas clínicas eso incluiría diagnósticos. Aquí solo se pintan los
// NOMBRES de las columnas que cambiaron, nunca sus valores. Un administrador
// puede saber que una nota clínica se modificó, y eso es lo que necesita para
// dar soporte, sin llegar a leer el diagnóstico.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Entrada = {
  id: number;
  table_name: string;
  record_id: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  changed_keys: string[] | null;
  created_at: string;
  users: { full_name: string | null } | null;
};

const ACCION = {
  INSERT: { texto: "Creó", clase: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400" },
  UPDATE: { texto: "Modificó", clase: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-400" },
  DELETE: { texto: "Eliminó", clase: "bg-destructive/10 text-destructive" },
} as const;

const TABLAS: Record<string, string> = {
  doctors: "Médico",
  medical_records: "Nota clínica",
  documents: "Documento",
  prescriptions: "Receta",
  appointments: "Cita",
  reviews: "Reseña",
  expenses: "Gasto",
  user_roles: "Rol de usuario",
  subscriptions: "Suscripción",
};

async function getBitacora(): Promise<Entrada[]> {
  const { data, error } = await supabase
    .from("audit_logs")
    // Se piden `changed_keys` pero NO `old_data` ni `new_data`: bastaría con
    // traerlos para que el contenido clínico saliera de su perímetro.
    .select("id, table_name, record_id, action, changed_keys, created_at, users ( full_name )")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw error;
  return (data ?? []) as unknown as Entrada[];
}

export function AuditLogPanel() {
  const [filtro, setFiltro] = useState<string>("");

  const { data, isLoading } = useQuery({ queryKey: ["audit-logs"], queryFn: getBitacora });

  const entradas = (data ?? []).filter((e) => !filtro || e.table_name === filtro);
  const tablas = [...new Set((data ?? []).map((e) => e.table_name))].sort();

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-secondary">
            <ScrollText className="h-5 w-5 text-muted-foreground" />
            Bitácora de auditoría
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Quién cambió qué y cuándo. Se registran los campos modificados, no su contenido.
          </p>
        </div>

        {tablas.length > 0 && (
          <select
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            aria-label="Filtrar por tipo de registro"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos los registros</option>
            {tablas.map((t) => (
              <option key={t} value={t}>
                {TABLAS[t] ?? t}
              </option>
            ))}
          </select>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="mt-4 h-40 rounded-2xl" />
      ) : entradas.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No hay movimientos registrados.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-2xl border border-border bg-card">
          {entradas.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
              <Badge variant="secondary" className={cn("shrink-0", ACCION[e.action]?.clase)}>
                {ACCION[e.action]?.texto ?? e.action}
              </Badge>

              <span className="text-sm font-medium text-secondary">
                {TABLAS[e.table_name] ?? e.table_name}
              </span>

              <span className="text-sm text-muted-foreground">
                {/* Cuando el cambio lo hace un trigger del sistema no hay actor,
                    y decirlo es más honesto que dejar el hueco en blanco. */}
                por {e.users?.full_name ?? "el sistema"}
              </span>

              <time
                className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground"
                dateTime={e.created_at}
              >
                {new Date(e.created_at).toLocaleString("es-MX", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>

              {e.changed_keys && e.changed_keys.length > 0 && (
                <p className="w-full text-xs text-muted-foreground">
                  Campos: {e.changed_keys.join(", ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
