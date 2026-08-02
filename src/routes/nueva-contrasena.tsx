import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth-shell";
import { supabase } from "@/integrations/supabase/client";
import {
  resetPasswordSchema,
  translateAuthError,
  type ResetPasswordValues,
} from "@/lib/auth-schemas";
import { panelPathForRoles, useAuth } from "@/store/auth";

export const Route = createFileRoute("/nueva-contrasena")({
  head: () => ({
    meta: [{ title: "Nueva contraseña · DoctorCita" }, { name: "robots", content: "noindex" }],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { status, roles } = useAuth();

  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Al abrir el enlace del correo, Supabase canjea el token y deja una sesión
  // temporal. Sin ella no hay nada que actualizar: el enlace caducó o se abrió
  // en otro navegador.
  const [linkChecked, setLinkChecked] = useState(false);
  useEffect(() => {
    if (status !== "loading") setLinkChecked(true);
  }, [status]);

  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);

    const { error } = await supabase.auth.updateUser({ password: values.password });

    if (error) {
      setFormError(translateAuthError(error.message));
      return;
    }

    toast.success("Contraseña actualizada.");
    void navigate({ to: panelPathForRoles(roles), replace: true });
  });

  if (!linkChecked) {
    return (
      <AuthShell title="Comprobando el enlace…">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Un momento.
        </div>
      </AuthShell>
    );
  }

  if (status !== "authenticated") {
    return (
      <AuthShell
        title="El enlace ya no sirve"
        subtitle="Puede haber caducado o haberse abierto en otro navegador."
      >
        <div className="rounded-2xl border border-border bg-card p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Pide un enlace nuevo y ábrelo en el mismo navegador donde lo solicitaste. Caducan a la
            hora por seguridad.
          </p>
          <Button asChild className="mt-6 w-full">
            <Link to="/recuperar">Pedir un enlace nuevo</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Crea una contraseña nueva" subtitle="Elige una que no uses en otros sitios.">
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
          <Label htmlFor="password">Nueva contraseña</Label>
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

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Repite la contraseña</Label>
          <Input
            id="confirmPassword"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            aria-invalid={!!form.formState.errors.confirmPassword}
            {...form.register("confirmPassword")}
          />
          {form.formState.errors.confirmPassword && (
            <p className="text-sm text-destructive">
              {form.formState.errors.confirmPassword.message}
            </p>
          )}
        </div>

        <Button type="submit" className="w-full" size="lg" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {form.formState.isSubmitting ? "Guardando…" : "Guardar contraseña"}
        </Button>
      </form>
    </AuthShell>
  );
}
