import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
  Heart,
  Share2,
  Check,
  Accessibility,
  CarFront,
  Loader2,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/store/auth";
import { DoctorReviews } from "@/components/doctor-reviews";
import { MessageDoctorButton } from "@/components/message-doctor-button";
import { SocialLinks } from "@/components/social-links";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/hooks/use-hydrated";
import { useShortlist } from "@/store/doctor-shortlist";
import {
  doctorDisplayName,
  formatPrice,
  formatTime,
  primaryRoom,
  weekdayName,
} from "@/lib/doctor-format";
import { getDoctorBySlug, type DoctorDetail } from "@/services/doctors";
import {
  bookAppointment,
  formatSlotTime,
  getAvailableSlots,
  groupByDay,
  type Slot,
} from "@/services/appointments";

export const Route = createFileRoute("/medicos/$id")({
  loader: async ({ params }): Promise<{ doctor: DoctorDetail }> => {
    const doctor = await getDoctorBySlug(params.id);
    // El RLS ya filtra por visibilidad: si no llega nada es porque no existe o
    // porque ese perfil no es público. Desde fuera son el mismo caso, y así no
    // se revela la existencia de perfiles sin publicar.
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

    const doctor = loaderData.doctor;
    const name = doctorDisplayName(doctor);
    const specialty = doctor.specialty?.name ?? "Medicina";
    const municipality = primaryRoom(doctor)?.municipality.name ?? "Zacatecas";
    const price = formatPrice(doctor.profile.price_in_person_cents, doctor.profile.currency);

    const title = `${name} · ${specialty} en ${municipality} | DoctorCita`;
    const description = `Agenda tu cita con ${name}, ${specialty} en ${municipality}. ${doctor.rating_average}★ (${doctor.reviews_count} opiniones). Consulta desde ${price}.`;

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "profile" },
        { property: "og:image", content: doctor.profile.photo_url ?? "" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: DoctorProfile,
  notFoundComponent: () => (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center px-4 text-center">
        <h1 className="text-2xl font-semibold text-secondary">Médico no encontrado</h1>
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
        <h1 className="text-xl font-semibold text-secondary">Ocurrió un problema</h1>
        <Button onClick={reset} className="mt-6">
          Intentar de nuevo
        </Button>
      </div>
      <SiteFooter />
    </div>
  ),
});

function DoctorProfile() {
  const { doctor } = Route.useLoaderData();
  const hydrated = useHydrated();
  const { favorites, toggleFavorite } = useShortlist();

  const [selectedDay, setSelectedDay] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [copied, setCopied] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);

  const name = doctorDisplayName(doctor);
  const room = primaryRoom(doctor);

  // La disponibilidad la calcula PostgreSQL, no el navegador: hay que descontar
  // las citas ya tomadas, y esas el paciente no puede leerlas.
  const availability = useQuery({
    queryKey: ["availability", doctor.id, room?.id],
    queryFn: () => getAvailableSlots(doctor.id, room!.id, 14),
    enabled: Boolean(room?.id),
  });

  const agenda = useMemo(() => groupByDay(availability.data ?? []), [availability.data]);
  const currentDay = agenda[selectedDay];

  const isFavorite = hydrated && favorites.includes(doctor.slug);

  const handleShare = async () => {
    const url = window.location.href;
    const shareData = {
      title: name,
      text: `${name} · ${doctor.specialty?.name} en ${room?.municipality.name}`,
      url,
    };

    // En móvil abre la hoja de compartir del sistema; en escritorio se copia.
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // El usuario canceló: no es un error que deba reportarse.
        return;
      }
    }

    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <SiteHeader />

      {/* Datos estructurados para buscadores (PRD Fase 12). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Physician",
            name,
            medicalSpecialty: doctor.specialty?.name,
            image: doctor.profile.photo_url,
            description: doctor.profile.biography,
            aggregateRating: {
              "@type": "AggregateRating",
              ratingValue: doctor.rating_average,
              reviewCount: doctor.reviews_count,
              bestRating: 5,
            },
            address: room
              ? {
                  "@type": "PostalAddress",
                  streetAddress: room.address,
                  addressLocality: room.municipality.name,
                  addressRegion: "Zacatecas",
                  addressCountry: "MX",
                }
              : undefined,
          }),
        }}
      />

      <div className="border-b border-border bg-background">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <nav
            aria-label="Ruta de navegación"
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <Link to="/" className="hover:text-foreground">
              Inicio
            </Link>
            <ChevronRight className="h-3 w-3" />
            <Link to="/medicos" className="hover:text-foreground">
              Médicos
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground">{doctor.specialty?.name}</span>
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
          <div className="space-y-6">
            <section className="rounded-3xl border border-border bg-card p-6 shadow-soft sm:p-8">
              <div className="flex flex-col gap-6 sm:flex-row">
                <img
                  src={doctor.profile.photo_url ?? ""}
                  alt={name}
                  width={144}
                  height={144}
                  className="h-32 w-32 shrink-0 rounded-3xl border border-border bg-primary-soft object-cover sm:h-36 sm:w-36"
                />
                <div className="flex-1">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h1 className="text-2xl font-semibold tracking-tight text-secondary sm:text-3xl">
                        {name}
                      </h1>
                      <p className="mt-1 text-base font-medium text-primary">
                        {doctor.specialty?.name}
                      </p>
                      {doctor.profile.headline && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {doctor.profile.headline}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleFavorite(doctor.slug)}
                        aria-pressed={isFavorite}
                        aria-label={isFavorite ? "Quitar de favoritos" : "Guardar en favoritos"}
                        title={isFavorite ? "Quitar de favoritos" : "Guardar en favoritos"}
                      >
                        <Heart
                          className={cn("h-5 w-5", isFavorite && "fill-rose-500 text-rose-500")}
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleShare}
                        aria-label="Compartir perfil"
                        title={copied ? "Enlace copiado" : "Compartir perfil"}
                      >
                        {copied ? (
                          <Check className="h-5 w-5 text-success" />
                        ) : (
                          <Share2 className="h-5 w-5" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                    <span className="inline-flex items-center gap-1.5">
                      <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                      <span className="font-semibold text-secondary">{doctor.rating_average}</span>
                      <span className="text-muted-foreground">
                        · {doctor.reviews_count} opiniones
                      </span>
                    </span>
                    {room && (
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <MapPin className="h-4 w-4" />
                        {room.municipality.name}
                      </span>
                    )}
                    {doctor.years_of_experience !== null && (
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        {doctor.years_of_experience} años de experiencia
                      </span>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {doctor.status === "verified" && (
                      <Badge className="gap-1 bg-success/10 text-success hover:bg-success/10">
                        <ShieldCheck className="h-3 w-3" /> Verificado
                      </Badge>
                    )}
                    {doctor.profile.offers_telemedicine && (
                      <Badge
                        variant="secondary"
                        className="gap-1 bg-primary-soft text-primary hover:bg-primary-soft"
                      >
                        <Video className="h-3 w-3" /> Videoconsulta
                      </Badge>
                    )}
                    {doctor.profile.accepts_new_patients && (
                      <Badge
                        variant="secondary"
                        className="bg-success/10 text-success hover:bg-success/10"
                      >
                        Acepta nuevos pacientes
                      </Badge>
                    )}
                    <Badge variant="outline">Cédula {doctor.license_number}</Badge>
                  </div>
                </div>
              </div>
            </section>

            <Tabs defaultValue="sobre">
              <TabsList className="flex w-full flex-wrap justify-start gap-1 rounded-xl bg-card p-1">
                <TabsTrigger value="sobre">Sobre el médico</TabsTrigger>
                <TabsTrigger value="servicios">Servicios</TabsTrigger>
                <TabsTrigger value="consultorio">
                  {doctor.consulting_rooms.length > 1 ? "Consultorios" : "Consultorio"}
                </TabsTrigger>
                <TabsTrigger value="opiniones">Opiniones</TabsTrigger>
              </TabsList>

              <TabsContent value="sobre" className="mt-4 space-y-6">
                <section className="rounded-2xl border border-border bg-card p-6">
                  <h2 className="text-base font-semibold text-secondary">Biografía</h2>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {doctor.profile.biography}
                  </p>
                </section>

                <section className="rounded-2xl border border-border bg-card p-6">
                  <h2 className="flex items-center gap-2 text-base font-semibold text-secondary">
                    <GraduationCap className="h-4 w-4 text-primary" />
                    Formación
                  </h2>
                  <ul className="mt-4 space-y-4">
                    {doctor.certifications.map((certification) => (
                      <li key={certification.id} className="border-l-2 border-primary/30 pl-4">
                        <div className="text-sm font-semibold text-secondary">
                          {certification.title}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {certification.issuing_body} · {certification.issued_year}
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
                      {doctor.languages.map((language) => (
                        <Badge key={language.id} variant="outline" className="font-normal">
                          {language.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-6">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-secondary">
                      <ShieldCheck className="h-4 w-4 text-primary" /> Aseguradoras
                    </h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {doctor.insurances.length > 0 ? (
                        doctor.insurances.map((insurance) => (
                          <Badge key={insurance.id} variant="outline" className="font-normal">
                            {insurance.name}
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
                    {doctor.services.map((service) => (
                      <li
                        key={service.id}
                        className="flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-surface p-3 text-sm"
                      >
                        <span className="flex items-start gap-2">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span>{service.name}</span>
                        </span>
                        {service.price_cents !== null && (
                          <span className="shrink-0 text-xs font-medium text-muted-foreground">
                            {formatPrice(service.price_cents, doctor.profile.currency)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              </TabsContent>

              <TabsContent value="consultorio" className="mt-4 space-y-4">
                {doctor.consulting_rooms.map((consultingRoom) => (
                  <section
                    key={consultingRoom.id}
                    className="rounded-2xl border border-border bg-card p-6"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-base font-semibold text-secondary">
                        {consultingRoom.name}
                      </h2>
                      {consultingRoom.is_primary && doctor.consulting_rooms.length > 1 && (
                        <Badge variant="secondary">Principal</Badge>
                      )}
                    </div>

                    <div className="mt-4 grid gap-4 sm:grid-cols-[1.2fr_1fr]">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          {consultingRoom.address}
                          {consultingRoom.address_details && ` · ${consultingRoom.address_details}`}
                          <br />
                          {consultingRoom.municipality.name}, Zacatecas
                        </p>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {consultingRoom.has_parking && (
                            <Badge variant="outline" className="gap-1 font-normal">
                              <CarFront className="h-3 w-3" /> Estacionamiento
                            </Badge>
                          )}
                          {consultingRoom.is_accessible && (
                            <Badge variant="outline" className="gap-1 font-normal">
                              <Accessibility className="h-3 w-3" /> Accesible
                            </Badge>
                          )}
                        </div>

                        {consultingRoom.is_primary && doctor.working_hours.length > 0 && (
                          <div className="mt-4">
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                              Horarios
                            </h3>
                            <ul className="mt-2 divide-y divide-border/60 text-sm">
                              {doctor.working_hours.map((block) => (
                                <li
                                  key={block.id}
                                  className="flex items-center justify-between py-2"
                                >
                                  <span className="font-medium text-secondary">
                                    {weekdayName(block.weekday)}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {formatTime(block.start_time)} – {formatTime(block.end_time)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>

                      <div className="flex h-full min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-border bg-surface text-sm text-muted-foreground">
                        <div className="text-center">
                          <MapPin className="mx-auto h-6 w-6 text-primary" />
                          <div className="mt-2">Mapa disponible próximamente</div>
                        </div>
                      </div>
                    </div>
                  </section>
                ))}
              </TabsContent>

              <TabsContent value="opiniones" className="mt-4 space-y-4">
                <DoctorReviews doctorId={doctor.id} />
              </TabsContent>
            </Tabs>
          </div>

          <aside>
            <div className="sticky top-24 space-y-4">
              <div className="rounded-3xl border border-border bg-card p-6 shadow-elevated">
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      Consulta desde
                    </div>
                    <div className="text-2xl font-semibold text-secondary">
                      {formatPrice(doctor.profile.price_in_person_cents, doctor.profile.currency)}
                    </div>
                  </div>
                  {doctor.profile.accepts_new_patients ? (
                    <Badge
                      variant="secondary"
                      className="bg-success/10 text-success hover:bg-success/10"
                    >
                      Disponible
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Agenda llena</Badge>
                  )}
                </div>

                <div className="mt-6">
                  {availability.isLoading ? (
                    <div className="space-y-3" aria-hidden="true">
                      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                      <div className="flex gap-1">
                        {Array.from({ length: 4 }).map((_, i) => (
                          <div key={i} className="h-12 w-16 animate-pulse rounded-xl bg-muted" />
                        ))}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {Array.from({ length: 6 }).map((_, i) => (
                          <div key={i} className="h-9 animate-pulse rounded-lg bg-muted" />
                        ))}
                      </div>
                    </div>
                  ) : agenda.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border bg-surface p-4 text-center text-sm text-muted-foreground">
                      No hay horarios disponibles en las próximas dos semanas. Puedes llamar al
                      consultorio para consultar.
                    </p>
                  ) : (
                    <>
                      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Elige día
                      </div>
                      <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
                        {agenda.map((day, index) => (
                          <button
                            key={day.date}
                            onClick={() => {
                              setSelectedDay(index);
                              setSelectedSlot(null);
                            }}
                            aria-pressed={selectedDay === index}
                            className={cn(
                              "flex min-w-[68px] flex-col items-center rounded-xl border px-3 py-2 text-xs font-medium transition-colors",
                              selectedDay === index
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-surface text-foreground hover:border-primary/40",
                            )}
                          >
                            <span>{day.label}</span>
                            <span className="mt-0.5 text-[10px] opacity-70">
                              {day.slots.length} libres
                            </span>
                          </button>
                        ))}
                      </div>

                      <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Horarios disponibles
                      </div>

                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {(currentDay?.slots ?? []).map((slot) => (
                          <button
                            key={slot.start}
                            onClick={() => setSelectedSlot(slot)}
                            aria-pressed={selectedSlot?.start === slot.start}
                            className={cn(
                              "rounded-lg border py-2 text-sm font-medium transition-colors",
                              selectedSlot?.start === slot.start
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border bg-surface text-secondary hover:border-primary hover:bg-primary hover:text-primary-foreground",
                            )}
                          >
                            {formatSlotTime(slot.start)}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <Button
                  className="mt-6 w-full gap-2"
                  size="lg"
                  disabled={!selectedSlot}
                  onClick={() => setBookingOpen(true)}
                >
                  <Calendar className="h-4 w-4" />
                  {selectedSlot
                    ? `Reservar ${currentDay?.label} ${formatSlotTime(selectedSlot.start)}`
                    : "Elige un horario"}
                </Button>

                {doctor.profile.offers_telemedicine && (
                  <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
                    <Video className="h-3.5 w-3.5 text-primary" />
                    También atiende por videollamada
                    {doctor.profile.price_video_cents !== null &&
                      ` · ${formatPrice(doctor.profile.price_video_cents, doctor.profile.currency)}`}
                  </p>
                )}

                <div className="mt-6 grid grid-cols-2 gap-2 border-t border-border pt-4 text-xs">
                  <a
                    href={room?.phone ? `tel:${room.phone}` : undefined}
                    className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border py-2 font-medium text-secondary hover:border-primary hover:text-primary"
                  >
                    <Phone className="h-3.5 w-3.5" /> Llamar
                  </a>
                  {/* Antes había aquí un botón de WhatsApp sin acción: no
                      llevaba a ninguna parte. El chat interno sí existe, y
                      además deja la conversación dentro del perímetro que
                      protege el RLS en vez de en un teléfono personal. */}
                  <MessageDoctorButton doctorId={doctor.id} />
                </div>

                <SocialLinks
                  facebookUrl={doctor.profile.facebook_url}
                  instagramUrl={doctor.profile.instagram_url}
                  nombre={name}
                />

                {doctor.profile.cancellation_policy && (
                  <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                    {doctor.profile.cancellation_policy}
                  </p>
                )}
              </div>
            </div>
          </aside>
        </div>
      </main>

      {selectedSlot && room && (
        <BookingDialog
          open={bookingOpen}
          onOpenChange={setBookingOpen}
          doctor={doctor}
          roomId={room.id}
          slot={selectedSlot}
          dayLabel={currentDay?.label ?? ""}
          onBooked={() => {
            setSelectedSlot(null);
            void availability.refetch();
          }}
          onSlotTaken={() => {
            setSelectedSlot(null);
            void availability.refetch();
          }}
        />
      )}

      <SiteFooter />
    </div>
  );
}

