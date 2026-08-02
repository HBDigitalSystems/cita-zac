import { Link } from "@tanstack/react-router";
import { ShieldCheck, CalendarCheck, Star } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import type { ReactNode } from "react";

/**
 * Marco común de las pantallas de acceso: formulario a la izquierda, panel de
 * confianza a la derecha. El panel se oculta en móvil para no empujar el
 * formulario por debajo del pliegue.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_44%]">
      <div className="flex flex-col px-4 py-8 sm:px-8">
        <Link to="/" className="group inline-flex w-fit items-center gap-2">
          {/* Aquí hay sitio de sobra, así que el logotipo va más grande y se
              lee la línea de abajo. */}
          <BrandMark className="h-20 transition-transform group-hover:scale-105" />
        </Link>

        <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <h1 className="text-2xl font-semibold tracking-tight text-secondary sm:text-3xl">
            {title}
          </h1>
          {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}

          <div className="mt-8">{children}</div>

          {footer && <div className="mt-8 text-sm text-muted-foreground">{footer}</div>}
        </main>
      </div>

      <aside className="relative hidden flex-col justify-center overflow-hidden bg-secondary px-12 lg:flex">
        <div className="absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-primary/25 blur-3xl" />
        <div className="absolute -bottom-16 -right-10 h-80 w-80 rounded-full bg-success/15 blur-3xl" />

        <div className="relative">
          <h2 className="max-w-sm text-3xl font-semibold leading-tight tracking-tight text-white">
            La salud de Zacatecas, a un par de clics.
          </h2>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/70">
            Agenda con especialistas verificados, consulta disponibilidad real y lleva tu historial
            en un solo lugar.
          </p>

          <ul className="mt-10 space-y-5">
            {[
              { icon: ShieldCheck, text: "Cédula profesional verificada por la plataforma" },
              { icon: CalendarCheck, text: "Disponibilidad real, sin llamadas ni esperas" },
              { icon: Star, text: "Opiniones de pacientes que sí acudieron a consulta" },
            ].map((item) => (
              <li key={item.text} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white">
                  <item.icon className="h-4 w-4" />
                </span>
                <span className="max-w-xs text-sm text-white/80">{item.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
