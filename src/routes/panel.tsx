import { createFileRoute, Outlet, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Loader2, LogOut, Stethoscope, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useAuth, isAdmin } from "@/store/auth";

export const Route = createFileRoute("/panel")({
  head: () => ({
    meta: [{ title: "Mi panel · DoctorCita" }, { name: "robots", content: "noindex" }],
  }),
  component: PanelLayout,
});

/**
 * Marco de las rutas privadas. Hace de guarda: sin sesión manda a /entrar
 * recordando a dónde se quería ir.
 *
 * Esto es una comodidad de la interfaz, NO la seguridad del sistema. Quien
 * quiera puede saltarse una guarda de cliente; lo que de verdad protege los
 * datos es el RLS de PostgreSQL, que se aplica en cada consulta.
 */
function PanelLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { status, user, roles, roleSource, signOut } = useAuth();

  // El destino al que se quería llegar se congela en el primer render. Si se
  // leyera el pathname actual, al empezar la redirección este componente aún
  // vive un instante con la ruta ya cambiada, el efecto se repite y acaba
  // guardando `redirect=/entrar`: la vuelta llevaría al propio login.
  const intendedPath = useRef(pathname);

  useEffect(() => {
    if (status === "anonymous") {
      void navigate({
        to: "/entrar",
        search: { redirect: intendedPath.current },
        replace: true,
      });
    }
  }, [status, navigate]);

  if (status !== "authenticated") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Comprobando tu sesión…
        </div>
      </div>
    );
  }

  const links = [
    { to: "/panel/paciente", label: "Paciente", show: true },
    { to: "/panel/medico", label: "Médico", show: roles.includes("doctor") },
    { to: "/panel/admin", label: "Administración", show: isAdmin(roles) },
  ].filter((link) => link.show);

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Stethoscope className="h-5 w-5" />
            </div>
            <span className="text-base font-semibold tracking-tight text-secondary">
              DoctorCita
            </span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  pathname === link.to
                    ? "bg-primary-soft text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{user?.email}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await signOut();
                void navigate({ to: "/" });
              }}
              className="gap-2"
            >
              <LogOut className="h-4 w-4" />
              Salir
            </Button>
          </div>
        </div>
      </header>

      {/* Aviso de desarrollo: sin las migraciones aplicadas, el rol sale de los
          metadatos del usuario y no hay autorización real detrás. */}
      {roleSource === "metadata" && (
        <div className="border-b border-amber-500/30 bg-amber-500/10">
          <div className="mx-auto flex max-w-7xl items-start gap-2 px-4 py-2.5 text-xs text-amber-900 sm:px-6 lg:px-8 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              El rol se está leyendo de los metadatos del usuario porque la tabla{" "}
              <code className="font-mono">user_roles</code> todavía no existe. Aplica las
              migraciones de la Fase 1 para tener permisos reales.
            </p>
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}

/** Cabecera reutilizable de cada panel. */
export function PanelHeading({
  title,
  description,
  badge,
}: {
  title: string;
  description?: string;
  badge?: string;
}) {
  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-secondary">{title}</h1>
        {badge && <Badge variant="secondary">{badge}</Badge>}
      </div>
      {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

/** Hueco de una sección todavía no construida, con la fase que la traerá. */
export function ComingSoon({ title, phase }: { title: string; phase: string }) {
  return (
    <section className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
      <h2 className="text-base font-semibold text-secondary">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        Se construye en la <strong>{phase}</strong> del plan.
      </p>
    </section>
  );
}
