import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Check, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { useQuery } from "@tanstack/react-query";
import { getInsuranceCompanies, getMunicipalities } from "@/services/catalogs";
import {
  patientOnboardingSchema,
  STEP_FIELDS,
  BLOOD_TYPES,
  GENDERS,
  toList,
  type PatientOnboardingValues,
} from "@/lib/patient-schemas";

export const Route = createFileRoute("/onboarding/paciente")({
  head: () => ({
    meta: [{ title: "Completa tu perfil · DoctorCita" }, { name: "robots", content: "noindex" }],
  }),
  component: PatientOnboarding,
});

/** Dónde se guarda el borrador mientras el paciente rellena los pasos. */
const DRAFT_KEY = "doctorcita.borrador-paciente";

const STEPS = [
  { title: "Sobre ti", description: "Datos básicos para tu expediente." },
  { title: "Dónde vives", description: "Para mostrarte médicos cerca." },
  { title: "Tu salud", description: "Lo que un médico debe saber antes de atenderte." },
  { title: "En caso de urgencia", description: "A quién avisamos y con qué seguro cuentas." },
] as const;

function PatientOnboarding() {
  const navigate = useNavigate();
  const { status, user } = useAuth();

  const [step, setStep] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [schemaMissing, setSchemaMissing] = useState(false);

  const headingRef = useRef<HTMLHeadingElement>(null);

  // Los catálogos vienen de la base de datos: los identificadores tienen que ser
  // los reales o fallarían las claves foráneas al guardar.
  const municipalities = useQuery({
    queryKey: ["municipalities"],
    queryFn: getMunicipalities,
    staleTime: 1000 * 60 * 60,
  });
  const insurances = useQuery({
    queryKey: ["insurance-companies"],
    queryFn: getInsuranceCompanies,
    staleTime: 1000 * 60 * 60,
  });

  const form = useForm<PatientOnboardingValues>({
    resolver: zodResolver(patientOnboardingSchema),
    mode: "onTouched",
    defaultValues: {
      birthDate: "",
      gender: "prefer_not_to_say",
      curp: "",
      municipalityId: undefined as unknown as number,
      address: "",
      postalCode: "",
      bloodType: "",
      allergies: "",
      chronicConditions: "",
      currentMedications: "",
      emergencyContactName: "",
      emergencyContactPhone: "",
      emergencyContactRelationship: "",
      insuranceCompanyId: "",
      insurancePolicyNumber: "",
    },
  });

  // Borrador local. Rellenar cuatro pasos lleva minutos, y en ese rato puede
  // caducar la sesión, recargarse la página o irse la conexión. Nada de eso
  // debería costarle al paciente volver a escribir sus alergias.
  useEffect(() => {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as { step?: number; values?: PatientOnboardingValues };
      if (draft.values) form.reset(draft.values);
      if (typeof draft.step === "number") setStep(Math.min(draft.step, STEPS.length - 1));
    } catch {
      // Borrador ilegible (versión vieja del formulario): se descarta y punto.
      localStorage.removeItem(DRAFT_KEY);
    }
    // Solo al montar: después mandan los cambios del propio formulario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const subscription = form.watch((values) => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, values }));
    });
    return () => subscription.unsubscribe();
  }, [form, step]);

  const goToStep = (next: number) => {
    setStep(next);
    // Al cambiar de paso el foco vuelve al título: sin esto, quien navega con
    // teclado o lector de pantalla se queda en el botón y no se entera de que
    // el contenido cambió.
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const handleNext = async () => {
    const valid = await form.trigger([...STEP_FIELDS[step]]);
    if (valid) goToStep(step + 1);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setSaveError(null);
    setSchemaMissing(false);

    if (!user) {
      setSaveError("Tu sesión caducó. Vuelve a iniciar sesión.");
      return;
    }

    const { error } = await supabase.from("patients").insert({
      user_id: user.id,
      birth_date: values.birthDate,
      gender: values.gender,
      curp: values.curp || null,
      municipality_id: values.municipalityId,
      address: values.address || null,
      postal_code: values.postalCode || null,
      blood_type: values.bloodType || null,
      allergies: toList(values.allergies),
      chronic_conditions: toList(values.chronicConditions),
      current_medications: toList(values.currentMedications),
      emergency_contact_name: values.emergencyContactName || null,
      emergency_contact_phone: values.emergencyContactPhone || null,
      emergency_contact_relationship: values.emergencyContactRelationship || null,
      insurance_company_id: values.insuranceCompanyId ? Number(values.insuranceCompanyId) : null,
      insurance_policy_number: values.insurancePolicyNumber || null,
      accepted_terms_at: new Date().toISOString(),
      accepted_privacy_at: new Date().toISOString(),
    });

    if (error) {
      // La tabla no existe: faltan las migraciones de la Fase 1.
      if (error.code === "42P01" || error.code === "PGRST205") {
        setSchemaMissing(true);
        return;
      }
      // 23505 = clave única duplicada; ya había un perfil para este usuario.
      if (error.code === "23505") {
        localStorage.removeItem(DRAFT_KEY);
        toast.success("Tu perfil ya estaba completo.");
        void navigate({ to: "/panel/paciente", replace: true });
        return;
      }

      // 23503 = clave foránea rota. En la práctica significa que no existe la
      // fila de este usuario en public.users, es decir, que el trigger de alta
      // no llegó a ejecutarse al registrarse.
      if (error.code === "23503") {
        setSaveError(
          "Tu cuenta se creó, pero su ficha de usuario no. Cierra sesión, vuelve " +
            "a entrar y reinténtalo; si sigue igual, el registro habrá que " +
            "repararlo desde la base de datos.",
        );
        return;
      }

      // 42501 = el RLS rechazó la escritura.
      if (error.code === "42501") {
        setSaveError(
          "No tienes permiso para guardar este perfil. Suele pasar si la sesión " +
            "caducó a mitad del formulario: vuelve a iniciar sesión e inténtalo.",
        );
        return;
      }

      setSaveError(error.message);
      return;
    }

    localStorage.removeItem(DRAFT_KEY);
    toast.success("Perfil completado.");
    void navigate({ to: "/panel/paciente", replace: true });
  });

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Comprobando tu sesión…
        </div>
      </div>
    );
  }

  // Sin sesión NO se redirige: eso vaciaba la pantalla y daba la sensación de
  // haber perdido todo. Se avisa aquí mismo, dejando claro que el borrador
  // sigue guardado, y se vuelve a este punto exacto tras iniciar sesión.
  if (status === "anonymous") {
    return (
      <div className="flex min-h-screen flex-col bg-surface">
        <SiteHeader />
        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
          <div className="rounded-2xl border border-border bg-card p-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
              <TriangleAlert className="h-6 w-6" />
            </div>
            <h1 className="mt-4 text-lg font-semibold text-secondary">Tu sesión se cerró</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              <strong className="text-foreground">No has perdido nada.</strong> Lo que llevabas
              escrito quedó guardado en este navegador y vuelve a aparecer en cuanto inicies sesión
              de nuevo.
            </p>
            <Button asChild className="mt-6 w-full">
              <Link to="/entrar" search={{ redirect: "/onboarding/paciente" }}>
                Iniciar sesión y continuar
              </Link>
            </Button>
          </div>
        </main>
      </div>
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

        {schemaMissing && (
          <div
            role="alert"
            className="mt-6 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4"
          >
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="text-sm">
              <p className="font-medium text-secondary">
                La base de datos todavía no tiene la tabla de pacientes
              </p>
              <p className="mt-1 text-muted-foreground">
                Faltan las migraciones de la Fase 1. Aplica{" "}
                <code className="font-mono text-xs">supabase/migrations-bundle.sql</code> en el
                editor SQL de Supabase y vuelve a intentarlo. Tus respuestas no se han perdido.
              </p>
            </div>
          </div>
        )}

        {saveError && (
          <p
            role="alert"
            className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {saveError}
          </p>
        )}

        <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
          {step === 0 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="birthDate">Fecha de nacimiento</Label>
                <Input
                  id="birthDate"
                  type="date"
                  max={new Date().toISOString().slice(0, 10)}
                  aria-invalid={!!form.formState.errors.birthDate}
                  {...form.register("birthDate")}
                />
                {form.formState.errors.birthDate && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.birthDate.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="gender">Sexo</Label>
                <Select
                  value={form.watch("gender")}
                  onValueChange={(value) =>
                    form.setValue("gender", value as PatientOnboardingValues["gender"], {
                      shouldValidate: true,
                    })
                  }
                >
                  <SelectTrigger id="gender">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GENDERS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="curp">CURP</Label>
                <Input
                  id="curp"
                  placeholder="HEGA850315HZSRRL09"
                  maxLength={18}
                  className="uppercase"
                  aria-invalid={!!form.formState.errors.curp}
                  aria-describedby="curp-hint"
                  {...form.register("curp")}
                />
                {form.formState.errors.curp ? (
                  <p className="text-sm text-destructive">{form.formState.errors.curp.message}</p>
                ) : (
                  <p id="curp-hint" className="text-xs text-muted-foreground">
                    Opcional. Solo se usa para tus recetas y comprobantes.
                  </p>
                )}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="municipalityId">Municipio</Label>
                <Select
                  value={form.watch("municipalityId")?.toString() ?? ""}
                  onValueChange={(value) =>
                    form.setValue("municipalityId", Number(value), { shouldValidate: true })
                  }
                >
                  <SelectTrigger
                    id="municipalityId"
                    aria-invalid={!!form.formState.errors.municipalityId}
                  >
                    <SelectValue placeholder="Elige tu municipio" />
                  </SelectTrigger>
                  <SelectContent>
                    {(municipalities.data ?? []).map((municipality) => (
                      <SelectItem key={municipality.id} value={municipality.id.toString()}>
                        {municipality.name}
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

              <div className="space-y-2">
                <Label htmlFor="address">Dirección</Label>
                <Input
                  id="address"
                  placeholder="Calle, número y colonia"
                  autoComplete="street-address"
                  {...form.register("address")}
                />
                <p className="text-xs text-muted-foreground">Opcional.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="postalCode">Código postal</Label>
                <Input
                  id="postalCode"
                  inputMode="numeric"
                  maxLength={5}
                  placeholder="98000"
                  autoComplete="postal-code"
                  aria-invalid={!!form.formState.errors.postalCode}
                  {...form.register("postalCode")}
                />
                {form.formState.errors.postalCode && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.postalCode.message}
                  </p>
                )}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="bloodType">Tipo de sangre</Label>
                <Select
                  value={form.watch("bloodType") || "desconocido"}
                  onValueChange={(value) =>
                    form.setValue(
                      "bloodType",
                      (value === "desconocido"
                        ? ""
                        : value) as PatientOnboardingValues["bloodType"],
                    )
                  }
                >
                  <SelectTrigger id="bloodType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desconocido">No lo sé</SelectItem>
                    {BLOOD_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <ListField
                id="allergies"
                label="Alergias"
                placeholder="Penicilina, polen, mariscos"
                registration={form.register("allergies")}
              />
              <ListField
                id="chronicConditions"
                label="Padecimientos crónicos"
                placeholder="Diabetes tipo 2, hipertensión"
                registration={form.register("chronicConditions")}
              />
              <ListField
                id="currentMedications"
                label="Medicamentos que tomas"
                placeholder="Metformina 850 mg, losartán 50 mg"
                registration={form.register("currentMedications")}
              />
            </>
          )}

          {step === 3 && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="emergencyContactName">Nombre del contacto</Label>
                  <Input id="emergencyContactName" {...form.register("emergencyContactName")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="emergencyContactRelationship">Parentesco</Label>
                  <Input
                    id="emergencyContactRelationship"
                    placeholder="Madre, esposo, hermana…"
                    {...form.register("emergencyContactRelationship")}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="emergencyContactPhone">Teléfono del contacto</Label>
                <Input
                  id="emergencyContactPhone"
                  type="tel"
                  placeholder="4921234567"
                  aria-invalid={!!form.formState.errors.emergencyContactPhone}
                  {...form.register("emergencyContactPhone")}
                />
                {form.formState.errors.emergencyContactPhone && (
                  <p className="text-sm text-destructive">
                    {form.formState.errors.emergencyContactPhone.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="insuranceCompanyId">Aseguradora</Label>
                <Select
                  value={form.watch("insuranceCompanyId") || "ninguna"}
                  onValueChange={(value) =>
                    form.setValue("insuranceCompanyId", value === "ninguna" ? "" : value)
                  }
                >
                  <SelectTrigger id="insuranceCompanyId">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ninguna">Sin seguro médico</SelectItem>
                    {(insurances.data ?? []).map((insurance) => (
                      <SelectItem key={insurance.id} value={insurance.id.toString()}>
                        {insurance.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="insurancePolicyNumber">Número de póliza</Label>
                <Input id="insurancePolicyNumber" {...form.register("insurancePolicyNumber")} />
                <p className="text-xs text-muted-foreground">Opcional.</p>
              </div>
            </>
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
                type="submit"
                size="lg"
                disabled={form.formState.isSubmitting}
                className="gap-2"
              >
                {form.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {form.formState.isSubmitting ? "Guardando…" : "Terminar"}
              </Button>
            ) : (
              <Button type="button" size="lg" onClick={handleNext} className="gap-2">
                Continuar
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </form>
      </main>
    </div>
  );
}

/** Campo de texto libre que la base de datos guarda como lista. */
function ListField({
  id,
  label,
  placeholder,
  registration,
}: {
  id: string;
  label: string;
  placeholder: string;
  registration: ReturnType<ReturnType<typeof useForm>["register"]>;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        rows={2}
        placeholder={placeholder}
        aria-describedby={`${id}-hint`}
        {...registration}
      />
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        Sepáralos con comas. Déjalo vacío si no aplica.
      </p>
    </div>
  );
}
