import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import {
  Search,
  MapPin,
  SlidersHorizontal,
  Video,
  ChevronRight,
  Star,
  Heart,
  Stethoscope,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { DoctorCard, DoctorCardSkeleton } from "@/components/doctor-card";
import { CompareBar } from "@/components/compare-bar";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useHydrated } from "@/hooks/use-hydrated";
import { useShortlist } from "@/store/doctor-shortlist";
import { doctorDisplayName, formatPrice, primaryRoom } from "@/lib/doctor-format";
import { searchDoctors, type DoctorSearchResult } from "@/services/doctors";
import {
  getInsuranceCompanies,
  getLanguages,
  getMunicipalities,
  getSpecialties,
} from "@/services/catalogs";

const PAGE_SIZE = 8;
const PRICE_MIN = 300;
const PRICE_MAX = 1600;

/** Los catálogos cambian de higos a brevas: no hace falta revalidarlos seguido. */
const CATALOG_STALE_TIME = 1000 * 60 * 60;

const sortSchema = z.enum(["rating", "precio-asc", "precio-desc", "experiencia"]);
type SortKey = z.infer<typeof sortSchema>;

const searchSchema = z.object({
  q: z.string().optional(),
  especialidad: z.string().optional(),
  municipio: z.string().optional(),
  modalidad: z.enum(["presencial", "video"]).optional(),
  sexo: z.enum(["male", "female"]).optional(),
  sort: sortSchema.optional(),
  favoritos: z.boolean().optional(),
});

export const Route = createFileRoute("/medicos/")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Médicos en Zacatecas · Buscar y agendar cita | DoctorCita" },
      {
        name: "description",
        content:
          "Explora médicos de todas las especialidades en Zacatecas. Filtra por municipio, aseguradora, precio y disponibilidad. Reserva tu cita en línea.",
      },
      { property: "og:title", content: "Médicos en Zacatecas | DoctorCita" },
      {
        property: "og:description",
        content: "Encuentra al especialista adecuado y agenda tu cita en minutos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MedicosPage,
});

function MedicosPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const hydrated = useHydrated();
  const { favorites } = useShortlist();

  const [queryInput, setQueryInput] = useState(search.q ?? "");
  const query = useDebouncedValue(queryInput, 300);

  const [specialtySlug, setSpecialtySlug] = useState(search.especialidad ?? "");
  const [municipalitySlug, setMunicipalitySlug] = useState(search.municipio ?? "");
  const [priceRange, setPriceRange] = useState<[number, number]>([PRICE_MIN, PRICE_MAX]);
  const [insuranceIds, setInsuranceIds] = useState<number[]>([]);
  const [languageIds, setLanguageIds] = useState<number[]>([]);
  const [modality, setModality] = useState<"presencial" | "video" | "">(search.modalidad ?? "");
  const [genderFilter, setGenderFilter] = useState<"male" | "female" | "">(search.sexo ?? "");
  const [onlyAcceptingNew, setOnlyAcceptingNew] = useState(false);
  const [onlyFavorites, setOnlyFavorites] = useState(search.favoritos ?? false);
  const [sort, setSort] = useState<SortKey>(search.sort ?? "rating");

  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [compareOpen, setCompareOpen] = useState(false);

  const specialties = useQuery({
    queryKey: ["specialties"],
    queryFn: getSpecialties,
    staleTime: CATALOG_STALE_TIME,
  });
  const municipalities = useQuery({
    queryKey: ["municipalities"],
    queryFn: getMunicipalities,
    staleTime: CATALOG_STALE_TIME,
  });
  const insurances = useQuery({
    queryKey: ["insurance-companies"],
    queryFn: getInsuranceCompanies,
    staleTime: CATALOG_STALE_TIME,
  });
  const languages = useQuery({
    queryKey: ["languages"],
    queryFn: getLanguages,
    staleTime: CATALOG_STALE_TIME,
  });

  // El servicio filtra por identificador de especialidad, no por slug; la
  // traducción se hace aquí porque el catálogo ya está cargado.
  const specialtyId = specialties.data?.find((s) => s.slug === specialtySlug)?.id;

  const doctorsQuery = useQuery({
    queryKey: [
      "doctors",
      {
        query,
        specialtyId,
        municipalitySlug,
        genderFilter,
        modality,
        onlyAcceptingNew,
        priceRange,
        insuranceIds,
        languageIds,
        sort,
      },
    ],
    queryFn: () =>
      searchDoctors({
        query,
        specialtyId,
        municipalitySlug: municipalitySlug || undefined,
        gender: genderFilter || undefined,
        onlyTelemedicine: modality === "video",
        onlyAcceptingNew,
        minPriceCents: priceRange[0] * 100,
        maxPriceCents: priceRange[1] * 100,
        insuranceIds: insuranceIds.length ? insuranceIds : undefined,
        languageIds: languageIds.length ? languageIds : undefined,
        sort,
      }),
    // Mantener la lista anterior mientras llega la nueva evita que la pantalla
    // parpadee en blanco cada vez que se mueve un filtro.
    placeholderData: (previous) => previous,
  });

  // El filtro de favoritos vive solo en el navegador, así que se aplica aquí y
  // no en la consulta.
  const results = useMemo(() => {
    const list = doctorsQuery.data ?? [];
    if (onlyFavorites && hydrated) {
      return list.filter((doctor) => favorites.includes(doctor.slug));
    }
    return list;
  }, [doctorsQuery.data, onlyFavorites, favorites, hydrated]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [results.length, sort]);

  useEffect(() => {
    navigate({
      to: "/medicos",
      search: {
        q: query || undefined,
        especialidad: specialtySlug || undefined,
        municipio: municipalitySlug || undefined,
        modalidad: modality || undefined,
        sexo: genderFilter || undefined,
        sort: sort !== "rating" ? sort : undefined,
        favoritos: onlyFavorites || undefined,
      },
      replace: true,
    });
  }, [
    query,
    specialtySlug,
    municipalitySlug,
    modality,
    genderFilter,
    sort,
    onlyFavorites,
    navigate,
  ]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const hasMore = visibleCount < results.length;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setVisibleCount((count) => count + PAGE_SIZE);
      },
      { rootMargin: "400px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
    // `visibleCount` es dependencia a propósito: el observador solo avisa al
    // CAMBIAR de estado, y sin recrearlo el centinela deja de disparar.
  }, [hasMore, results.length, visibleCount]);

  const visible = results.slice(0, visibleCount);
  const activeSpecialty = specialties.data?.find((s) => s.slug === specialtySlug);
  const activeMunicipality = municipalities.data?.find((m) => m.slug === municipalitySlug);

  const activeFilterCount =
    (specialtySlug ? 1 : 0) +
    (municipalitySlug ? 1 : 0) +
    (modality ? 1 : 0) +
    (genderFilter ? 1 : 0) +
    (onlyAcceptingNew ? 1 : 0) +
    (onlyFavorites ? 1 : 0) +
    insuranceIds.length +
    languageIds.length +
    (priceRange[0] !== PRICE_MIN || priceRange[1] !== PRICE_MAX ? 1 : 0);

  const resetFilters = () => {
    setQueryInput("");
    setSpecialtySlug("");
    setMunicipalitySlug("");
    setPriceRange([PRICE_MIN, PRICE_MAX]);
    setInsuranceIds([]);
    setLanguageIds([]);
    setModality("");
    setGenderFilter("");
    setOnlyAcceptingNew(false);
    setOnlyFavorites(false);
    setSort("rating");
  };

  const filters = (
    <div className="space-y-6">
      <div>
        <Label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Especialidad
        </Label>
        <Select
          value={specialtySlug || "todas"}
          onValueChange={(v) => setSpecialtySlug(v === "todas" ? "" : v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Todas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las especialidades</SelectItem>
            {(specialties.data ?? []).map((specialty) => (
              <SelectItem key={specialty.id} value={specialty.slug}>
                {specialty.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Municipio
        </Label>
        <Select
          value={municipalitySlug || "todos"}
          onValueChange={(v) => setMunicipalitySlug(v === "todos" ? "" : v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los municipios</SelectItem>
            {(municipalities.data ?? []).map((municipality) => (
              <SelectItem key={municipality.id} value={municipality.slug}>
                {municipality.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Precio · ${priceRange[0].toLocaleString("es-MX")} – $
          {priceRange[1].toLocaleString("es-MX")} MXN
        </Label>
        <Slider
          value={priceRange}
          onValueChange={(v) => setPriceRange([v[0], v[1]] as [number, number])}
          min={PRICE_MIN}
          max={PRICE_MAX}
          step={50}
          className="mt-1"
        />
      </div>

      <div>
        <Label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Sexo del profesional
        </Label>
        <Select
          value={genderFilter || "cualquiera"}
          onValueChange={(v) => setGenderFilter(v === "cualquiera" ? "" : (v as "male" | "female"))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cualquiera">Sin preferencia</SelectItem>
            <SelectItem value="female">Mujer</SelectItem>
            <SelectItem value="male">Hombre</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3 rounded-xl border border-border p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Video className="h-4 w-4 text-primary" />
            Solo con videoconsulta
          </div>
          <Switch
            checked={modality === "video"}
            onCheckedChange={(checked) => setModality(checked ? "video" : "")}
            aria-label="Mostrar solo médicos con videoconsulta"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-medium">Acepta nuevos pacientes</div>
          <Switch
            checked={onlyAcceptingNew}
            onCheckedChange={setOnlyAcceptingNew}
            aria-label="Mostrar solo médicos que aceptan nuevos pacientes"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Heart className="h-4 w-4 text-rose-500" />
            Solo mis favoritos
          </div>
          <Switch
            checked={onlyFavorites}
            onCheckedChange={setOnlyFavorites}
            aria-label="Mostrar solo mis médicos favoritos"
          />
        </div>
      </div>

      <fieldset>
        <legend className="mb-3 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Aseguradoras
        </legend>
        <div className="space-y-2">
          {(insurances.data ?? []).slice(0, 8).map((insurance) => (
            <label
              key={insurance.id}
              className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
            >
              <Checkbox
                checked={insuranceIds.includes(insurance.id)}
                onCheckedChange={(checked) =>
                  setInsuranceIds((prev) =>
                    checked ? [...prev, insurance.id] : prev.filter((id) => id !== insurance.id),
                  )
                }
              />
              {insurance.name}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-3 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Idiomas de atención
        </legend>
        <div className="space-y-2">
          {(languages.data ?? []).slice(0, 5).map((language) => (
            <label
              key={language.id}
              className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
            >
              <Checkbox
                checked={languageIds.includes(language.id)}
                onCheckedChange={(checked) =>
                  setLanguageIds((prev) =>
                    checked ? [...prev, language.id] : prev.filter((id) => id !== language.id),
                  )
                }
              />
              {language.name}
            </label>
          ))}
        </div>
      </fieldset>

      <Button variant="outline" className="w-full" onClick={resetFilters}>
        Limpiar filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
      </Button>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <SiteHeader />

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
            <span className="text-foreground">Médicos</span>
            {activeSpecialty && (
              <>
                <ChevronRight className="h-3 w-3" />
                <span className="text-foreground">{activeSpecialty.name}</span>
              </>
            )}
          </nav>

          <div className="mt-4 grid gap-2 md:grid-cols-[1fr_1fr]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder="Buscar por nombre, especialidad o tratamiento"
                aria-label="Buscar médicos"
                className="h-11 pl-10"
              />
            </div>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Select
                value={municipalitySlug || "todos"}
                onValueChange={(v) => setMunicipalitySlug(v === "todos" ? "" : v)}
              >
                <SelectTrigger className="h-11 pl-10" aria-label="Filtrar por municipio">
                  <SelectValue placeholder="Municipio" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos los municipios</SelectItem>
                  {(municipalities.data ?? []).map((municipality) => (
                    <SelectItem key={municipality.id} value={municipality.slug}>
                      {municipality.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[280px_1fr] lg:px-8">
        <aside className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-soft">
            <h2 className="mb-6 text-sm font-semibold text-secondary">Filtros</h2>
            {filters}
          </div>
        </aside>

        <section>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-secondary sm:text-2xl">
                {activeSpecialty ? activeSpecialty.name : "Médicos en Zacatecas"}
                {activeMunicipality && (
                  <span className="text-muted-foreground"> · {activeMunicipality.name}</span>
                )}
              </h1>
              <p aria-live="polite" className="mt-1 text-sm text-muted-foreground">
                {doctorsQuery.isLoading
                  ? "Buscando…"
                  : `${results.length} ${
                      results.length === 1 ? "profesional encontrado" : "profesionales encontrados"
                    }`}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="lg:hidden"
                onClick={() => setMobileFiltersOpen((open) => !open)}
                aria-expanded={mobileFiltersOpen}
              >
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                Filtros
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
              <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                <SelectTrigger className="h-9 w-[190px] text-sm" aria-label="Ordenar resultados">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rating">Mejor calificados</SelectItem>
                  <SelectItem value="precio-asc">Precio: menor a mayor</SelectItem>
                  <SelectItem value="precio-desc">Precio: mayor a menor</SelectItem>
                  <SelectItem value="experiencia">Más experiencia</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {mobileFiltersOpen && (
            <div className="mb-6 rounded-2xl border border-border bg-card p-6 shadow-soft lg:hidden">
              {filters}
            </div>
          )}

          {doctorsQuery.isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <DoctorCardSkeleton key={i} />
              ))}
            </div>
          ) : doctorsQuery.isError ? (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center">
              <p className="text-base font-semibold text-secondary">
                No pudimos cargar el directorio
              </p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                Revisa tu conexión e inténtalo otra vez.
              </p>
              <Button variant="outline" className="mt-6" onClick={() => doctorsQuery.refetch()}>
                Reintentar
              </Button>
            </div>
          ) : results.length === 0 ? (
            <EmptyResults
              onlyFavorites={onlyFavorites}
              hasFilters={activeFilterCount > 0 || query.length > 0}
              onReset={resetFilters}
            />
          ) : (
            <>
              <div className="space-y-4">
                {visible.map((doctor) => (
                  <DoctorCard key={doctor.id} doctor={doctor} />
                ))}
              </div>

              {hasMore && (
                <div ref={sentinelRef} className="mt-4 space-y-4">
                  <DoctorCardSkeleton />
                  <span className="sr-only" aria-live="polite">
                    Cargando más resultados
                  </span>
                </div>
              )}

              {!hasMore && results.length > PAGE_SIZE && (
                <p className="mt-8 text-center text-sm text-muted-foreground">
                  Has visto los {results.length} resultados.
                </p>
              )}
            </>
          )}
        </section>
      </main>

      <div className="h-16" aria-hidden="true" />

      <CompareBar doctors={results} onCompare={() => setCompareOpen(true)} />
      <CompareDialog open={compareOpen} onOpenChange={setCompareOpen} doctors={results} />

      <SiteFooter />
    </div>
  );
}

function EmptyResults({
  onlyFavorites,
  hasFilters,
  onReset,
}: {
  onlyFavorites: boolean;
  hasFilters: boolean;
  onReset: () => void;
}) {
  // Sin filtros y sin resultados, el directorio está vacío de verdad. Decir
  // "prueba con menos filtros" ahí sería absurdo: no hay ninguno puesto.
  if (!hasFilters && !onlyFavorites) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary">
          <Stethoscope className="h-6 w-6" />
        </div>
        <p className="mt-4 text-base font-semibold text-secondary">
          Todavía no hay médicos publicados
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Estamos dando de alta a los primeros profesionales de Zacatecas. Si eres médico, tu perfil
          puede ser de los primeros en aparecer.
        </p>
        <Button asChild className="mt-6">
          <Link to="/registro" search={{ rol: "doctor" }}>
            Registrar mi consultorio
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
      <p className="text-base font-semibold text-secondary">
        {onlyFavorites ? "Todavía no has guardado ningún médico" : "No encontramos resultados"}
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        {onlyFavorites
          ? "Pulsa el corazón en cualquier médico para guardarlo y encontrarlo después aquí."
          : "Prueba con menos filtros, amplía el rango de precio o cambia de municipio."}
      </p>
      <Button variant="outline" className="mt-6" onClick={onReset}>
        Limpiar filtros
      </Button>
    </div>
  );
}

function CompareDialog({
  open,
  onOpenChange,
  doctors,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doctors: DoctorSearchResult[];
}) {
  const { compare } = useShortlist();
  const selected = compare
    .map((slug) => doctors.find((doctor) => doctor.slug === slug))
    .filter((doctor): doctor is DoctorSearchResult => doctor !== undefined);

  if (selected.length === 0) return null;

  const rows: { label: string; render: (d: DoctorSearchResult) => React.ReactNode }[] = [
    { label: "Especialidad", render: (d) => d.specialty?.name ?? "—" },
    {
      label: "Calificación",
      render: (d) =>
        d.reviews_count > 0 ? (
          <span className="inline-flex items-center gap-1">
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            {d.rating_average} <span className="text-muted-foreground">({d.reviews_count})</span>
          </span>
        ) : (
          "Sin opiniones"
        ),
    },
    {
      label: "Consulta presencial",
      render: (d) => formatPrice(d.profile?.price_in_person_cents, d.profile?.currency),
    },
    {
      label: "Videoconsulta",
      render: (d) =>
        d.profile?.offers_telemedicine
          ? formatPrice(d.profile.price_video_cents, d.profile.currency)
          : "No ofrece",
    },
    {
      label: "Experiencia",
      render: (d) => (d.years_of_experience ? `${d.years_of_experience} años` : "—"),
    },
    { label: "Municipio", render: (d) => primaryRoom(d)?.municipality?.name ?? "—" },
    {
      label: "Idiomas",
      render: (d) => (d.languages.length ? d.languages.map((l) => l.name).join(", ") : "—"),
    },
    {
      label: "Aseguradoras",
      render: (d) =>
        d.insurances.length > 0 ? d.insurances.map((i) => i.name).join(", ") : "No acepta",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Comparar médicos</DialogTitle>
          <DialogDescription>
            {selected.length} profesionales en paralelo. Los datos provienen de sus perfiles
            públicos.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className="w-40 p-2 text-left" />
                {selected.map((doctor) => (
                  <th key={doctor.slug} scope="col" className="p-2 text-left align-bottom">
                    <Link
                      to="/medicos/$id"
                      params={{ id: doctor.slug }}
                      className="font-semibold text-secondary hover:text-primary"
                    >
                      {doctorDisplayName(doctor)}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-t border-border">
                  <th
                    scope="row"
                    className="p-2 text-left align-top font-medium text-muted-foreground"
                  >
                    {row.label}
                  </th>
                  {selected.map((doctor) => (
                    <td key={doctor.slug} className="p-2 align-top text-foreground">
                      {row.render(doctor)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
