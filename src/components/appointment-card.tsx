import { Link } from "@tanstack/react-router";
import { CalendarDays, MapPin, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Enums } from "@/integrations/supabase/types";

/** Cómo se le nombra a cada estado y con qué color. */
const STATUS: Record<Enums<"appointment_status">, { label: string; className: string }> = {
  pending: { label: "Pendiente de confirmar", className: "bg-amber-500/10 text-amber-700" },
  confirmed: { label: "Confirmada", className: "bg-success/10 text-success" },
  in_progress: { label: "En consulta", className: "bg-primary/10 text-primary" },
  completed: { label: "Atendida", className: "bg-muted text-muted-foreground" },
  cancelled_by_patient: { label: "Cancelada por ti", className: "bg-muted text-muted-foreground" },
  cancelled_by_doctor: {
    label: "Cancelada por el médico",
    className: "bg-destructive/10 text-destructive",
  },
  no_show: { label: "No asististe", className: "bg-destructive/10 text-destructive" },
  rescheduled: { label: "Reprogramada", className: "bg-muted text-muted-foreground" },
};

export type AppointmentRow = {
  id: string;
  reference: string;
  starts_at: string;
  ends_at: string;
  status: Enums<"appointment_status">;
  modality: Enums<"appointment_modality">;
  reason: string | null;
  price_cents: number | null;
  doctors: {
    slug: string;
    gender: string | null;
    users: { full_name: string | null } | null;
    specialties: { name: string } | null;
  } | null;
  consulting_rooms: {
    name: string;
    address: string;
    municipalities: { name: string } | null;
  } | null;
};

/** Estados en los que una cita todavía puede cancelarse. */
const CANCELABLE: Enums<"appointment_status">[] = ["pending", "confirmed"];

export function AppointmentCard({
  appointment,
  cancellationHours = 24,
  onCancel,
  cancelling,
}: {
  appointment: AppointmentRow;
  cancellationHours?: number;
  onCancel?: (id: string) => void;
  cancelling?: boolean;
}) {
  const starts = new Date(appointment.starts_at);
  const status = STATUS[appointment.status];

  const doctorName = appointment.doctors?.users?.full_name
    ? `${appointment.doctors.gender === "female" ? "Dra." : "Dr."} ${appointment.doctors.users.full_name}`
    : "Médico";

  const hoursUntil = (starts.getTime() - Date.now()) / 3_600_000;
  const isPast = hoursUntil < 0;

  // La política del médico manda: pasado el plazo ya no se cancela desde aquí.
  // El paciente sigue pudiendo llamar al consultorio, y así se le dice.
  const canCancel = CANCELABLE.includes(appointment.status) && hoursUntil > cancellationHours;
  const tooLate =
    CANCELABLE.includes(appointment.status) && hoursUntil > 0 && hoursUntil <= cancellationHours;

  return (
    <article className={cn("rounded-2xl border border-border bg-card p-5", isPast && "opacity-70")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-secondary">{doctorName}</h3>
            <Badge variant="secondary" className={status.className}>
              {status.label}
            </Badge>
          </div>
          <p className="mt-0.5 text-sm text-primary">{appointment.doctors?.specialties?.name}</p>
        </div>

        <span className="font-mono text-xs text-muted-foreground">{appointment.reference}</span>
      </div>

      <dl className="mt-4 space-y-1.5 text-sm">
        <div className="flex items-start gap-2 text-muted-foreground">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" />
          <dd className="text-foreground">
            {starts.toLocaleDateString("es-MX", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
            {" · "}
            {starts.toLocaleTimeString("es-MX", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
          </dd>
        </div>

        {appointment.modality === "video" ? (
          <div className="flex items-start gap-2 text-muted-foreground">
            <Video className="mt-0.5 h-4 w-4 shrink-0" />
            <dd>Videoconsulta</dd>
          </div>
        ) : (
          appointment.consulting_rooms && (
            <div className="flex items-start gap-2 text-muted-foreground">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
              <dd>
                {appointment.consulting_rooms.name} · {appointment.consulting_rooms.address}
                {appointment.consulting_rooms.municipalities &&
                  `, ${appointment.consulting_rooms.municipalities.name}`}
              </dd>
            </div>
          )
        )}
      </dl>

      {appointment.reason && (
        <p className="mt-3 rounded-lg bg-surface px-3 py-2 text-sm text-muted-foreground">
          <span className="font-medium text-secondary">Motivo:</span> {appointment.reason}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-dashed border-border pt-4">
        {appointment.doctors && (
          <Button asChild variant="outline" size="sm">
            <Link to="/medicos/$id" params={{ id: appointment.doctors.slug }}>
              Ver perfil del médico
            </Link>
          </Button>
        )}

        {canCancel && onCancel && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onCancel(appointment.id)}
            disabled={cancelling}
          >
            <X className="h-4 w-4" />
            {cancelling ? "Cancelando…" : "Cancelar cita"}
          </Button>
        )}

        {tooLate && (
          <p className="text-xs text-muted-foreground">
            Ya no puedes cancelar en línea: faltan menos de {cancellationHours} horas. Llama al
            consultorio.
          </p>
        )}
      </div>
    </article>
  );
}
