import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  Loader2,
  Mail,
  Phone,
  Stethoscope,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatPrice } from "@/lib/doctor-format";
import {
  cancelAppointment,
  completeAppointment,
  confirmAppointment,
  getDoctorAppointments,
} from "@/services/appointments";
import type { Enums } from "@/integrations/supabase/types";

const STATUS: Record<Enums<"appointment_status">, { label: string; className: string }> = {
  pending: { label: "Por confirmar", className: "bg-amber-500/10 text-amber-700" },
  confirmed: { label: "Confirmada", className: "bg-success/10 text-success" },
  in_progress: { label: "En consulta", className: "bg-primary/10 text-primary" },
  completed: { label: "Atendida", className: "bg-muted text-muted-foreground" },
  cancelled_by_patient: {
    label: "Cancelada por el paciente",
    className: "bg-muted text-muted-foreground",
  },
  cancelled_by_doctor: { label: "Cancelada por ti", className: "bg-muted text-muted-foreground" },
  no_show: { label: "No se presentó", className: "bg-destructive/10 text-destructive" },
  rescheduled: { label: "Reprogramada", className: "bg-muted text-muted-foreground" },
};

const ACTIVOS: Enums<"appointment_status">[] = ["pending", "confirmed", "in_progress"];

/** Edad a partir de la fecha de nacimiento, como la calcula la base de datos. */
function edad(fecha: string | null): number | null {
  if (!fecha) return null;
  const n = new Date(fecha);
  const hoy = new Date();
  let años = hoy.getFullYear() - n.getFullYear();
  const m = hoy.getMonth() - n.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < n.getDate())) años--;
  return años;
}

