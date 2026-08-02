import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Loader2, MailCheck, Stethoscope, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { AuthShell } from "@/components/auth-shell";
import { OAuthButtons } from "@/components/oauth-buttons";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { signupSchema, translateAuthError, type SignupValues } from "@/lib/auth-schemas";

const searchSchema = z.object({
  /** Permite enlazar directo al registro de médicos desde "Soy médico". */
  rol: z.enum(["patient", "doctor"]).optional(),
});

export const Route = createFileRoute("/registro")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Crear cuenta · DoctorCita" },
      {
        name: "description",
        content: "Crea tu cuenta en DoctorCita para agendar citas médicas en Zacatecas.",
      },
    ],
  }),
  component: SignupPage,
});

function SignupPage() {
  const { rol } = Route.useSearch();
  const navigate = useNavigate();

  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState<string | null>(null);

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      password: "",
      confirmPassword: "",
      role: rol ?? "patient",
      acceptTerms: false as unknown as true,
    },
  });

  const role = form.watch("role");

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);

    const { data, error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        emailRedirectTo: `${window.location.origin}/entrar`,
        // El trigger handle_new_auth_user() lee estos metadatos para crear la
        // fila en public.users y asignar el rol. Solo acepta patient o doctor:
        // cualquier otro valor lo degrada a patient.
        data: {
          first_name: values.firstName,
          last_name: values.lastName,
          phone: values.phone || null,
          role: values.role,
        },
      },
    });

    if (error) {
      setFormError(translateAuthError(error.message));
      return;
    }

    // Con confirmación de correo activada Supabase no devuelve sesión: hay que
    // pasar por la bandeja de entrada antes de poder entrar.
    if (data.session) {
      void navigate({ to: values.role === "doctor" ? "/panel/medico" : "/panel/paciente" });
      return;
    }

    setEmailSent(values.email);
  });

  if (emailSent) {
    return (
      <AuthShell
        title="Revisa tu correo"
        subtitle={`Enviamos un enlace de confirmación a ${emailSent}.`}
      >
        <div className="rounded-2xl border border-border bg-card p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary">
            <MailCheck className="h-6 w-6" />
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Abre el enlace para activar tu cuenta. Si no aparece en unos minutos, revisa la carpeta
            de correo no deseado.
          </p>
          <Button asChild variant="outline" className="mt-6 w-full">
            <Link to="/entrar">Ir a iniciar sesión</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Crea tu cuenta"
      subtitle="Un par de datos y ya puedes agendar."
      footer={
        <>
          ¿Ya tienes cuenta?{" "}
          <Link to="/entrar" className="font-medium text-primary hover:underline">
            Inicia sesión
          </Link>
        </>
      }
    >
      <fieldset className="mb-6">
        <legend className="mb-3 text-sm font-medium text-secondary">
          ¿Cómo vas a usar DoctorCita?
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              {
                value: "patient",
                icon: User,
                title: "Soy paciente",
                desc: "Busco médico y quiero agendar.",
              },
              {
                value: "doctor",
                icon: Stethoscope,
                title: "Soy médico",
                desc: "Quiero publicar mi consultorio.",
              },
            ] as const
          ).map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex cursor-pointer gap-3 rounded-xl border p-4 transition-colors",
                role === option.value
                  ? "border-primary bg-primary-soft/50"
                  : "border-border hover:border-primary/40",
              )}
            >
              <input
                type="radio"
                value={option.value}
                className="sr-only"
                {...form.register("role")}
              />
              <option.icon
                className={cn(
                  "mt-0.5 h-5 w-5 shrink-0",
                  role === option.value ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span>
                <span className="block text-sm font-semibold text-secondary">{option.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{option.desc}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {role === "doctor" && (
        <p className="mb-6 rounded-lg border border-border bg-surface px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          Tras crear la cuenta te pediremos cédula profesional y datos del consultorio. Tu perfil no
          será público hasta que validemos la cédula.
        </p>
      )}

      <OAuthButtons />

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          o con tu correo
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {formError && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {formError}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="firstName"
            label="Nombre"
            autoComplete="given-name"
            error={form.formState.errors.firstName?.message}
            registration={form.register("firstName")}
          />
          <Field
            id="lastName"
            label="Apellidos"
            autoComplete="family-name"
            error={form.formState.errors.lastName?.message}
            registration={form.register("lastName")}
          />
        </div>

        <Field
          id="email"
          label="Correo electrónico"
          type="email"
          autoComplete="email"
          placeholder="tu@correo.com"
          error={form.formState.errors.email?.message}
          registration={form.register("email")}
        />

        <Field
          id="phone"
          label="Teléfono"
          type="tel"
          autoComplete="tel"
          placeholder="4921234567"
          hint="Opcional. Lo usamos para recordarte tus citas."
          error={form.formState.errors.phone?.message}
          registration={form.register("phone")}
        />

        <div className="space-y-2">
          <Label htmlFor="password">Contraseña</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              aria-invalid={!!form.formState.errors.password}
              aria-describedby="password-hint"
              className="pr-10"
              {...form.register("password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {form.formState.errors.password ? (
            <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
          ) : (
            <p id="password-hint" className="text-xs text-muted-foreground">
              Mínimo 8 caracteres, con al menos una letra y un número.
            </p>
          )}
        </div>

        <Field
          id="confirmPassword"
          label="Repite la contraseña"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          error={form.formState.errors.confirmPassword?.message}
          registration={form.register("confirmPassword")}
        />

        <div className="space-y-2">
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-muted-foreground">
            <Checkbox
              className="mt-0.5"
              checked={form.watch("acceptTerms") === true}
              onCheckedChange={(checked) =>
                form.setValue("acceptTerms", (checked === true) as true, {
                  shouldValidate: true,
                })
              }
            />
            <span>Acepto los términos del servicio y el aviso de privacidad de DoctorCita.</span>
          </label>
          {form.formState.errors.acceptTerms && (
            <p className="text-sm text-destructive">{form.formState.errors.acceptTerms.message}</p>
          )}
        </div>

        <Button type="submit" className="w-full" size="lg" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {form.formState.isSubmitting ? "Creando tu cuenta…" : "Crear cuenta"}
        </Button>
      </form>
    </AuthShell>
  );
}

/** Campo de texto con etiqueta, ayuda y error, para no repetir el bloque. */
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
