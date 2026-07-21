import { Link } from "@tanstack/react-router";
import { MapPin, Star, Video, Calendar, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Doctor } from "@/lib/mock-data";

export function DoctorCard({ doctor }: { doctor: Doctor }) {
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card p-5 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-elevated sm:flex-row sm:gap-6">
      <div className="flex shrink-0 flex-row items-start gap-4 sm:flex-col sm:items-center">
        <img
          src={doctor.fotoUrl}
          alt={doctor.nombre}
          width={120}
          height={120}
          loading="lazy"
          className="h-24 w-24 rounded-2xl border border-border bg-primary-soft object-cover sm:h-28 sm:w-28"
        />
        <div className="flex flex-col gap-1 sm:hidden">
          <h3 className="text-base font-semibold text-secondary">{doctor.nombre}</h3>
          <p className="text-sm text-primary">{doctor.especialidad}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-1 flex-col sm:mt-0">
        <div className="hidden sm:block">
          <Link
            to="/medicos/$id"
            params={{ id: doctor.id }}
            className="text-lg font-semibold text-secondary hover:text-primary"
          >
            {doctor.nombre}
          </Link>
          <p className="text-sm font-medium text-primary">{doctor.especialidad}</p>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
            <span className="font-semibold text-foreground">{doctor.rating}</span>
            <span>({doctor.reseñas} opiniones)</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-4 w-4" />
            {doctor.municipio}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-4 w-4" />
            Responde {doctor.tiempoRespuesta}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {doctor.telemedicina && (
            <Badge variant="secondary" className="gap-1 bg-primary-soft text-primary hover:bg-primary-soft">
              <Video className="h-3 w-3" /> Videoconsulta
            </Badge>
          )}
          {doctor.aceptaNuevos && (
            <Badge variant="secondary" className="bg-success/10 text-success hover:bg-success/10">
              Acepta nuevos pacientes
            </Badge>
          )}
          {doctor.aseguradoras.slice(0, 2).map((a) => (
            <Badge key={a} variant="outline" className="font-normal">
              {a}
            </Badge>
          ))}
        </div>

        <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
          {doctor.biografia}
        </p>

        <div className="mt-4 flex flex-col items-stretch justify-between gap-3 border-t border-dashed border-border pt-4 sm:flex-row sm:items-center">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Consulta desde
            </div>
            <div className="text-lg font-semibold text-secondary">
              ${doctor.precio.toLocaleString("es-MX")}{" "}
              <span className="text-sm font-normal text-muted-foreground">MXN</span>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" asChild>
              <Link to="/medicos/$id" params={{ id: doctor.id }}>
                Ver perfil
              </Link>
            </Button>
            <Button className="gap-2">
              <Calendar className="h-4 w-4" />
              {doctor.proximaCita}
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}
