import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { AuthShell } from "@/components/auth-shell";
import { OAuthButtons } from "@/components/oauth-buttons";
import { supabase } from "@/integrations/supabase/client";
import { loginSchema, translateAuthError, type LoginValues } from "@/lib/auth-schemas";
import { panelPathForRoles, setRememberMe, useAuth } from "@/store/auth";

const searchSchema = z.object({
  /** A dónde volver tras iniciar sesión, si se llegó desde una ruta protegida. */
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/entrar")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [{ title: "Iniciar sesión · DoctorCita" }, { name: "robots", content: "noindex" }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const { status, roles, rolesLoaded } = useAuth();

  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "", rememberMe: true },
  });

  // Quien ya tiene sesión no debería ver esta pantalla. Se espera a que los
  // roles estén resueltos, o un médico acabaría en el panel de paciente por
  // haber llegado la redirección antes que su rol.
  useEffect(() => {
    if (status === "authenticated" && rolesLoaded) {
      void navigate({ to: redirect ?? panelPathForRoles(roles), replace: true });
    }
  }, [status, roles, rolesLoaded, redirect, navigate]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    setRememberMe(values.rememberMe);

    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });

    if (error) {
      setFormError(translateAuthError(error.message));
      return;
    }
    // La redirección la dispara el efecto de arriba en cuanto la sesión llega.
  });

  const submitting = form.formState.isSubmitting;

  return (
    <AuthShell
      title="Inicia sesión"
      subtitle="Accede a tus citas, tu historial y tus médicos guardados."
      footer={
        <>
          ¿Todavía no tienes cuenta?{" "}
          <Link to="/registro" className="font-medium text-primary hover:underline">
            Crear una cuenta
          </Link>
        </>
      }
    >
      <OAuthButtons redirectTo={redirect} />

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

        <div className="space-y-2">
          <Label htmlFor="email">Correo electrónico</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="tu@correo.com"
            aria-invalid={!!form.formState.errors.email}
            {...form.register("email")}
          />
          {form.formState.errors.email && (
            <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Contraseña</Label>
            <Link to="/recuperar" className="text-xs font-medium text-primary hover:underline">
              ¿La olvidaste?
            </Link>
          </div>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              aria-invalid={!!form.formState.errors.password}
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
          {form.formState.errors.password && (
            <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
          )}
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={form.watch("rememberMe")}
            onCheckedChange={(checked) => form.setValue("rememberMe", checked === true)}
          />
          Mantener la sesión iniciada
        </label>

        <Button type="submit" className="w-full" size="lg" disabled={submitting}>
          {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {submitting ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </AuthShell>
  );
}
