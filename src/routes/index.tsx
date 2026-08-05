import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  Search,
  MapPin,
  Calendar,
  ShieldCheck,
  Video,
  Star,
  Clock,
  ArrowRight,
  Building2,
  FlaskConical,
  HeartPulse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { useQuery } from "@tanstack/react-query";
import { doctorDisplayName, formatPrice } from "@/lib/doctor-format";
import { getFeaturedDoctors, getSpecialtyCounts } from "@/services/doctors";
import { getMunicipalities, getSpecialties } from "@/services/catalogs";

/** Los catálogos casi nunca cambian: se cachean una hora. */
const CATALOG_STALE_TIME = 1000 * 60 * 60;
import heroDoctor from "@/assets/hero-doctor.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DoctorCita · Encuentra tu médico en Zacatecas y agenda en línea" },
      {
        name: "description",
        content:
          "Reserva citas médicas en Zacatecas con especialistas verificados. Consulta disponibilidad real, opiniones y precios de más de 40 especialidades.",
      },
      { property: "og:title", content: "DoctorCita · Salud en Zacatecas" },
      {
        property: "og:description",
        content: "La forma más simple de encontrar un médico y agendar tu cita en Zacatecas.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <TrustBar />
        <EspecialidadesGrid />
        <ComoFunciona />
        <MedicosDestacados />
        <ParaMedicos />
      </main>
      <SiteFooter />
    </div>
  );
}

