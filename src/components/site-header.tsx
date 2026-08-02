import { Link } from "@tanstack/react-router";
import { Stethoscope, LayoutDashboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth, panelPathForRoles } from "@/store/auth";
import { NotificationBell } from "@/components/notification-bell";

export function SiteHeader() {
  const { status, roles } = useAuth();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" className="group flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-soft transition-transform group-hover:scale-105">
            <Stethoscope className="h-5 w-5" />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-base font-semibold tracking-tight text-secondary">
              DoctorCita
            </span>
            <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              Zacatecas
            </span>
          </div>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          <Link
            to="/medicos"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Médicos
          </Link>
          <a
            href="#como-funciona"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Cómo funciona
          </a>
          <a
            href="#para-medicos"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Para médicos
          </a>
        </nav>

        <div className="flex items-center gap-2">
          {/* Durante `loading` no se pinta ningún botón de sesión: mostrar
              "Iniciar sesión" y cambiarlo a "Mi panel" un instante después
              produce un parpadeo desagradable en cada carga. */}
          {status === "loading" ? (
            <div className="h-9 w-[13.5rem] sm:w-[19.5rem]" aria-hidden="true" />
          ) : status === "authenticated" ? (
            <>
              <NotificationBell />
              <Button asChild size="sm" className="gap-2">
              {/* Apunta a /panel, no al panel concreto: esa ruta reparte según
                  el rol una vez resuelto. Calcular el destino aquí lo dejaba
                  fijado con la lista de roles todavía vacía. */}
              <Link to="/panel">
                <LayoutDashboard className="h-4 w-4" />
                Mi panel
              </Link>
              </Button>
            </>
          ) : (
            <>
              {/* Jerarquía deliberada: el paciente es quien más llega a esta
                  página, así que su registro es el botón sólido. "Iniciar
                  sesión" se mantiene visible también en móvil — antes se ocultaba
                  y quien ya tenía cuenta se quedaba sin forma de entrar desde el
                  teléfono. "Soy médico" cae a partir de sm: su público llega
                  buscándolo, y en la portada tiene su propia sección. */}
              <Button asChild variant="ghost" size="sm">
                <Link to="/entrar">Iniciar sesión</Link>
              </Button>
              <Button asChild size="sm" className="bg-primary hover:bg-primary/90">
                <Link to="/registro" search={{ rol: "patient" }}>
                  Soy paciente
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
                <Link to="/registro" search={{ rol: "doctor" }}>
                  Soy médico
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
