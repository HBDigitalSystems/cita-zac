import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import {
  MapPin,
  Star,
  Video,
  Calendar,
  Clock,
  GraduationCap,
  Languages,
  ShieldCheck,
  CheckCircle2,
  Phone,
  MessageCircle,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { getDoctor, type Doctor } from "@/lib/mock-data";

export const Route = createFileRoute("/medicos/$id")({
  loader: ({ params }): { doctor: Doctor } => {
    const doctor = getDoctor(params.id);
    if (!doctor) throw notFound();
    return { doctor };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [
          { title: "Médico no encontrado · DoctorCita" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const d = loaderData.doctor;
    const title = `${d.nombre} · ${d.especialidad} en ${d.municipio} | DoctorCita`;
    const desc = `Agenda tu cita con ${d.nombre}, ${d.especialidad} en ${d.municipio}. ${d.rating}★ (${d.reseñas} opiniones). Consulta desde $${d.precio} MXN.`;
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
        { property: "og:type", content: "profile" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: DoctorProfile,
  notFoundComponent: () => (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center px-4 text-center">
        <h1 className="text-2xl font-semibold text-secondary">
          Médico no encontrado
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          El perfil que buscas no existe o fue movido.
        </p>
        <Button asChild className="mt-6">
          <Link to="/medicos">Ver todos los médicos</Link>
        </Button>
      </div>
      <SiteFooter />
    </div>
  ),
  errorComponent: ({ reset }) => (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center px-4 text-center">
        <h1 className="text-xl font-semibold text-secondary">
          Ocurrió un problema
        </h1>
        <Button onClick={reset} className="mt-6">
          Intentar de nuevo
        </Button>
      </div>
      <SiteFooter />
    </div>
  ),
});

function DoctorProfile() {
  const { doctor } = Route.useLoaderData() as { doctor: Doctor };
  const [selectedDay, setSelectedDay] = useState(0);

  const slotsDia = ["09:00", "09:30", "10:30", "11:00", "12:00", "16:30", "17:00", "18:30"];
  const dias = ["Hoy", "Mañana", "Jue 24", "Vie 25", "Sáb 26"];

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <SiteHeader />

      <div className="border-b border-border bg-background">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Link to="/" className="hover:text-foreground">Inicio</Link>
            <ChevronRight className="h-3 w-3" />
            <Link to="/medicos" className="hover:text-foreground">Médicos</Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground">{doctor.especialidad}</span>
          </nav>
        </div>
      </div>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
        <Link
          to="/medicos"
          className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Volver a resultados
        </Link>

        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          {/* Main content */}
          <div className="space-y-6">
            {/* Header card */}
            <section className="rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8">
              <div className="flex flex-col gap-6 sm:flex-row">
                <img
                  src={doctor.fotoUrl}
                  alt={doctor.nombre}
                  width={144}
                  height={144}
                  className="h-32 w-32 shrink-0 rounded-3xl border border-border bg-primary-soft object-cover sm:h-36 sm:w-36"
                />
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h1 className="text-2xl font-semibold tracking-tight text-secondary sm:text-3xl">
                        {doctor.nombre}
                      </h1>
                      <p className="mt-1 text-base font-medium text-primary">
                        {doctor.especialidad}
                      </p>
                    </div>
                    <Badge className="hidden gap-1 bg-success/10 text-success hover:bg-success/10 sm:inline-flex">
                      <ShieldCheck className="h-3 w-3" /> Verificado
                    </Badge>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                    <span className="inline-flex items-center gap-1.5">
                      <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                      <span className="font-semibold text-secondary">
                        {doctor.rating}
                      </span>
                      <span className="text-muted-foreground">
                        · {doctor.reseñas} opiniones
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <MapPin className="h-4 w-4" />
                      {doctor.municipio}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      {doctor.añosExperiencia} años de experiencia
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
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
                    <Badge variant="outline">Cédula {doctor.cedula}</Badge>
                  </div>
                </div>
              </div>
            </section>

            {/* Tabs content */}
            <Tabs defaultValue="sobre">
              <TabsList className="flex w-full flex-wrap justify-start gap-1 rounded-xl bg-card p-1">
                <TabsTrigger value="sobre">Sobre el médico</TabsTrigger>
                <TabsTrigger value="servicios">Servicios</TabsTrigger>
                <TabsTrigger value="consultorio">Consultorio</TabsTrigger>
                <TabsTrigger value="opiniones">Opiniones</TabsTrigger>
              </TabsList>

              <TabsContent value="sobre" className="mt-4 space-y-6">
                <section className="rounded-2xl border border-border bg-card p-6">
                  <h2 className="text-base font-semibold text-secondary">
                    Biografía
                  </h2>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {doctor.biografia}
                  </p>
                </section>

                <section className="rounded-2xl border border-border bg-card p-6">
                  <h2 className="flex items-center gap-2 text-base font-semibold text-secondary">
                    <GraduationCap className="h-4 w-4 text-primary" />
                    Formación
                  </h2>
                  <ul className="mt-4 space-y-4">
                    {doctor.educacion.map((e) => (
                      <li key={e.titulo} className="border-l-2 border-primary/30 pl-4">
                        <div className="text-sm font-semibold text-secondary">
                          {e.titulo}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {e.institucion} · {e.año}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="grid gap-6 sm:grid-cols-2">
                  <div className="rounded-2xl border border-border bg-card p-6">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-secondary">
                      <Languages className="h-4 w-4 text-primary" /> Idiomas
                    </h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {doctor.idiomas.map((i) => (
                        <Badge key={i} variant="outline" className="font-normal">
                          {i}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-6">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-secondary">
                      <ShieldCheck className="h-4 w-4 text-primary" /> Aseguradoras
                    </h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {doctor.aseguradoras.length > 0 ? (
                        doctor.aseguradoras.map((a) => (
                          <Badge key={a} variant="outline" className="font-normal">
                            {a}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          Consultar directamente
                        </span>
                      )}
                    </div>
                  </div>
                </section>
              </TabsContent>

              <TabsContent value="servicios" className="mt-4">
                <section className="rounded-2xl border border-border bg-card p-6">
                  <h2 className="text-base font-semibold text-secondary">
                    Servicios y tratamientos
                  </h2>
                  <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                    {doctor.servicios.map((s) => (
                      <li
                        key={s}
                        className="flex items-start gap-2 rounded-xl border border-border/60 bg-surface p-3 text-sm"
                      >
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </TabsContent>

              <TabsContent value="consultorio" className="mt-4">
                <section className="rounded-2xl border border-border bg-card p-6">
                  <h2 className="text-base font-semibold text-secondary">
                    Consultorio principal
                  </h2>
                  <div className="mt-4 grid gap-4 sm:grid-cols-[1.2fr_1fr]">
                    <div>
                      <div className="text-sm font-medium text-secondary">
                        {doctor.consultorio}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {doctor.direccion} · {doctor.municipio}, Zacatecas
                      </p>
                      <div className="mt-4">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Horarios
                        </h4>
                        <ul className="mt-2 divide-y divide-border/60 text-sm">
                          {doctor.horarios.map((h) => (
                            <li
                              key={h.dia}
                              className="flex items-center justify-between py-2"
                            >
                              <span className="font-medium text-secondary">
                                {h.dia}
                              </span>
                              <span className="text-muted-foreground">
                                {h.rango}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                    <div className="flex h-full min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-border bg-surface text-sm text-muted-foreground">
                      <div className="text-center">
                        <MapPin className="mx-auto h-6 w-6 text-primary" />
                        <div className="mt-2">Mapa disponible próximamente</div>
                      </div>
                    </div>
                  </div>
                </section>
              </TabsContent>

              <TabsContent value="opiniones" className="mt-4 space-y-4">
                <div className="rounded-2xl border border-border bg-card p-6">
                  <div className="flex items-center gap-6">
                    <div>
                      <div className="text-4xl font-semibold text-secondary">
                        {doctor.rating}
                      </div>
                      <div className="mt-1 flex items-center gap-0.5 text-amber-400">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star
                            key={i}
                            className={`h-4 w-4 ${i < Math.round(doctor.rating) ? "fill-current" : ""}`}
                          />
                        ))}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {doctor.reseñas} opiniones verificadas
                      </div>
                    </div>
                  </div>
                </div>

                {[
                  {
                    n: "Ana G.",
                    d: "hace 2 semanas",
                    c: "Excelente atención, muy profesional y explica todo con paciencia. El consultorio es muy limpio y llegó puntual.",
                  },
                  {
                    n: "Luis R.",
                    d: "hace 1 mes",
                    c: "Muy recomendable. Diagnóstico acertado y seguimiento cercano por WhatsApp. La receta llegó por correo el mismo día.",
                  },
                  {
                    n: "Marisol T.",
                    d: "hace 2 meses",
                    c: "Trato humano, escucha con atención y no te apresura. Volvería sin dudarlo.",
                  },
                ].map((r) => (
                  <div
                    key={r.n}
                    className="rounded-2xl border border-border bg-card p-6"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold text-secondary">
                          {r.n}
                        </div>
                        <div className="text-xs text-muted-foreground">{r.d}</div>
                      </div>
                      <div className="flex items-center gap-0.5 text-amber-400">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <Star key={i} className="h-3.5 w-3.5 fill-current" />
                        ))}
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {r.c}
                    </p>
                  </div>
                ))}
              </TabsContent>
            </Tabs>
          </div>

          {/* Sticky booking sidebar */}
          <aside>
            <div className="sticky top-24 space-y-4">
              <div className="rounded-3xl border border-border bg-card p-6 shadow-elevated">
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Consulta desde
                    </div>
                    <div className="text-2xl font-semibold text-secondary">
                      ${doctor.precio.toLocaleString("es-MX")}{" "}
                      <span className="text-sm font-normal text-muted-foreground">
                        MXN
                      </span>
                    </div>
                  </div>
                  <Badge variant="secondary" className="bg-success/10 text-success hover:bg-success/10">
                    Disponible
                  </Badge>
                </div>

                <div className="mt-6">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Elige día
                  </div>
                  <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
                    {dias.map((d, i) => (
                      <button
                        key={d}
                        onClick={() => setSelectedDay(i)}
                        className={`flex min-w-[68px] flex-col items-center rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                          selectedDay === i
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-surface text-foreground hover:border-primary/40"
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Horarios disponibles
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {slotsDia.map((s) => (
                      <button
                        key={s}
                        className="rounded-lg border border-border bg-surface py-2 text-sm font-medium text-secondary transition-colors hover:border-primary hover:bg-primary hover:text-primary-foreground"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <Button className="mt-6 w-full gap-2" size="lg">
                  <Calendar className="h-4 w-4" />
                  Reservar cita
                </Button>

                {doctor.telemedicina && (
                  <Button variant="outline" className="mt-2 w-full gap-2" size="lg">
                    <Video className="h-4 w-4" />
                    Reservar videoconsulta
                  </Button>
                )}

                <div className="mt-6 grid grid-cols-2 gap-2 border-t border-border pt-4 text-xs">
                  <button className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border py-2 font-medium text-secondary hover:border-primary hover:text-primary">
                    <Phone className="h-3.5 w-3.5" /> Llamar
                  </button>
                  <button className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border py-2 font-medium text-secondary hover:border-primary hover:text-primary">
                    <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-border bg-card p-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-2 font-medium text-secondary">
                  <ShieldCheck className="h-4 w-4 text-success" />
                  Reserva protegida
                </div>
                <p className="mt-1.5">
                  Sin cargo por cancelación hasta 24 h antes de tu cita.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
