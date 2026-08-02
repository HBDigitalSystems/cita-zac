import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Check, Loader2, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SiteHeader } from "@/components/site-header";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/store/auth";
import {
  doctorOnboardingSchema,
  DOCTOR_STEP_FIELDS,
  WEEKDAYS,
  findOverlap,
  pesosToCents,
  type DoctorOnboardingValues,
  type ScheduleBlock,
} from "@/lib/doctor-schemas";

export const Route = createFileRoute("/onboarding/medico")({
  head: () => ({
    meta: [
      { title: "Completa tu perfil profesional · DoctorCita" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DoctorOnboarding,
});

const DRAFT_KEY = "doctorcita.borrador-medico";

const STEPS = [
  { title: "Tus credenciales", description: "Lo que validamos antes de publicarte." },
  { title: "Tu perfil público", description: "Lo que verá un paciente al encontrarte." },
  { title: "Tu consultorio", description: "Dónde atiendes." },
  { title: "Tus horarios", description: "Cuándo atiendes. De aquí salen los huecos reservables." },
] as const;

/** Horario por defecto: de lunes a viernes, mañana. Se edita a gusto. */
const DEFAULT_SCHEDULE: ScheduleBlock[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startTime: "09:00",
  endTime: "14:00",
}));

type Catalog = { id: number; name: string }[];

function DoctorOnboarding() {
  const navigate = useNavigate();
  const { status, user, roles, rolesLoaded } = useAuth();

  const [step, setStep] = useState(0);
  const [schedule, setSchedule] = useState<ScheduleBlock[]>(DEFAULT_SCHEDULE);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [specialties, setSpecialties] = useState<Catalog>([]);
  const [municipalities, setMunicipalities] = useState<Catalog>([]);

  const headingRef = useRef<HTMLHeadingElement>(null);

  const form = useForm<DoctorOnboardingValues>({
    resolver: zodResolver(doctorOnboardingSchema),
    mode: "onTouched",
    defaultValues: {
      licenseNumber: "",
      specialtyLicenseNumber: "",
      primarySpecialtyId: undefined as unknown as number,
      university: "",
      graduationYear: "",
      yearsOfExperience: "",
      gender: "prefer_not_to_say",
      headline: "",
      biography: "",
      priceInPerson: "",
      priceVideo: "",
      priceFollowUp: "",
      acceptsNewPatients: true,
      offersTelemedicine: false,
      offersEmergency: false,
      cancellationHours: "24",
      roomName: "Consultorio principal",
      municipalityId: undefined as unknown as number,
      address: "",
      addressDetails: "",
      roomPhone: "",
      postalCode: "",
      slotDuration: 30,
      hasParking: false,
      isAccessible: false,
    },
  });

  // Los catálogos vienen de la base de datos, no de constantes del cliente: los
  // identificadores tienen que ser los reales o las claves foráneas fallarían.
  useEffect(() => {
    void (async () => {
      const [esp, mun] = await Promise.all([
        supabase.from("specialties").select("id,name").order("display_order").order("name"),
        supabase.from("municipalities").select("id,name").order("name"),
      ]);
      if (esp.data) setSpecialties(esp.data);
      if (mun.data) setMunicipalities(mun.data);
    })();
  }, []);

  // Borrador local, por lo mismo que en el alta de pacientes: son varios pasos
  // y nadie debería reescribirlos por una recarga o un token caducado.
  useEffect(() => {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as {
        step?: number;
        values?: DoctorOnboardingValues;
        schedule?: ScheduleBlock[];
      };
      if (draft.values) form.reset(draft.values);
      if (draft.schedule?.length) setSchedule(draft.schedule);
      if (typeof draft.step === "number") setStep(Math.min(draft.step, STEPS.length - 1));
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const subscription = form.watch((values) => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, values, schedule }));
    });
    return () => subscription.unsubscribe();
  }, [form, step, schedule]);

  const goToStep = (next: number) => {
    setStep(next);
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const handleNext = async () => {
    const valid = await form.trigger([...DOCTOR_STEP_FIELDS[step]]);
    if (valid) goToStep(step + 1);
  };

  const scheduleError = findOverlap(schedule);

  const handleSave = async () => {
    if (!user) return;
    if (scheduleError) return;
    if (schedule.length === 0) {
      setSaveError("Añade al menos un bloque de horario para poder recibir citas.");
      return;
    }

    setSaving(true);
    setSaveError(null);
    const values = form.getValues();

    try {
      // El guardado es idempotente a propósito: son cinco escrituras seguidas
      // sin transacción desde el cliente, y si una falla a mitad hay que poder
      // reintentar sin duplicar nada ni quedarse a medias.
      const { data: doctor, error: doctorError } = await supabase
        .from("doctors")
        .upsert(
          {
            user_id: user.id,
            license_number: values.licenseNumber,
            specialty_license_number: values.specialtyLicenseNumber || null,
            primary_specialty_id: values.primarySpecialtyId,
            university: values.university || null,
            graduation_year: values.graduationYear ? Number(values.graduationYear) : null,
            years_of_experience: values.yearsOfExperience ? Number(values.yearsOfExperience) : null,
            gender: values.gender,
          },
          { onConflict: "user_id" },
        )
        .select("id")
        .single();

      if (doctorError) throw doctorError;

      const doctorId = doctor.id;

      const { error: profileError } = await supabase.from("doctor_profiles").upsert(
        {
          doctor_id: doctorId,
          headline: values.headline || null,
          biography: values.biography,
          price_in_person_cents: pesosToCents(values.priceInPerson),
          price_video_cents: values.offersTelemedicine ? pesosToCents(values.priceVideo) : null,
          price_follow_up_cents: pesosToCents(values.priceFollowUp),
          accepts_new_patients: values.acceptsNewPatients,
          offers_telemedicine: values.offersTelemedicine,
          offers_emergency: values.offersEmergency,
          cancellation_hours: Number(values.cancellationHours || 24),
        },
        { onConflict: "doctor_id" },
      );
      if (profileError) throw profileError;

      const { error: specialtyError } = await supabase
        .from("doctor_specialties")
        .upsert(
          { doctor_id: doctorId, specialty_id: values.primarySpecialtyId },
          { onConflict: "doctor_id,specialty_id" },
        );
      if (specialtyError) throw specialtyError;

      // Un solo consultorio en esta fase. Se reutiliza el principal si ya existe
      // para no crear duplicados al reintentar.
      const { data: existingRoom } = await supabase
        .from("consulting_rooms")
        .select("id")
        .eq("doctor_id", doctorId)
        .eq("is_primary", true)
        .maybeSingle();

      const roomPayload = {
        doctor_id: doctorId,
        name: values.roomName,
        municipality_id: values.municipalityId,
        address: values.address,
        address_details: values.addressDetails || null,
        phone: values.roomPhone || null,
        postal_code: values.postalCode || null,
        slot_duration_minutes: values.slotDuration,
        is_primary: true,
      };

      const roomResult = existingRoom
        ? await supabase
            .from("consulting_rooms")
            .update({
              ...roomPayload,
              has_parking: values.hasParking,
              is_accessible: values.isAccessible,
            })
            .eq("id", existingRoom.id)
            .select("id")
            .single()
        : await supabase
            .from("consulting_rooms")
            .insert({
              ...roomPayload,
              has_parking: values.hasParking,
              is_accessible: values.isAccessible,
            })
            .select("id")
            .single();

      if (roomResult.error) throw roomResult.error;
      const roomId = roomResult.data.id;

      // Los horarios se reemplazan en bloque: es más simple y más predecible que
      // calcular qué bloque cambió, y la restricción EXCLUDE de la tabla
      // rechazaría un estado intermedio con solapamientos.
      const { error: deleteError } = await supabase
        .from("working_hours")
        .delete()
        .eq("consulting_room_id", roomId);
      if (deleteError) throw deleteError;

      const { error: hoursError } = await supabase.from("working_hours").insert(
        schedule.map((block) => ({
          consulting_room_id: roomId,
          weekday: block.weekday,
          start_time: block.startTime,
          end_time: block.endTime,
          allows_in_person: true,
          allows_video: values.offersTelemedicine,
        })),
      );
      if (hoursError) throw hoursError;

      // Enviar a revisión. El trigger de la base de datos solo permite este
      // salto concreto; el médico no puede verificarse a sí mismo.
      await supabase
        .from("doctors")
        .update({ status: "pending_verification" })
        .eq("id", doctorId)
        .in("status", ["draft", "rejected"]);

      localStorage.removeItem(DRAFT_KEY);
      toast.success("Perfil enviado a revisión.");
      void navigate({ to: "/panel/medico", replace: true });
    } catch (error) {
      const err = error as { code?: string; message?: string };

      if (err.code === "23505" && err.message?.includes("license_number")) {
        setSaveError("Esa cédula profesional ya está registrada por otra cuenta.");
      } else if (err.code === "42501") {
        setSaveError(
          "No tienes permiso para guardar estos datos. Suele ocurrir si la sesión " +
            "caducó: vuelve a iniciar sesión e inténtalo de nuevo.",
        );
      } else if (err.code === "23503") {
        setSaveError(
          "Tu cuenta se creó pero le falta la ficha de usuario. Cierra sesión, " +
            "vuelve a entrar y reinténtalo.",
        );
      } else {
        setSaveError(err.message ?? "No pudimos guardar tu perfil.");
      }
    } finally {
      setSaving(false);
    }
  };

  if (status === "loading" || !rolesLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Comprobando tu sesión…
        </div>
      </div>
    );
  }

  if (status === "anonymous") {
    return (
      <RecoveryPanel
        title="Tu sesión se cerró"
        body="No has perdido nada: lo que llevabas escrito quedó guardado en este navegador."
      />
    );
  }

  if (!roles.includes("doctor")) {
    return (
      <RecoveryPanel
        title="Esta sección es para médicos"
        body="Tu cuenta no tiene el rol de médico. Si te registraste como paciente, crea una cuenta profesional o escríbenos para cambiar tu rol."
        linkTo="/panel"
        linkLabel="Ir a mi panel"
      />
    );
  }

  const isLastStep = step === STEPS.length - 1;

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <SiteHeader />

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6">
        <ol className="mb-8 flex items-center gap-2" aria-label="Progreso del registro">
          {STEPS.map((item, index) => (
            <li key={item.title} className="flex flex-1 items-center gap-2">
              <span
                aria-current={index === step ? "step" : undefined}
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                  index < step && "bg-success text-white",
                  index === step && "bg-primary text-primary-foreground",
                  index > step && "bg-muted text-muted-foreground",
                )}
              >
                {index < step ? <Check className="h-4 w-4" /> : index + 1}
              </span>
              {index < STEPS.length - 1 && (
                <span
                  className={cn(
                    "h-px flex-1 transition-colors",
                    index < step ? "bg-success" : "bg-border",
                  )}
                />
              )}
            </li>
          ))}
        </ol>

        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-semibold tracking-tight text-secondary outline-none sm:text-3xl"
        >
          {STEPS[step].title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{STEPS[step].description}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Paso {step + 1} de {STEPS.length}
        </p>

        {saveError && (
          <p
            role="alert"
            className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {saveError}
          </p>
        )}

        <div className="mt-8 space-y-5">
          {step === 0 && (
            <>
              <Field
                id="licenseNumber"
                label="Cédula profesional"
                placeholder="12345678"
                hint="La que aparece en tu título. Se valida antes de publicar tu perfil."
                error={form.formState.errors.licenseNumber?.message}
                registration={form.register("licenseNumber")}
              />

              <div className="space-y-2">
                <Label htmlFor="primarySpecialtyId">Especialidad principal</Label>
                <Select
                  value={form.watch("primarySpecialtyId")?.toString() ?? ""}
                  onValueChange={(v) =>
                    form.setValue("primarySpecialtyId", Number(v), { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="primarySpecialtyId">
                    <SelectValue
                      placeholder={specialties.length ? "Elige tu especialidad" : "Cargando…"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {specialties.map((s) => (
                      <SelectItem key={s.id} value={s.id.toString()}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.primarySpecialtyId && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.primarySpecialtyId.message}
                  </p>
                )}
              </div>

              <Field
                id="specialtyLicenseNumber"
                label="Cédula de especialidad"
                hint="Opcional, si tienes una distinta a la profesional."
                error={form.formState.errors.specialtyLicenseNumber?.message}
                registration={form.register("specialtyLicenseNumber")}
              />

              <Field
                id="university"
                label="Universidad"
                placeholder="Universidad Autónoma de Zacatecas"
                registration={form.register("university")}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="graduationYear"
                  label="Año de titulación"
                  inputMode="numeric"
                  placeholder="2012"
                  error={form.formState.errors.graduationYear?.message}
                  registration={form.register("graduationYear")}
                />
                <Field
                  id="yearsOfExperience"
                  label="Años de experiencia"
                  inputMode="numeric"
                  placeholder="12"
                  error={form.formState.errors.yearsOfExperience?.message}
                  registration={form.register("yearsOfExperience")}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="gender">Sexo</Label>
                <Select
                  value={form.watch("gender")}
                  onValueChange={(v) =>
                    form.setValue("gender", v as DoctorOnboardingValues["gender"])
                  }
                >
                  <SelectTrigger id="gender">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="female">Mujer</SelectItem>
                    <SelectItem value="male">Hombre</SelectItem>
                    <SelectItem value="other">Otro</SelectItem>
                    <SelectItem value="prefer_not_to_say">Prefiero no decirlo</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Se usa para el trato (Dr. / Dra.) y para el filtro de preferencia del paciente.
                </p>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <Field
                id="headline"
                label="Titular"
                placeholder="Cardióloga intervencionista en Zacatecas"
                hint="Una línea. Aparece bajo tu nombre en el buscador."
                error={form.formState.errors.headline?.message}
                registration={form.register("headline")}
              />

              <div className="space-y-2">
                <Label htmlFor="biography">Biografía</Label>
                <Textarea
                  id="biography"
                  rows={6}
                  placeholder="Cómo trabajas, qué puede esperar un paciente de tu consulta…"
                  aria-invalid={!!form.formState.errors.biography}
                  {...form.register("biography")}
                />
                {form.formState.errors.biography ? (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.biography.message}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {form.watch("biography")?.length ?? 0} caracteres. Mínimo 40.
                  </p>
                )}
              </div>

              <fieldset className="space-y-4 rounded-xl border border-border p-4">
                <legend className="px-1 text-sm font-medium text-secondary">
                  Precios de consulta
                </legend>
                <p className="text-xs text-muted-foreground">
                  En pesos. Déjalo vacío si prefieres no publicarlo.
                </p>

                <div className="grid gap-4 sm:grid-cols-3">
                  <Field
                    id="priceInPerson"
                    label="Presencial"
                    inputMode="numeric"
                    placeholder="800"
                    error={form.formState.errors.priceInPerson?.message}
                    registration={form.register("priceInPerson")}
                  />
                  <Field
                    id="priceVideo"
                    label="Videoconsulta"
                    inputMode="numeric"
                    placeholder="600"
                    error={form.formState.errors.priceVideo?.message}
                    registration={form.register("priceVideo")}
                  />
                  <Field
                    id="priceFollowUp"
                    label="Seguimiento"
                    inputMode="numeric"
                    placeholder="500"
                    error={form.formState.errors.priceFollowUp?.message}
                    registration={form.register("priceFollowUp")}
                  />
                </div>
              </fieldset>

              <fieldset className="space-y-3 rounded-xl border border-border p-4">
                <legend className="px-1 text-sm font-medium text-secondary">Cómo atiendes</legend>
                <Toggle
                  label="Acepto nuevos pacientes"
                  checked={form.watch("acceptsNewPatients")}
                  onChange={(v) => form.setValue("acceptsNewPatients", v)}
                />
                <Toggle
                  label="Ofrezco videoconsulta"
                  checked={form.watch("offersTelemedicine")}
                  onChange={(v) => form.setValue("offersTelemedicine", v)}
                />
                <Toggle
                  label="Atiendo urgencias"
                  checked={form.watch("offersEmergency")}
                  onChange={(v) => form.setValue("offersEmergency", v)}
                />
              </fieldset>

              <Field
                id="cancellationHours"
                label="Horas de antelación para cancelar sin costo"
                inputMode="numeric"
                placeholder="24"
                error={form.formState.errors.cancellationHours?.message}
                registration={form.register("cancellationHours")}
              />
            </>
          )}

          {step === 2 && (
            <>
              <Field
                id="roomName"
                label="Nombre del consultorio"
                error={form.formState.errors.roomName?.message}
                registration={form.register("roomName")}
              />

              <div className="space-y-2">
                <Label htmlFor="municipalityId">Municipio</Label>
                <Select
                  value={form.watch("municipalityId")?.toString() ?? ""}
                  onValueChange={(v) =>
                    form.setValue("municipalityId", Number(v), { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="municipalityId">
                    <SelectValue
                      placeholder={municipalities.length ? "Elige el municipio" : "Cargando…"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {municipalities.map((m) => (
                      <SelectItem key={m.id} value={m.id.toString()}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.formState.errors.municipalityId && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.municipalityId.message}
                  </p>
                )}
              </div>

              <Field
                id="address"
                label="Dirección"
                placeholder="Av. Hidalgo 123, Col. Centro"
                error={form.formState.errors.address?.message}
                registration={form.register("address")}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="addressDetails"
                  label="Piso o interior"
                  placeholder="Piso 3, consultorio 12"
                  registration={form.register("addressDetails")}
                />
                <Field
                  id="postalCode"
                  label="Código postal"
                  inputMode="numeric"
                  placeholder="98000"
                  error={form.formState.errors.postalCode?.message}
                  registration={form.register("postalCode")}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  id="roomPhone"
                  label="Teléfono del consultorio"
                  type="tel"
                  placeholder="4921234567"
                  error={form.formState.errors.roomPhone?.message}
                  registration={form.register("roomPhone")}
                />
                <div className="space-y-2">
                  <Label htmlFor="slotDuration">Duración de cada cita</Label>
                  <Select
                    value={form.watch("slotDuration")?.toString()}
                    onValueChange={(v) => form.setValue("slotDuration", Number(v))}
                  >
                    <SelectTrigger id="slotDuration">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[15, 20, 30, 45, 60].map((m) => (
                        <SelectItem key={m} value={m.toString()}>
                          {m} minutos
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <fieldset className="space-y-3 rounded-xl border border-border p-4">
                <legend className="px-1 text-sm font-medium text-secondary">Instalaciones</legend>
                <Toggle
                  label="Hay estacionamiento"
                  checked={form.watch("hasParking")}
                  onChange={(v) => form.setValue("hasParking", v)}
                />
                <Toggle
                  label="Accesible en silla de ruedas"
                  checked={form.watch("isAccessible")}
                  onChange={(v) => form.setValue("isAccessible", v)}
                />
              </fieldset>
            </>
          )}

          {step === 3 && (
            <ScheduleEditor
              schedule={schedule}
              onChange={setSchedule}
              error={scheduleError}
              slotDuration={form.watch("slotDuration")}
            />
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border pt-6">
            {step > 0 ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => goToStep(step - 1)}
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Atrás
              </Button>
            ) : (
              <span />
            )}

            {isLastStep ? (
              <Button
                type="button"
                size="lg"
                onClick={handleSave}
                disabled={saving || !!scheduleError}
                className="gap-2"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? "Guardando…" : "Enviar a revisión"}
              </Button>
            ) : (
              <Button type="button" size="lg" onClick={handleNext} className="gap-2">
                Continuar
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/** Editor de horario semanal: varios bloques por día. */
function ScheduleEditor({
  schedule,
  onChange,
  error,
  slotDuration,
}: {
  schedule: ScheduleBlock[];
  onChange: (blocks: ScheduleBlock[]) => void;
  error: string | null;
  slotDuration: number;
}) {
  const addBlock = (weekday: number) => {
    onChange([...schedule, { weekday, startTime: "16:00", endTime: "20:00" }]);
  };

  const removeBlock = (index: number) => {
    onChange(schedule.filter((_, i) => i !== index));
  };

  const updateBlock = (index: number, patch: Partial<ScheduleBlock>) => {
    onChange(schedule.map((block, i) => (i === index ? { ...block, ...patch } : block)));
  };

  // Cuántas citas caben, para que el médico vea la consecuencia de su horario.
  const totalSlots = schedule.reduce((sum, block) => {
    const [sh, sm] = block.startTime.split(":").map(Number);
    const [eh, em] = block.endTime.split(":").map(Number);
    const minutes = eh * 60 + em - (sh * 60 + sm);
    return sum + Math.max(0, Math.floor(minutes / slotDuration));
  }, 0);

  return (
    <div className="space-y-5">
      {error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      {WEEKDAYS.map((day) => {
        const blocks = schedule
          .map((block, index) => ({ block, index }))
          .filter(({ block }) => block.weekday === day.value);

        return (
          <div key={day.value} className="rounded-xl border border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-secondary">{day.label}</h2>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => addBlock(day.value)}
                className="gap-1.5 text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                Añadir bloque
              </Button>
            </div>

            {blocks.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No atiendo este día.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {blocks.map(({ block, index }) => (
                  <li key={index} className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={block.startTime}
                      onChange={(e) => updateBlock(index, { startTime: e.target.value })}
                      aria-label={`Hora de inicio del ${day.label.toLowerCase()}`}
                      className="w-32"
                    />
                    <span className="text-muted-foreground">a</span>
                    <Input
                      type="time"
                      value={block.endTime}
                      onChange={(e) => updateBlock(index, { endTime: e.target.value })}
                      aria-label={`Hora de fin del ${day.label.toLowerCase()}`}
                      className="w-32"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeBlock(index)}
                      aria-label={`Quitar este bloque del ${day.label.toLowerCase()}`}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      <p className="rounded-lg bg-primary-soft/50 px-4 py-3 text-sm text-secondary">
        Con este horario y citas de {slotDuration} minutos, ofreces{" "}
        <strong>{totalSlots} citas por semana</strong>.
      </p>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-foreground">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

function RecoveryPanel({
  title,
  body,
  linkTo = "/entrar",
  linkLabel = "Iniciar sesión y continuar",
}: {
  title: string;
  body: string;
  linkTo?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <div className="rounded-2xl border border-border bg-card p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
            <TriangleAlert className="h-6 w-6" />
          </div>
          <h1 className="mt-4 text-lg font-semibold text-secondary">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
          <Button asChild className="mt-6 w-full">
            <Link to={linkTo}>{linkLabel}</Link>
          </Button>
        </div>
      </main>
    </div>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  registration,
  ...inputProps
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  registration: ReturnType<ReturnType<typeof useForm>["register"]>;
} & React.ComponentProps<typeof Input>) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        aria-invalid={!!error}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...inputProps}
        {...registration}
      />
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