export function DoctorAgenda({ doctorId }: { doctorId: string }) {
  const queryClient = useQueryClient();
  const [trabajando, setTrabajando] = useState<string | null>(null);

  const citas = useQuery({
    queryKey: ["doctor-appointments", doctorId],
    queryFn: () => getDoctorAppointments(doctorId),
    enabled: Boolean(doctorId),
  });

  const refrescar = async () => {
    await queryClient.invalidateQueries({ queryKey: ["doctor-appointments"] });
    // La agenda pública cambió: el hueco se libera o se ocupa.
    await queryClient.invalidateQueries({ queryKey: ["availability"] });
  };

  const accion = async (id: string, fn: () => Promise<void>, mensaje: string) => {
    setTrabajando(id);
    try {
      await fn();
      toast.success(mensaje);
      await refrescar();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo completar la acción.");
    } finally {
      setTrabajando(null);
    }
  };

  if (citas.isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando tu agenda…
      </div>
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const filas = (citas.data ?? []) as any[];
  const ahora = Date.now();
  const proximas = filas.filter(
    (c) => ACTIVOS.includes(c.status) && new Date(c.starts_at).getTime() >= ahora,
  );
  const pasadas = filas
    .filter((c) => !ACTIVOS.includes(c.status) || new Date(c.starts_at).getTime() < ahora)
    .reverse();

  if (filas.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary">
          <CalendarDays className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-base font-semibold text-secondary">Sin citas todavía</h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Cuando un paciente reserve, aparecerá aquí con su motivo de consulta y sus datos de
          contacto.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-4 text-lg font-semibold text-secondary">
          Próximas citas{" "}
          <span className="font-normal text-muted-foreground">({proximas.length})</span>
        </h2>

        {proximas.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
            No tienes citas próximas.
          </p>
        ) : (
          <div className="space-y-4">
            {proximas.map((cita) => (
              <CitaCard
                key={cita.id}
                cita={cita}
                trabajando={trabajando === cita.id}
                onConfirmar={() =>
                  accion(cita.id, () => confirmAppointment(cita.id), "Cita confirmada.")
                }
                onAtendida={() =>
                  accion(cita.id, () => completeAppointment(cita.id), "Cita marcada como atendida.")
                }
                onCancelar={() =>
                  accion(cita.id, () => cancelAppointment(cita.id, "doctor"), "Cita cancelada.")
                }
              />
            ))}
          </div>
        )}
      </section>

      {pasadas.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-secondary">
            Historial <span className="font-normal text-muted-foreground">({pasadas.length})</span>
          </h2>
          <div className="space-y-4">
            {pasadas.map((cita) => (
              <CitaCard key={cita.id} cita={cita} trabajando={false} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CitaCard({
  cita,
  trabajando,
  onConfirmar,
  onAtendida,
  onCancelar,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cita: any;
  trabajando: boolean;
  onConfirmar?: () => void;
  onAtendida?: () => void;
  onCancelar?: () => void;
}) {
  const inicio = new Date(cita.starts_at);
  const estado = STATUS[cita.status as Enums<"appointment_status">];
  const paciente = cita.patients;
  const años = edad(paciente?.birth_date ?? null);
  const alergias: string[] = paciente?.allergies ?? [];
  const cronicos: string[] = paciente?.chronic_conditions ?? [];

  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
            <User className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-secondary">
              {paciente?.users?.full_name ?? "Paciente"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {años !== null && `${años} años`}
              {paciente?.blood_type && ` · ${paciente.blood_type}`}
              {cita.is_first_visit && " · Primera visita"}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1">
          <Badge variant="secondary" className={estado.className}>
            {estado.label}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground">{cita.reference}</span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          {inicio.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}
          {" · "}
          {inicio.toLocaleTimeString("es-MX", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })}
        </span>
        <span className="text-muted-foreground">
          {formatPrice(cita.price_cents)}
          {cita.modality === "video" && " · Videoconsulta"}
        </span>
      </div>

      {cita.reason && (
        <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-sm">
          <span className="font-medium text-secondary">Motivo:</span>{" "}
          <span className="text-muted-foreground">{cita.reason}</span>
        </p>
      )}

      {/* Lo que un médico necesita ver antes de entrar a consulta. Las alergias
          van destacadas a propósito: es el dato con consecuencias graves si se
          pasa por alto al recetar. */}
      {(alergias.length > 0 || cronicos.length > 0) && (
        <div className="mt-3 space-y-2">
          {alergias.length > 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <span>
                <span className="font-medium text-destructive">Alergias:</span>{" "}
                <span className="text-foreground">{alergias.join(", ")}</span>
              </span>
            </p>
          )}
          {cronicos.length > 0 && (
            <p className="flex items-start gap-2 rounded-lg bg-surface px-3 py-2 text-sm">
              <Stethoscope className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="font-medium text-secondary">Padecimientos:</span>{" "}
                <span className="text-muted-foreground">{cronicos.join(", ")}</span>
              </span>
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-dashed border-border pt-4 text-sm">
        {paciente?.users?.phone && (
          <a
            href={`tel:${paciente.users.phone}`}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-primary"
          >
            <Phone className="h-4 w-4" />
            {paciente.users.phone}
          </a>
        )}
        {paciente?.users?.email && (
          <a
            href={`mailto:${paciente.users.email}`}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-primary"
          >
            <Mail className="h-4 w-4" />
            {paciente.users.email}
          </a>
        )}
        {paciente?.emergency_contact_phone && (
          <span className="text-xs text-muted-foreground">
            Urgencias: {paciente.emergency_contact_name} · {paciente.emergency_contact_phone}
          </span>
        )}
      </div>

      {(onConfirmar || onAtendida || onCancelar) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {cita.status === "pending" && onConfirmar && (
            <Button size="sm" onClick={onConfirmar} disabled={trabajando} className="gap-1.5">
              <Check className="h-4 w-4" />
              Confirmar
            </Button>
          )}
          {cita.status === "confirmed" && onAtendida && (
            <Button size="sm" onClick={onAtendida} disabled={trabajando} className="gap-1.5">
              <Check className="h-4 w-4" />
              Marcar como atendida
            </Button>
          )}
          {onCancelar && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onCancelar}
              disabled={trabajando}
              className={cn(
                "gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive",
              )}
            >
              <X className="h-4 w-4" />
              Cancelar
            </Button>
          )}
          {trabajando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
      )}
    </article>
  );
}
