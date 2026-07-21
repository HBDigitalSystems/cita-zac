import { Link } from "@tanstack/react-router";
import { Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2 group">
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
            href="/medicos"
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Especialidades
          </a>
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
          <Button variant="ghost" size="sm" className="hidden sm:inline-flex">
            Iniciar sesión
          </Button>
          <Button size="sm" className="bg-primary hover:bg-primary/90">
            Soy médico
          </Button>
        </div>
      </div>
    </header>
  );
}
