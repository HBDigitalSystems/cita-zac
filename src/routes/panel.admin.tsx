import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  CalendarDays,
  Check,
  ExternalLink,
  GraduationCap,
  Loader2,
  MapPin,
  Stethoscope,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PanelHeading, ComingSoon } from "@/routes/panel";
import {
  approveDoctor,
  getDoctorsForReview,
  getPlatformStats,
  getReviewedDoctors,
  rejectDoctor,
  suspendDoctor,
  type DoctorForReview,
} from "@/services/admin";
import { isAdmin, useAuth } from "@/store/auth";

export const Route = createFileRoute("/panel/admin")({
  head: () => ({ meta: [{ title: "Administración · DoctorCita" }] }),
  component: AdminPanel,
});

function AdminPanel() {
  const navigate = useNavigate();
  const { status, user, roles, rolesLoaded } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (status === "authenticated" && rolesLoaded && !isAdmin(roles)) {
      void navigate({ to: "/panel/paciente", replace: true });
    }
  }, [status, roles, rolesLoaded, navigate]);

  const stats = useQuery({ queryKey: ["admin-stats"], queryFn: getPlatformStats });
  const pendientes = useQuery({ queryKey: ["admin-review"], queryFn: getDoctorsForReview });
  const resueltos = useQuery({ queryKey: ["admin-reviewed"], queryFn: getReviewedDoctors });

  const refrescar = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-review"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-reviewed"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-stats"] }),
      // El directorio público cambia al aprobar o suspender.
      queryClient.invalidateQueries({ queryKey: ["doctors"] }),
    ]);
  };

  if (!rolesLoaded || !isAdmin(roles)) return null;

  return (
    <>
      <PanelHeading
        title="Administración"
        description="Validación de cédulas, médicos y actividad de la plataforma."
      />

      <div className="grid gap-4 sm:grid-cols-4">
        {[
          { icon: BadgeCheck, label: "Médicos publicados", value: stats.data?.medicos_publicados },
          { icon: Stethoscope, label: "Por revisar", value: stats.data?.medicos_pendientes },
          { icon: Users, label: "Pacientes", value: stats.data?.pacientes },
          { icon: CalendarDays, label: "Citas", value: stats.data?.citas },
        ].map((s) => (
          <div key={s.label} className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <s.icon className="h-4 w-4" />
              <span className="text-xs font-medium uppercase tracking-wider">{s.label}</span>
            </div>
            <div className="mt-3 text-3xl font-semibold tabular-nums text-secondary">
              {stats.isLoading ? "—" : (s.value ?? 0)}
            </div>
          </div>
        ))}
      </div>

      <Tabs defaultValue="pendientes" className="mt-8">
        <TabsList>
          <TabsTrigger value="pendientes">
            Por revisar
            {(pendientes.data?.length ?? 0) > 0 && (
              <Badge variant="secondary" className="ml-2">
                {pendientes.data?.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="resueltos">Ya revisados</TabsTrigger>
        </TabsList>

        <TabsContent value="pendientes" className="mt-6">
          {pendientes.isLoading ? (
            <Cargando />
          ) : (pendientes.data?.length ?? 0) === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
                <Check className="h-6 w-6" />
              </div>
              <p className="mt-4 text-base font-semibold text-secondary">No hay nada pendiente</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Todas las solicitudes de verificación están resueltas.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {pendientes.data?.map((doctor) => (
                <FichaRevision
                  key={doctor.id}
                  doctor={doctor}
                  onAprobar={async () => {
                    await approveDoctor(doctor.id, user!.id);
                    toast.success("Médico verificado.");
                    await refrescar();
                  }}
                  onRechazar={async (motivo) => {
                    await rejectDoctor(doctor.id, motivo);
                    toast.success("Solicitud rechazada.");
                    await refrescar();
                  }}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="resueltos" className="mt-6">
          {resueltos.isLoading ? (
            <Cargando />
          ) : (resueltos.data?.length ?? 0) === 0 ? (
            <p className="rounded-2xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
              Todavía no has revisado a ningún médico.
            </p>
          ) : (
            <div className="space-y-4">
              {resueltos.data?.map((doctor) => (
                <FichaRevision
                  key={doctor.id}
                  doctor={doctor}
                  onSuspender={async (motivo) => {
                    await suspendDoctor(doctor.id, motivo);
                    toast.success("Perfil suspendido.");
                    await refrescar();
                  }}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <ComingSoon title="Gestión de usuarios y catálogos" phase="Fase 7 ampliada" />
        <ComingSoon title="Reportes y bitácora de auditoría" phase="Fase 7 ampliada" />
      </div>
    </>
  );
}

function Cargando() {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Cargando…
    </div>
  );
}

function FichaRevision({
  doctor,
  onAprobar,
  onRechazar,
  onSuspender,
}: {
  doctor: DoctorForReview;
  onAprobar?: () => Promise<void>;
  onRechazar?: (motivo: string) => Promise<void>;
  onSuspender?: (motivo: string) => Promise<void>;
}) {
  const [trabajando, setTrabajando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pidiendoMotivo, setPidiendoMotivo] = useState<"rechazo" | "suspension" | null>(null);

  const ejecutar = async (fn: () => Promise<void>) => {
    setTrabajando(true);
    try {
      await fn();
      setPidiendoMotivo(null);
      setMotivo("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo completar la acción.");
    } finally {
      setTrabajando(false);
    }
  };

  const consultorio = doctor.consulting_rooms[0];
  const nombre = doctor.doctor_profiles?.display_name ?? doctor.users?.full_name ?? "Sin nombre";

  const estados: Record<string, { texto: string; clase: string }> = {
    draft: { texto: "Borrador", clase: "bg-muted text-muted-foreground" },
    pending_verification: { texto: "Esperando revisión", clase: "bg-amber-500/10 text-amber-700" },
    verified: { texto: "Verificado", clase: "bg-success/10 text-success" },
    rejected: { texto: "Rechazado", clase: "bg-destructive/10 text-destructive" },
    suspended: { texto: "Suspendido", clase: "bg-destructive/10 text-destructive" },
  };
  const estado = estados[doctor.status];

  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          {doctor.doctor_profiles?.photo_url ? (
            <img
              src={doctor.doctor_profiles.photo_url}
              alt=""
              width={56}
              height={56}
              className="h-14 w-14 rounded-xl border border-border bg-primary-soft object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <Stethoscope className="h-6 w-6" />
            </div>
          )}

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-secondary">{nombre}</h3>
              <Badge variant="secondary" className={estado.clase}>
                {estado.texto}
              </Badge>
            </div>
            <p className="mt-0.5 text-sm text-primary">{doctor.specialties?.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {doctor.users?.email}
              {doctor.users?.phone && ` · ${doctor.users.phone}`}
            </p>
          </div>
        </div>

        {doctor.status === "verified" && (
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link to="/medicos/$id" params={{ id: doctor.slug }}>
              Ver perfil público
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
        )}
      </div>

      {/* Lo que hay que contrastar para validar la cédula. Se destaca porque es
          la decisión concreta que toma quien administra, no un dato más. */}
      <dl className="mt-4 grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Cédula profesional
          </dt>
          <dd className="mt-0.5 font-mono text-sm font-semibold text-secondary">
            {doctor.license_number}
          </dd>
        </div>
        {doctor.specialty_license_number && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              Cédula de especialidad
            </dt>
            <dd className="mt-0.5 font-mono text-sm text-secondary">
              {doctor.specialty_license_number}
            </dd>
          </div>
        )}
        <div>
          <dt className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
            <GraduationCap className="h-3.5 w-3.5" /> Formación
          </dt>
          <dd className="mt-0.5 text-sm text-secondary">
            {doctor.university ?? "No indicada"}
            {doctor.graduation_year && ` · ${doctor.graduation_year}`}
          </dd>
        </div>
        {consultorio && (
          <div>
            <dt className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" /> Consultorio
            </dt>
            <dd className="mt-0.5 text-sm text-secondary">
              {consultorio.address}
              {consultorio.municipalities && `, ${consultorio.municipalities.name}`}
            </dd>
          </div>
        )}
      </dl>

      {doctor.doctor_profiles?.biography && (
        <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">
          {doctor.doctor_profiles.biography}
        </p>
      )}

      {doctor.rejection_reason && (
        <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
          <span className="font-medium text-destructive">Motivo registrado:</span>{" "}
          <span className="text-muted-foreground">{doctor.rejection_reason}</span>
        </p>
      )}

      {doctor.status === "draft" && (
        <p className="mt-3 text-xs text-muted-foreground">
          Todavía no ha enviado su perfil a revisión. Aparece aquí solo para tener visibilidad;
          conviene esperar a que lo termine.
        </p>
      )}

      {pidiendoMotivo ? (
        <div className="mt-4 space-y-3 rounded-xl border border-border p-4">
          <div className="space-y-2">
            <Label htmlFor={`motivo-${doctor.id}`}>
              {pidiendoMotivo === "rechazo" ? "¿Por qué se rechaza?" : "¿Por qué se suspende?"}
            </Label>
            <Textarea
              id={`motivo-${doctor.id}`}
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="El médico verá este texto en su panel."
            />
            <p className="text-xs text-muted-foreground">
              Sé concreto: es lo único que tendrá para corregir y volver a enviarlo.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={trabajando || motivo.trim().length < 10}
              onClick={() =>
                ejecutar(() =>
                  pidiendoMotivo === "rechazo"
                    ? onRechazar!(motivo.trim())
                    : onSuspender!(motivo.trim()),
                )
              }
            >
              {trabajando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Confirmar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPidiendoMotivo(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-dashed border-border pt-4">
          {onAprobar && (
            <Button
              size="sm"
              className="gap-1.5"
              disabled={trabajando}
              onClick={() => ejecutar(onAprobar)}
            >
              {trabajando ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Verificar cédula y publicar
            </Button>
          )}
          {onRechazar && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setPidiendoMotivo("rechazo")}
            >
              <X className="h-4 w-4" />
              Rechazar
            </Button>
          )}
          {onSuspender && doctor.status === "verified" && (
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setPidiendoMotivo("suspension")}
            >
              <X className="h-4 w-4" />
              Suspender
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
