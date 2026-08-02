import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { translateAuthError } from "@/lib/auth-schemas";

/**
 * Acceso con Google y Facebook.
 *
 * Los proveedores deben habilitarse en el panel de Supabase (Authentication →
 * Providers) con sus credenciales de OAuth. Hasta entonces Supabase responde
 * "provider is not enabled" y el mensaje traducido lo explica sin dejar al
 * usuario mirando un botón que no hace nada.
 *
 * Apple queda fuera a propósito: el PRD lo pide preparado, no activo, y su alta
 * exige una cuenta de desarrollador de pago.
 */
export function OAuthButtons({ redirectTo }: { redirectTo?: string }) {
  const [pending, setPending] = useState<"google" | "facebook" | null>(null);

  const signInWith = async (provider: "google" | "facebook") => {
    setPending(provider);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}${redirectTo ?? "/panel"}`,
      },
    });

    if (error) {
      toast.error(translateAuthError(error.message));
      setPending(null);
    }
    // Si no hay error el navegador se va al proveedor; no se limpia el estado
    // para que el botón siga deshabilitado durante la redirección.
  };

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Button
        type="button"
        variant="outline"
        onClick={() => signInWith("google")}
        disabled={pending !== null}
        className="gap-2"
      >
        <GoogleMark />
        {pending === "google" ? "Conectando…" : "Google"}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => signInWith("facebook")}
        disabled={pending !== null}
        className="gap-2"
      >
        <FacebookMark />
        {pending === "facebook" ? "Conectando…" : "Facebook"}
      </Button>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.06 12.25c0-.85-.08-1.67-.22-2.45H12v4.64h6.2a5.3 5.3 0 0 1-2.3 3.48v2.89h3.72c2.18-2 3.44-4.96 3.44-8.46Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.1 0 5.7-1.03 7.62-2.79l-3.72-2.89c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.54-2.02-6.45-4.75H1.7v2.98A11.99 11.99 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.55 14.67a7.2 7.2 0 0 1 0-4.6V7.09H1.7a12 12 0 0 0 0 10.56l3.85-2.98Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.69 0 3.2.58 4.4 1.72l3.3-3.3C17.7 1.2 15.1 0 12 0 7.4 0 3.42 2.64 1.7 6.47l3.85 2.98C6.46 6.77 9 4.75 12 4.75Z"
      />
    </svg>
  );
}

function FacebookMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#1877F2"
        d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.96h-1.51c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07Z"
      />
    </svg>
  );
}
