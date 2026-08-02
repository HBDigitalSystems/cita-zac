import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BadgeCheck,
  CalendarClock,
  ClipboardCheck,
  Clock3,
  CreditCard,
  ExternalLink,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PanelHeading, ComingSoon } from "@/routes/panel";
import { DoctorAgenda } from "@/components/doctor-agenda";
import { supabase } from "@/integrations/supabase/client";
import { getDoctorAppointments } from "@/services/appointments";
import { useAuth } from "@/store/auth";
import { DoctorReviewsPanel } from "@/components/doctor-reviews-panel";
import type { Enums } from "@/integrations/supabase/types";

export const Route = createFileRoute("/panel/medico")({
  head: () => ({ meta: [{ title: "Panel del médico · DoctorCita" }] }),
  component: DoctorPanel,
});

type DoctorRecord = {
  id: string;
  slug: string;
  status: Enums<"doctor_status">;
  has_active_subscription: boolean;
  rating_average: number;
  reviews_count: number;
  appointments_count: number;
};

/** Cómo se le explica al médico cada estado de su expediente. */
const STATUS_COPY: Record<
  Enums<"doctor_status">,
  { badge: string; title: string; body: string }
> = {
  draft: {
    badge: "Borrador",
    title: "Completa tu perfil para aparecer en el buscador",
    body: "Necesitamos tu cédula profesional, especialidad y al menos un consultorio con horarios.",
  },
  pending_verification: {
    badge: "En revisión",
    title: "Estamos validando tu cédula",
    body: "Recibimos tus datos. En cuanto verifiquemos la cédula te avisamos por correo y tu perfil podrá publicarse.",
  },
  verified: {
    badge: "Verificado",
    title: "Tu cédula está verificada",
    body: "Solo falta una suscripción activa para que tu perfil aparezca en las búsquedas.",
  },
  rejected: {
    badge: "Rechazado",
    title: "No pudimos validar tu documentación",
    body: "Revisa los datos de tu cédula y vuelve a enviarlos. Si crees que es un error, escríbenos.",
  },
  suspended: {
    badge: "Suspendido",
    title: "Tu perfil está suspendido",
    body: "Contacta con soporte para conocer los motivos y cómo reactivarlo.",
  },
};

function DoctorPanel() {
  const navigate = useNavigate();
  const { status, user, roles, rolesLoaded } = useAuth();

  const [doctor, setDoctor] = useState<DoctorRecord | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Un paciente que escriba la URL a mano se va a su propio panel. La condición
  // `rolesLoaded` evita expulsar a un médico de verdad durante el instante en
  // que la lista de roles aún viaja desde el servidor.
  useEffect(() => {
    if (status === "authenticated" && rolesLoaded && !roles.includes("doctor")) {
      void navigate({ to: "/panel/paciente", replace: true });
    }
  }, [status, roles, rolesLoaded, navigate]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    void supabase
      .from("doctors")
      .select(
        "id,slug,status,has_active_subscription,rating_average,reviews_count,appointments_count",
      )
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setDoctor(data);
        setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const citas = useQuery({
    queryKey: ["doctor-appointments", doctor?.id],
    queryFn: () => getDoctorAppointments(doctor!.id),
    enabled: Boolean(doctor?.id),
  });

  const proximas = (citas.data ?? []).filter(
    (c) =>
      ["pending", "confirmed", "in_progress"].includes(c.status) &&
      new Date(c.starts_at).getTime() >= Date.now(),
  ).length;

  const state = doctor ? STATUS_COPY[doctor.status] : STATUS_COPY.draft;
  const isPublic = doctor?.status === "verified" && doctor.has_active_subscription;

  return (
    <>
      <PanelHeading
        title="Panel del médico"
        description="Tu consultorio, tu agenda y tus pacientes."
        badge={loaded ? state.badge : undefined}
      />

      <section
        className={
          isPublic
            ? "rounded-2xl border border-success/30 bg-success/5 p-6"
            : "rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6"
        }
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {doctor?.status === "pending_verification" ? (
              <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            ) : (
              <BadgeCheck
                className={`mt-0.5 h-5 w-5 shrink-0 ${isPublic ? "text-success" : "text-amber-600"}`}
              />
            )}
            <div>
              <h2 className="text-base font-semibold text-secondary">
                {isPublic ? "Tu perfil está publicado" : state.title}
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {isPublic ? "Los pacientes ya pueden encontrarte y reservar contigo." : state.body}
              </p>
            </div>
          </div>

          {loaded && (
            <div className="flex gap-2">
              {isPublic && doctor && (
                <Button asChild variant="outline" className="gap-2">
                  <Link to="/medicos/$id" params={{ id: doctor.slug }}>
                    Ver mi perfil
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </Button>
              )}
              {(!doctor || doctor.status === "draft" || doctor.status === "rejected") && (
                <Button asChild>
                  <Link to="/onboarding/medico">{doctor ? "Continuar" : "Completar ahora"}</Link>
                </Button>
              )}
              {doctor && doctor.status !== "draft" && doctor.status !== "rejected" && (
                <Button asChild variant="outline">
                  <Link to="/onboarding/medico">Editar datos</Link>
                </Button>
              )}
            </div>
          )}
        </div>
      </section>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        {[
          // "Próximas" va primero: es lo que un médico mira al abrir el panel.
          // Antes solo se mostraba "atendidas", que cuenta las completadas — un
          // médico con dos citas mañana veía un cero y parecía que no había nada.
          { icon: CalendarClock, label: "Próximas citas", value: proximas },
          { icon: ClipboardCheck, label: "Atendidas", value: doctor?.appointments_count ?? 0 },
          { icon: Users, label: "Opiniones", value: doctor?.reviews_count ?? 0 },
          {
            icon: CreditCard,
            label: "Suscripción",
            value: doctor?.has_active_subscription ? "Activa" : "Sin plan",
          },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <stat.icon className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">{stat.label}</span>
            </div>
            <div className="mt-3 text-3xl font-semibold tabular-nums text-secondary">
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {doctor && (
        <div className="mt-8">
          <DoctorAgenda doctorId={doctor.id} />
        </div>
      )}

      {doctor && <DoctorReviewsPanel doctorId={doctor.id} />}

      {doctor?.status === "verified" && !doctor.has_active_subscription && (
        <section className="mt-6 rounded-2xl border border-border bg-card p-6">
          <h2 className="text-base font-semibold text-secondary">Falta activar un plan</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Tu cédula ya está verificada, pero el perfil no se publica sin suscripción. La
            contratación llega en la <strong>Fase 9</strong>.
          </p>
          <Badge variant="secondary" className="mt-4">
            Pendiente de construir
          </Badge>
        </section>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <ComingSoon title="Galería, servicios y certificaciones" phase="Fase 4 ampliada" />
        <ComingSoon title="Agenda y calendario en tiempo real" phase="Fase 6" />
      </div>
    </>
  );
}
