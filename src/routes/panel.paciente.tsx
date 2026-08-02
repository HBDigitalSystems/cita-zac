import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, FileText, Heart, Search, UserPen, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PanelHeading, ComingSoon } from "@/routes/panel";
import { AppointmentCard, type AppointmentRow } from "@/components/appointment-card";
import { supabase } from "@/integrations/supabase/client";
import { cancelAppointment, getPatientAppointments } from "@/services/appointments";
import { useAuth } from "@/store/auth";
import { PendingReviews } from "@/components/review-form";
import { useShortlist } from "@/store/doctor-shortlist";
import { useHydrated } from "@/hooks/use-hydrated";

export const Route = createFileRoute("/panel/paciente")({
  head: () => ({ meta: [{ title: "Mi panel · DoctorCita" }] }),
  component: PatientPanel,
});

function PatientPanel() {
  const { user } = useAuth();
  const hydrated = useHydrated();
  const { favorites } = useShortlist();
  const queryClient = useQueryClient();

  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const firstName = (user?.user_metadata?.first_name as string | undefined) ?? "";

  const patient = useQuery({
    queryKey: ["my-patient", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patients")
        .select("id")
        .eq("user_id", user!.id)
        .maybeSingle();
      // Un error aquí casi siempre es la tabla sin migrar; se trata como
      // "todavía no hay expediente" en vez de romper el panel.
      if (error) return null;
      return data;
    },
    enabled: Boolean(user?.id),
  });

  const appointments = useQuery({
    queryKey: ["my-appointments", patient.data?.id],
    queryFn: () => getPatientAppointments(patient.data!.id),
    enabled: Boolean(patient.data?.id),
  });

  const { upcoming, past } = useMemo(() => {
    const rows = (appointments.data ?? []) as unknown as AppointmentRow[];
    const now = Date.now();
    const active = ["pending", "confirmed", "in_progress"];

    return {
      upcoming: rows
        .filter((a) => new Date(a.starts_at).getTime() >= now && active.includes(a.status))
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
      past: rows.filter((a) => new Date(a.starts_at).getTime() < now || !active.includes(a.status)),
    };
  }, [appointments.data]);

  const handleCancel = async (id: string) => {
    setCancellingId(id);
    try {
      await cancelAppointment(id);
      toast.success("Cita cancelada.");
      await queryClient.invalidateQueries({ queryKey: ["my-appointments"] });
      // La agenda del médico cambió: se invalida para que el hueco vuelva a
      // ofrecerse sin recargar la página.
      await queryClient.invalidateQueries({ queryKey: ["availability"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos cancelar la cita.");
    } finally {
      setCancellingId(null);
    }
  };

  const profileMissing = patient.isFetched && !patient.data;

  return (
    <>
      <PanelHeading
        title={firstName ? `Hola, ${firstName}` : "Mi panel"}
        description="Tus citas, tu historial y los médicos que has guardado."
      />

      {profileMissing && (
        <section className="mb-6 rounded-2xl border border-primary/30 bg-primary-soft/40 p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <UserPen className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div>
                <h2 className="text-base font-semibold text-secondary">
                  Completa tu perfil médico
                </h2>
                <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                  Alergias, tipo de sangre y contacto de urgencia. Son dos minutos y tu médico los
                  necesita antes de la primera consulta.
                </p>
              </div>
            </div>
            <Button asChild>
              <Link to="/onboarding/paciente">Completar ahora</Link>
            </Button>
          </div>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={CalendarDays}
          label="Próximas citas"
          value={appointments.isLoading ? "—" : String(upcoming.length)}
          hint={upcoming.length > 0 ? "Ya reservadas" : "Reserva desde el buscador"}
        />
        <StatCard
          icon={Heart}
          label="Médicos guardados"
          value={hydrated ? String(favorites.length) : "—"}
          hint="Desde el buscador"
        />
        <StatCard
          icon={FileText}
          label="Consultas atendidas"
          value={
            appointments.isLoading
              ? "—"
              : String(past.filter((a) => a.status === "completed").length)
          }
          hint="Tu historial, en la Fase 7"
        />
      </div>

      <section className="mt-8">
        <h2 className="mb-4 text-lg font-semibold text-secondary">Próximas citas</h2>

        {appointments.isLoading ? (
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando tus citas…
          </div>
        ) : upcoming.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-6">
            <h3 className="text-base font-semibold text-secondary">
              Todavía no tienes ninguna cita
            </h3>
            <p className="mt-2 max-w-lg text-sm text-muted-foreground">
              Busca por especialidad o municipio y reserva con un especialista verificado de
              Zacatecas.
            </p>
            <Button asChild className="mt-5 gap-2">
              <Link to="/medicos">
                <Search className="h-4 w-4" />
                Buscar médico
              </Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {upcoming.map((appointment) => (
              <AppointmentCard
                key={appointment.id}
                appointment={appointment}
                onCancel={handleCancel}
                cancelling={cancellingId === appointment.id}
              />
            ))}
          </div>
        )}
      </section>

      {patient.data?.id && <PendingReviews patientId={patient.data.id} />}

      {past.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 text-lg font-semibold text-secondary">Historial</h2>
          <div className="space-y-4">
            {past.map((appointment) => (
              <AppointmentCard key={appointment.id} appointment={appointment} />
            ))}
          </div>
        </section>
      )}

      <div className="mt-8">
        <ComingSoon title="Expediente clínico, recetas y facturas" phase="Fase 7" />
      </div>
    </>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-3 text-3xl font-semibold tabular-nums text-secondary">{value}</div>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
