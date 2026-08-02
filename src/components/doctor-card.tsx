import { Link } from "@tanstack/react-router";
import { MapPin, Star, Video, Clock, Heart, GitCompare, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/hooks/use-hydrated";
import { useShortlist } from "@/store/doctor-shortlist";
import {
  doctorDisplayName,
  formatPrice,
  formatResponseTime,
  primaryRoom,
} from "@/lib/doctor-format";
import type { DoctorSearchResult } from "@/services/doctors";

export function DoctorCard({ doctor }: { doctor: DoctorSearchResult }) {
  const hydrated = useHydrated();
  const { favorites, compare, toggleFavorite, toggleCompare, canCompare } = useShortlist();

  const name = doctorDisplayName(doctor);
  const room = primaryRoom(doctor);
  const responseTime = formatResponseTime(doctor.profile?.average_response_minutes);

  // Hasta hidratar se pinta el estado neutro para no romper el HTML del servidor.
  const isFavorite = hydrated && favorites.includes(doctor.slug);
  const isComparing = hydrated && compare.includes(doctor.slug);
  const compareDisabled = hydrated && !canCompare(doctor.slug);

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card p-5 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-elevated sm:flex-row sm:gap-6">
      <button
        type="button"
        onClick={() => toggleFavorite(doctor.slug)}
        aria-pressed={isFavorite}
        aria-label={isFavorite ? `Quitar a ${name} de favoritos` : `Guardar a ${name} en favoritos`}
        className="absolute right-4 top-4 z-10 rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-rose-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Heart className={cn("h-5 w-5", isFavorite && "fill-rose-500 text-rose-500")} />
      </button>

      <div className="flex shrink-0 flex-row items-start gap-4 sm:flex-col sm:items-center">
        <img
          src={doctor.profile?.photo_url ?? "/favicon.ico"}
          alt={name}
          width={120}
          height={120}
          loading="lazy"
          className="h-24 w-24 rounded-2xl border border-border bg-primary-soft object-cover sm:h-28 sm:w-28"
        />
        <div className="flex flex-col gap-1 pr-10 sm:hidden">
          <h3 className="text-base font-semibold text-secondary">{name}</h3>
          <p className="text-sm text-primary">{doctor.specialty?.name}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-1 flex-col sm:mt-0">
        <div className="hidden pr-10 sm:block">
          <Link
            to="/medicos/$id"
            params={{ id: doctor.slug }}
            className="text-lg font-semibold text-secondary hover:text-primary"
          >
            {name}
          </Link>
          <p className="text-sm font-medium text-primary">{doctor.specialty?.name}</p>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {doctor.reviews_count > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
              <span className="font-semibold text-foreground">{doctor.rating_average}</span>
              <span>({doctor.reviews_count} opiniones)</span>
            </span>
          ) : (
            // Un "0 ★ (0 opiniones)" castiga a quien acaba de darse de alta y
            // no dice nada útil. Es más honesto decir que aún no tiene reseñas.
            <span className="text-muted-foreground">Sin opiniones todavía</span>
          )}

          {room?.municipality && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-4 w-4" />
              {room.municipality.name}
            </span>
          )}
          {responseTime && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-4 w-4" />
              Responde {responseTime}
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {doctor.profile?.offers_telemedicine && (
            <Badge
              variant="secondary"
              className="gap-1 bg-primary-soft text-primary hover:bg-primary-soft"
            >
              <Video className="h-3 w-3" /> Videoconsulta
            </Badge>
          )}
          {doctor.profile?.accepts_new_patients && (
            <Badge variant="secondary" className="bg-success/10 text-success hover:bg-success/10">
              Acepta nuevos pacientes
            </Badge>
          )}
          {doctor.insurances.slice(0, 2).map((insurance) => (
            <Badge key={insurance.id} variant="outline" className="font-normal">
              {insurance.name}
            </Badge>
          ))}
        </div>

        {doctor.profile?.biography && (
          <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
            {doctor.profile.biography}
          </p>
        )}

        <div className="mt-4 flex flex-col items-stretch justify-between gap-3 border-t border-dashed border-border pt-4 sm:flex-row sm:items-center">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Consulta desde
            </div>
            <div className="text-lg font-semibold text-secondary">
              {formatPrice(doctor.profile?.price_in_person_cents, doctor.profile?.currency)}
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant={isComparing ? "secondary" : "ghost"}
              size="sm"
              onClick={() => toggleCompare(doctor.slug)}
              disabled={compareDisabled}
              aria-pressed={isComparing}
              title={
                compareDisabled
                  ? "Ya estás comparando el máximo de médicos"
                  : isComparing
                    ? "Quitar del comparador"
                    : "Añadir al comparador"
              }
              className="gap-2"
            >
              <GitCompare className="h-4 w-4" />
              {isComparing ? "Comparando" : "Comparar"}
            </Button>

            <Button asChild variant="outline">
              <Link to="/medicos/$id" params={{ id: doctor.slug }}>
                Ver perfil
              </Link>
            </Button>

            <Button asChild className="gap-2">
              <Link to="/medicos/$id" params={{ id: doctor.slug }}>
                <CalendarDays className="h-4 w-4" />
                Ver horarios
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

/** Placeholder con la misma altura que la tarjeta, para el estado de carga. */
export function DoctorCardSkeleton() {
  return (
    <div
      className="flex flex-col gap-6 rounded-2xl border border-border/70 bg-card p-5 sm:flex-row"
      aria-hidden="true"
    >
      <div className="h-24 w-24 shrink-0 animate-pulse rounded-2xl bg-muted sm:h-28 sm:w-28" />
      <div className="flex flex-1 flex-col gap-3">
        <div className="h-5 w-52 animate-pulse rounded bg-muted" />
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full max-w-md animate-pulse rounded bg-muted" />
        <div className="flex gap-2">
          <div className="h-6 w-28 animate-pulse rounded-full bg-muted" />
          <div className="h-6 w-36 animate-pulse rounded-full bg-muted" />
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-dashed border-border pt-4">
          <div className="h-8 w-28 animate-pulse rounded bg-muted" />
          <div className="h-9 w-40 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}