/**
 * Confirmación de la reserva.
 *
 * Antes de escribir nada comprueba dos requisitos: que haya sesión y que exista
 * un expediente de paciente. Sin el segundo, el `insert` fallaría por clave
 * foránea con un error que no dice nada — es mejor detectarlo aquí y llevar a
 * completar el perfil.
 */
function BookingDialog({
  open,
  onOpenChange,
  doctor,
  roomId,
  slot,
  dayLabel,
  onBooked,
  onSlotTaken,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doctor: DoctorDetail;
  roomId: string;
  slot: Slot;
  dayLabel: string;
  onBooked: () => void;
  onSlotTaken: () => void;
}) {
  const { status, user } = useAuth();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ reference: string } | null>(null);

  const patient = useQuery({
    queryKey: ["my-patient-id", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("patients")
        .select("id")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
    enabled: Boolean(user?.id) && open,
  });

  const handleBook = async () => {
    if (!patient.data) return;
    setSaving(true);
    setError(null);

    const result = await bookAppointment({
      patientId: patient.data.id,
      doctorId: doctor.id,
      roomId,
      slot,
      modality: "in_person",
      reason,
      priceCents: doctor.profile.price_in_person_cents,
      isFirstVisit: true,
    });

    setSaving(false);

    if (!result.ok) {
      setError(result.message);
      if (result.reason === "taken") onSlotTaken();
      return;
    }

    setConfirmed({ reference: result.reference });
    onBooked();
  };

  const when = `${dayLabel} ${formatSlotTime(slot.start)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        {confirmed ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Check className="h-5 w-5 text-success" />
                Cita reservada
              </DialogTitle>
              <DialogDescription>
                Tu folio es <strong className="font-mono">{confirmed.reference}</strong>. Guárdalo
                para cualquier consulta.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-xl border border-border bg-surface p-4 text-sm">
              <p className="font-medium text-secondary">{doctorDisplayName(doctor)}</p>
              <p className="mt-1 text-muted-foreground">{when}</p>
              <p className="mt-1 text-muted-foreground">{primaryRoom(doctor)?.address}</p>
            </div>

            <div className="flex gap-2">
              <Button asChild className="flex-1">
                <Link to="/panel/paciente">Ver mis citas</Link>
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cerrar
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Confirma tu cita</DialogTitle>
              <DialogDescription>
                {doctorDisplayName(doctor)} · {when}
              </DialogDescription>
            </DialogHeader>

            {status !== "authenticated" ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Necesitas una cuenta para reservar. Es rápido y te sirve para gestionar tus citas
                  después.
                </p>
                <div className="flex gap-2">
                  <Button asChild className="flex-1">
                    <Link to="/entrar" search={{ redirect: `/medicos/${doctor.slug}` }}>
                      Iniciar sesión
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="flex-1">
                    <Link to="/registro" search={{ rol: "patient" }}>
                      Crear cuenta
                    </Link>
                  </Button>
                </div>
              </div>
            ) : patient.isLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Comprobando tu perfil…
              </div>
            ) : !patient.data ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Antes de tu primera cita necesitamos tu expediente básico: alergias, tipo de
                  sangre y contacto de urgencia. Son dos minutos.
                </p>
                <Button asChild className="w-full">
                  <Link to="/onboarding/paciente">Completar mi perfil</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-surface p-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Consulta</span>
                    <span className="font-medium text-secondary">
                      {formatPrice(doctor.profile.price_in_person_cents, doctor.profile.currency)}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span className="text-muted-foreground">Dónde</span>
                    <span className="max-w-[60%] text-right text-secondary">
                      {primaryRoom(doctor)?.address}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reason">Motivo de la consulta</Label>
                  <Textarea
                    id="reason"
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Cuéntale brevemente al médico qué te pasa. Opcional."
                  />
                </div>

                {error && (
                  <p
                    role="alert"
                    className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {error}
                  </p>
                )}

                <p className="text-xs leading-relaxed text-muted-foreground">
                  Podrás cancelar sin costo hasta {doctor.profile.cancellation_hours} horas antes.
                </p>

                <Button className="w-full gap-2" size="lg" onClick={handleBook} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saving ? "Reservando…" : "Confirmar cita"}
                </Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
