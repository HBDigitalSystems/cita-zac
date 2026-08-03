import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { panelPathForRoles, useAuth } from "@/store/auth";

/**
 * `/panel` no muestra nada por sí solo: reparte según el rol. Existe para que
 * el resto de la aplicación pueda enviar a un destino fijo sin conocer el rol
 * de antemano.
 */
export const Route = createFileRoute("/panel/")({
  component: PanelRedirect,
});

function PanelRedirect() {
  const navigate = useNavigate();
  const { status, roles, rolesLoaded } = useAuth();

  // Se espera a `rolesLoaded`: repartir con la lista de roles todavía vacía
  // mandaba a todo el mundo al panel de paciente, médicos incluidos.
  useEffect(() => {
    if (status === "authenticated" && rolesLoaded) {
      void navigate({ to: panelPathForRoles(roles), replace: true });
    }
  }, [status, roles, rolesLoaded, navigate]);

  return (
    <div className="flex items-center gap-3 py-16 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Abriendo tu panel…
    </div>
  );
}
