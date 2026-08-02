import { BrandMark } from "@/components/brand-mark";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <BrandMark className="h-20" />
            <p className="mt-4 max-w-sm text-sm text-muted-foreground">
              La plataforma de salud de Zacatecas. Encuentra al especialista
              adecuado y agenda tu cita en minutos, con disponibilidad real y
              opiniones verificadas.
            </p>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-secondary">Pacientes</h4>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>Buscar médico</li>
              <li>Especialidades</li>
              <li>Municipios</li>
              <li>Aseguradoras</li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-secondary">Profesionales</h4>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>Registra tu perfil</li>
              <li>Planes y precios</li>
              <li>Agenda digital</li>
              <li>Ayuda</li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-border/60 pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} DoctorCita · Zacatecas, México</span>
          <div className="flex gap-6">
            <span>Aviso de privacidad</span>
            <span>Términos</span>
            <span>Contacto</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
