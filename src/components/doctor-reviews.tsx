// Reseñas verificadas en la ficha pública del médico (PRD Fase 8).

import { useQuery } from "@tanstack/react-query";
import { Star, ShieldCheck } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  averageOf,
  getDoctorReviews,
  ratingBreakdown,
  type PublicReview,
} from "@/services/reviews";

function Estrellas({ valor, className }: { valor: number; className?: string }) {
  return (
    <span className={cn("flex items-center gap-0.5 text-amber-400", className)} aria-hidden="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={cn("h-3.5 w-3.5", i < Math.round(valor) && "fill-current")} />
      ))}
    </span>
  );
}

function fecha(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const CRITERIOS = [
  { campo: "rating_punctuality", etiqueta: "Puntualidad" },
  { campo: "rating_attention", etiqueta: "Trato y atención" },
  { campo: "rating_facilities", etiqueta: "Instalaciones" },
] as const;

export function DoctorReviews({ doctorId }: { doctorId: string }) {
  const { data: resenas, isLoading } = useQuery({
    queryKey: ["reviews", doctorId],
    queryFn: () => getDoctorReviews(doctorId),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    );
  }

  const lista: PublicReview[] = resenas ?? [];

  // Se calcula sobre las reseñas traídas y no sobre `doctors.rating_average`.
  // Ese contador lo mantiene un trigger y es el bueno para ordenar el buscador,
  // pero aquí quedaría desacompasado con la lista que el visitante tiene
  // delante si una reseña acabara de moderarse.
  const promedio =
    lista.length === 0
      ? 0
      : Math.round((lista.reduce((a, r) => a + r.rating, 0) / lista.length) * 10) / 10;

  if (lista.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-10 text-center">
        <p className="text-sm font-medium text-secondary">Todavía no hay opiniones</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Solo pueden opinar los pacientes que ya tuvieron una consulta con este médico.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="shrink-0">
            <div className="text-4xl font-semibold text-secondary">{promedio}</div>
            <Estrellas valor={promedio} className="mt-1" />
            <div className="mt-1 text-xs text-muted-foreground">
              {lista.length} {lista.length === 1 ? "opinión verificada" : "opiniones verificadas"}
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-1.5">
            {ratingBreakdown(lista).map((b) => (
              <div key={b.estrellas} className="flex items-center gap-2 text-xs">
                <span className="w-3 text-muted-foreground tabular-nums">{b.estrellas}</span>
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden="true" />
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-amber-400" style={{ width: `${b.porcentaje}%` }} />
                </div>
                <span className="w-6 text-right text-muted-foreground tabular-nums">{b.total}</span>
              </div>
            ))}
          </div>
        </div>

        {/* El desglose por criterio es opcional al escribir, así que solo se
            pinta el que alguien haya calificado. */}
        {CRITERIOS.some(({ campo }) => averageOf(lista, campo) !== null) && (
          <dl className="mt-6 grid gap-4 border-t border-border pt-5 sm:grid-cols-3">
            {CRITERIOS.map(({ campo, etiqueta }) => {
              const valor = averageOf(lista, campo);
              if (valor === null) return null;
              return (
                <div key={campo}>
                  <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
                  <dd className="mt-1 flex items-center gap-2">
                    <span className="text-sm font-semibold text-secondary tabular-nums">{valor}</span>
                    <Estrellas valor={valor} />
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </div>

      {lista.map((r) => (
        <article key={r.id} className="rounded-2xl border border-border bg-card p-6">
          <header className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-secondary">
                  {r.author_display_name ?? "Paciente verificado"}
                </span>
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5
                             text-[10px] font-medium text-emerald-700
                             dark:bg-emerald-950 dark:text-emerald-400"
                  title="Esta opinión está ligada a una consulta realmente atendida"
                >
                  <ShieldCheck className="h-3 w-3" />
                  Verificada
                </span>
              </div>
              <time className="text-xs text-muted-foreground" dateTime={r.created_at}>
                {fecha(r.created_at)}
              </time>
            </div>
            <Estrellas valor={r.rating} />
          </header>

          {r.comment && (
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{r.comment}</p>
          )}

          {r.doctor_reply && (
            <div className="mt-4 rounded-xl border-l-2 border-primary bg-muted/40 p-4">
              <p className="text-xs font-semibold text-secondary">Respuesta del médico</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{r.doctor_reply}</p>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