function Hero() {
  const navigate = useNavigate();
  const [municipalitySlug, setMunicipalitySlug] = useState<string>("");
  const [q, setQ] = useState("");

  const municipalities = useQuery({
    queryKey: ["municipalities"],
    queryFn: getMunicipalities,
    staleTime: CATALOG_STALE_TIME,
  });
  const specialties = useQuery({
    queryKey: ["specialties"],
    queryFn: getSpecialties,
    staleTime: CATALOG_STALE_TIME,
  });
  const featured = (specialties.data ?? []).filter((s) => s.is_featured);

  // Misma clave que en la rejilla de especialidades: TanStack Query resuelve
  // una sola petición para las dos secciones.
  const counts = useQuery({ queryKey: ["specialty-counts"], queryFn: getSpecialtyCounts });
  const doctorCount = Object.values(counts.data ?? {}).reduce((sum, n) => sum + n, 0);

  const handleSearch = () => {
    navigate({
      to: "/medicos",
      search: {
        q: q || undefined,
        municipio: municipalitySlug || undefined,
      },
    });
  };

  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-primary-soft/60 via-background to-background">
      <div className="mx-auto grid max-w-7xl gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:px-8 lg:pt-24">
        <div className="flex flex-col justify-center">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-primary/20 bg-white/70 px-3 py-1 text-xs font-medium text-primary shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            Nuevo en Zacatecas · Reserva 100% en línea
          </span>

          <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight text-secondary sm:text-5xl lg:text-6xl">
            Encuentra tu médico
            <br />
            <span className="text-primary">y agenda en minutos.</span>
          </h1>

          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Más de 40 especialidades, disponibilidad en tiempo real y opiniones verificadas de
            pacientes en todo el estado de Zacatecas.
          </p>

          <div className="mt-8 rounded-2xl border border-border/70 bg-card p-3 shadow-elevated sm:p-4">
            <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Especialidad, nombre o padecimiento"
                  className="h-12 border-transparent bg-surface pl-10 text-sm shadow-none focus-visible:ring-1"
                />
              </div>
              <div className="relative">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Select value={municipalitySlug} onValueChange={setMunicipalitySlug}>
                  <SelectTrigger
                    className="h-12 border-transparent bg-surface pl-10 text-sm shadow-none"
                    aria-label="Municipio"
                  >
                    <SelectValue placeholder="Municipio" />
                  </SelectTrigger>
                  <SelectContent>
                    {(municipalities.data ?? []).map((municipality) => (
                      <SelectItem key={municipality.id} value={municipality.slug}>
                        {municipality.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="lg"
                className="h-12 gap-2 px-6 text-sm font-semibold"
                onClick={handleSearch}
              >
                Buscar
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 px-1 pt-1 text-xs text-muted-foreground">
              <span>Populares:</span>
              {featured.slice(1, 6).map((specialty) => (
                <button
                  key={specialty.id}
                  onClick={() =>
                    navigate({
                      to: "/medicos",
                      search: { especialidad: specialty.slug },
                    })
                  }
                  className="rounded-full border border-border bg-background px-2.5 py-1 font-medium text-foreground hover:border-primary hover:text-primary"
                >
                  {specialty.name}
                </button>
              ))}
            </div>
          </div>

          {/* Las cifras salen de la base de datos, nunca escritas a mano: una
              cifra inventada en la portada es una promesa que la búsqueda
              desmiente en el primer clic.
              Mientras no haya médicos publicados se muestra el alcance del
              catálogo en lugar de un "0 médicos" que solo transmite abandono. */}
          <dl className="mt-10 grid max-w-lg grid-cols-3 gap-6 border-t border-border/60 pt-6">
            {[
              doctorCount > 0
                ? { k: `${doctorCount}`, v: "Médicos verificados" }
                : { k: `${specialties.data?.length ?? 0}`, v: "Especialidades" },
              { k: `${municipalities.data?.length ?? 0}`, v: "Municipios cubiertos" },
              { k: "100%", v: "Reserva en línea" },
            ].map((s) => (
              <div key={s.v}>
                <dt className="text-2xl font-semibold tabular-nums text-secondary">{s.k}</dt>
                <dd className="mt-1 text-xs text-muted-foreground">{s.v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="relative flex items-center justify-center">
          <div className="absolute -left-6 -top-6 hidden h-64 w-64 rounded-full bg-primary/10 blur-3xl lg:block" />
          <div className="absolute -bottom-8 -right-8 hidden h-72 w-72 rounded-full bg-success/10 blur-3xl lg:block" />
          <div className="relative w-full max-w-md">
            <div className="overflow-hidden rounded-[2rem] border border-white/60 bg-card shadow-elevated">
              <img
                src={heroDoctor}
                alt="Doctora de Zacatecas atendiendo pacientes"
                width={1600}
                height={1200}
                className="aspect-[4/5] w-full object-cover"
              />
            </div>

            {/* Estas dos tarjetas describen cómo funciona la plataforma.
                Antes mostraban una cita concreta ("hoy 16:30, Cardiología") y un
                testimonio de cinco estrellas firmado por "María F. · Guadalupe".
                Ambos eran inventados: no existía esa cita ni esa paciente. Una
                reseña falsa en la portada de un directorio médico es un problema
                serio, no un placeholder — así que ahora dicen cosas ciertas. */}
            <div className="absolute -left-4 top-8 hidden max-w-[230px] rounded-2xl border border-border bg-card p-4 shadow-elevated sm:block">
              <div className="flex items-center gap-2 text-xs font-medium text-success">
                <span className="h-2 w-2 rounded-full bg-success" />
                Agenda real
              </div>
              <p className="mt-2 text-sm font-medium text-secondary">
                Ves los huecos libres del médico
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                No mandas una solicitud a ciegas: eliges hora y queda reservada.
              </p>
            </div>

            <div className="absolute -bottom-6 -right-4 hidden max-w-[240px] rounded-2xl border border-border bg-card p-4 shadow-elevated sm:block">
              <div className="flex items-center gap-2 text-xs font-medium text-primary">
                <ShieldCheck className="h-4 w-4" />
                Cédula verificada
              </div>
              <p className="mt-2 text-sm font-medium text-secondary">Revisamos antes de publicar</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Ningún perfil aparece en el buscador sin validar su cédula profesional.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TrustBar() {
  const items = [
    { icon: ShieldCheck, label: "Cédula profesional verificada" },
    { icon: Star, label: "Opiniones reales de pacientes" },
    { icon: Clock, label: "Disponibilidad en tiempo real" },
    { icon: Video, label: "Videoconsulta disponible" },
  ];
  return (
    <section className="border-y border-border/60 bg-surface">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-4 py-8 sm:px-6 md:grid-cols-4 lg:px-8">
        {items.map((it) => (
          <div key={it.label} className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <it.icon className="h-4 w-4" />
            </div>
            <span className="text-sm font-medium text-secondary">{it.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function EspecialidadesGrid() {
  const navigate = useNavigate();

  const specialties = useQuery({
    queryKey: ["specialties"],
    queryFn: getSpecialties,
    staleTime: CATALOG_STALE_TIME,
  });
  const counts = useQuery({ queryKey: ["specialty-counts"], queryFn: getSpecialtyCounts });

  const all = specialties.data ?? [];
  const featured = all.filter((s) => s.is_featured);

  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      <div className="flex items-end justify-between gap-6">
        <div>
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">
            Especialidades
          </span>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-secondary sm:text-4xl">
            Encuentra al especialista correcto
          </h2>
        </div>
        <Link
          to="/medicos"
          className="hidden text-sm font-medium text-primary hover:underline sm:inline"
        >
          Ver todas →
        </Link>
      </div>

      <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {featured.map((specialty) => {
          const count = counts.data?.[specialty.id] ?? 0;

          return (
            <button
              key={specialty.id}
              onClick={() => navigate({ to: "/medicos", search: { especialidad: specialty.slug } })}
              className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left shadow-soft transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-elevated"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-xl">
                {specialty.icon}
              </div>
              <div>
                <div className="text-sm font-semibold text-secondary group-hover:text-primary">
                  {specialty.name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {counts.isLoading
                    ? "…"
                    : count === 1
                      ? "1 especialista"
                      : `${count} especialistas`}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {all
          .filter((s) => !s.is_featured)
          .slice(0, 14)
          .map((specialty) => (
            <button
              key={specialty.id}
              onClick={() => navigate({ to: "/medicos", search: { especialidad: specialty.slug } })}
              className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-primary"
            >
              {specialty.name}
            </button>
          ))}
      </div>
    </section>
  );
}

function ComoFunciona() {
  const pasos = [
    {
      icon: Search,
      titulo: "Busca por especialidad",
      desc: "Filtra por municipio, aseguradora, precio o disponibilidad.",
    },
    {
      icon: Calendar,
      titulo: "Elige día y hora",
      desc: "Consulta la agenda real del médico y reserva al instante.",
    },
    {
      icon: HeartPulse,
      titulo: "Recibe tu consulta",
      desc: "Presencial o por video. Recibe recordatorios y receta digital.",
    },
  ];
  return (
    <section id="como-funciona" className="bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">
            Cómo funciona
          </span>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-secondary sm:text-4xl">
            Tu próxima cita, en tres pasos
          </h2>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {pasos.map((p, i) => (
            <div
              key={p.titulo}
              className="relative rounded-2xl border border-border bg-card p-7 shadow-soft"
            >
              <span className="absolute -top-3 left-6 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-primary-foreground">
                Paso {i + 1}
              </span>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
                <p.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 text-lg font-semibold text-secondary">{p.titulo}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MedicosDestacados() {
  const featuredDoctors = useQuery({
    queryKey: ["featured-doctors"],
    queryFn: () => getFeaturedDoctors(3),
  });
  const top = featuredDoctors.data ?? [];

  // Sin médicos publicados la sección entera sobra: una franja vacía titulada
  // "Médicos destacados" resta más de lo que aporta.
  if (!featuredDoctors.isLoading && top.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
      <div className="flex items-end justify-between gap-6">
        <div>
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">
            Mejor calificados
          </span>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-secondary sm:text-4xl">
            Médicos destacados
          </h2>
        </div>
        <Link
          to="/medicos"
          className="hidden text-sm font-medium text-primary hover:underline sm:inline"
        >
          Explorar todos →
        </Link>
      </div>

      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {top.map((doctor) => (
          <Link
            key={doctor.id}
            to="/medicos/$id"
            params={{ id: doctor.slug }}
            className="group flex flex-col rounded-2xl border border-border bg-card p-6 shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-elevated"
          >
            <div className="flex items-center gap-4">
              <img
                src={doctor.profile.photo_url ?? ""}
                alt={doctorDisplayName(doctor)}
                width={80}
                height={80}
                loading="lazy"
                className="h-16 w-16 rounded-2xl border border-border bg-primary-soft object-cover"
              />
              <div>
                <div className="text-sm font-semibold text-secondary group-hover:text-primary">
                  {doctorDisplayName(doctor)}
                </div>
                <div className="text-xs text-primary">{doctor.specialty?.name}</div>
                <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                  {doctor.rating_average} · {doctor.reviews_count} opiniones
                </div>
              </div>
            </div>
            <p className="mt-4 line-clamp-3 text-sm text-muted-foreground">
              {doctor.profile.biography}
            </p>
            <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-sm">
              <span className="font-semibold text-secondary">
                {formatPrice(doctor.profile.price_in_person_cents, doctor.profile.currency)}
              </span>
              <span className="inline-flex items-center gap-1 text-primary">
                Ver perfil <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function ParaMedicos() {
  const items = [
    { icon: Calendar, label: "Agenda digital 24/7" },
    { icon: Building2, label: "Multi-consultorio" },
    { icon: FlaskConical, label: "Historial clínico" },
    { icon: Video, label: "Telemedicina integrada" },
  ];
  return (
    <section id="para-medicos" className="mx-auto max-w-7xl px-4 pb-24 sm:px-6 lg:px-8">
      <div className="relative overflow-hidden rounded-3xl bg-secondary p-10 shadow-elevated sm:p-14">
        <div className="absolute inset-y-0 right-0 hidden w-1/2 bg-gradient-to-l from-primary/20 to-transparent lg:block" />
        <div className="relative grid gap-10 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80">
              Para profesionales de la salud
            </span>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Haz crecer tu consultorio en Zacatecas
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/70 sm:text-base">
              Únete a la plataforma médica de referencia del estado. Nuevos pacientes, agenda
              automatizada y herramientas clínicas modernas en un solo lugar.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {/* Los dos botones que había aquí no tenían ni enlace ni acción:
                  pulsarlos no hacía nada, y son la principal llamada a la
                  acción para los médicos que llegan a la portada. */}
              <Button
                asChild
                size="lg"
                variant="secondary"
                className="bg-white text-secondary hover:bg-white/90"
              >
                <Link to="/registro" search={{ rol: "doctor" }}>
                  Registrar mi consultorio
                </Link>
              </Button>
              {/* "Ver planes" se retira en lugar de dejarlo mudo: la
                  contratación de suscripciones es la Fase 9 y todavía no hay
                  ninguna página de precios a la que llevar. */}
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
              >
                <Link to="/medicos">Ver médicos ya publicados</Link>
              </Button>
            </div>
          </div>

          <ul className="grid grid-cols-2 gap-3">
            {items.map((it) => (
              <li
                key={it.label}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-4 text-white/90 backdrop-blur"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10">
                  <it.icon className="h-4 w-4" />
                </div>
                <span className="text-sm font-medium">{it.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
