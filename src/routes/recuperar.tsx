import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Loader2, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth-shell";
import { supabase } from "@/integrations/supabase/client";
import {
  forgotPasswordSchema,
  translateAuthError,
  type ForgotPasswordValues,
} from "@/lib/auth-schemas";

export const Route = createFileRoute("/recuperar")({
  head: () => ({
    meta: [{ title: "Recuperar contraseña · DoctorCita" }, { name: "robots", content: "noindex" }],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);

    const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: `${window.location.origin}/nueva-contrasena`,
    });

    // Solo se corta ante fallos técnicos. Si el correo no existe, Supabase
    // responde OK a propósito: decir "ese correo no está registrado" permitiría
    // a cualquiera averiguar quién tiene cuenta.
    if (error) {
      setFormError(translateAuthError(error.message));
      return;
    }

    setSentTo(values.email);
  });

  if (sentTo) {
    return (
      <AuthShell
        title="Revisa tu correo"
        subtitle={`Si ${sentTo} tiene una cuenta, recibirá un enlace.`}
      >
        <div className="rounded-2xl border border-border bg-card p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary">
            <MailCheck className="h-6 w-6" />
          </div>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            El enlace caduca en una hora. Si no llega, revisa el correo no deseado o vuelve a
            intentarlo.
          </p>
          <Button asChild variant="outline" className="mt-6 w-full">
            <Link to="/entrar">Volver a iniciar sesión</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Recupera tu contraseña"
      subtitle="Escribe tu correo y te enviamos un enlace para crear una nueva."
      footer={
        <Link
          to="/entrar"
          className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Volver a iniciar sesión
        </Link>
      }
    >
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

        <Button type="submit" className="w-full" size="lg" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {form.formState.isSubmitting ? "Enviando…" : "Enviar enlace"}
        </Button>
      </form>
    </AuthShell>
  );
}
