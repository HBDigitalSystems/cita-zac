import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import {
  Search,
  MapPin,
  SlidersHorizontal,
  Video,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { DoctorCard } from "@/components/doctor-card";
import {
  ESPECIALIDADES,
  MUNICIPIOS,
  DOCTORS,
  ASEGURADORAS,
} from "@/lib/mock-data";

const searchSchema = z.object({
  q: z.string().optional(),
  especialidad: z.string().optional(),
  municipio: z.string().optional(),
  sort: z.enum(["rating", "precio-asc", "precio-desc", "experiencia"]).optional(),
});

export const Route = createFileRoute("/medicos")({
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
        content:
          "Encuentra al especialista adecuado y agenda tu cita en minutos.",
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

  const [q, setQ] = useState(search.q ?? "");
  const [especialidad, setEspecialidad] = useState(search.especialidad ?? "");
  const [municipio, setMunicipio] = useState(search.municipio ?? "");
  const [precio, setPrecio] = useState<[number, number]>([300, 1600]);
  const [aseguradoras, setAseguradoras] = useState<string[]>([]);
  const [soloTele, setSoloTele] = useState(false);
  const [soloAcepta, setSoloAcepta] = useState(false);
  const [sort, setSort] = useState<
    "rating" | "precio-asc" | "precio-desc" | "experiencia"
  >(search.sort ?? "rating");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const resultados = useMemo(() => {
    const filtered = DOCTORS.filter((d) => {
      if (
        q &&
        !`${d.nombre} ${d.especialidad}`.toLowerCase().includes(q.toLowerCase())
      )
        return false;
      if (especialidad && d.especialidad !== especialidad) return false;
      if (municipio && d.municipio !== municipio) return false;
      if (d.precio < precio[0] || d.precio > precio[1]) return false;
      if (soloTele && !d.telemedicina) return false;
      if (soloAcepta && !d.aceptaNuevos) return false;
      if (
        aseguradoras.length > 0 &&
        !aseguradoras.some((a) => d.aseguradoras.includes(a))
      )
        return false;
      return true;
    });

    filtered.sort((a, b) => {
      switch (sort) {
        case "precio-asc":
          return a.precio - b.precio;
        case "precio-desc":
          return b.precio - a.precio;
        case "experiencia":
          return b.añosExperiencia - a.añosExperiencia;
        default:
          return b.rating - a.rating;
      }
    });
    return filtered;
  }, [q, especialidad, municipio, precio, soloTele, soloAcepta, aseguradoras, sort]);

  const applyToUrl = () => {
    navigate({
      search: {
        q: q || undefined,
        especialidad: especialidad || undefined,
        municipio: municipio || undefined,
        sort: sort !== "rating" ? sort : undefined,
      },
    });
  };

  const Filters = (
    <div className="space-y-6">
      <div>
        <Label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Especialidad
        </Label>
        <Select
          value={especialidad || "todas"}
          onValueChange={(v) => setEspecialidad(v === "todas" ? "" : v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Todas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las especialidades</SelectItem>
            {ESPECIALIDADES.map((e) => (
              <SelectItem key={e} value={e}>
                {e}
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
          value={municipio || "todos"}
          onValueChange={(v) => setMunicipio(v === "todos" ? "" : v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los municipios</SelectItem>
            {MUNICIPIOS.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Precio · ${precio[0]} – ${precio[1]} MXN
        </Label>
        <Slider
          value={precio}
          onValueChange={(v) => setPrecio([v[0], v[1]] as [number, number])}
          min={300}
          max={1600}
          step={50}
          className="mt-1"
        />
      </div>

      <div className="space-y-3 rounded-xl border border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Video className="h-4 w-4 text-primary" />
            Solo con videoconsulta
          </div>
          <Switch checked={soloTele} onCheckedChange={setSoloTele} />
        </div>
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Acepta nuevos pacientes</div>
          <Switch checked={soloAcepta} onCheckedChange={setSoloAcepta} />
        </div>
      </div>

      <div>
        <Label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Aseguradoras
        </Label>
        <div className="space-y-2">
          {ASEGURADORAS.slice(0, 8).map((a) => (
            <label
              key={a}
              className="flex cursor-pointer items-center gap-2 text-sm text-foreground"
            >
              <Checkbox
                checked={aseguradoras.includes(a)}
                onCheckedChange={(v) =>
                  setAseguradoras((prev) =>
                    v ? [...prev, a] : prev.filter((x) => x !== a),
                  )
                }
              />
              {a}
            </label>
          ))}
        </div>
      </div>

      <Button
        variant="outline"
        className="w-full"
        onClick={() => {
          setQ("");
          setEspecialidad("");
          setMunicipio("");
          setPrecio([300, 1600]);
          setAseguradoras([]);
          setSoloTele(false);
          setSoloAcepta(false);
          navigate({ search: {} });
        }}
      >
        Limpiar filtros
      </Button>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <SiteHeader />

      <div className="border-b border-border bg-background">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Link to="/" className="hover:text-foreground">
              Inicio
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground">Médicos</span>
            {especialidad && (
              <>
                <ChevronRight className="h-3 w-3" />
                <span className="text-foreground">{especialidad}</span>
              </>
            )}
          </nav>

          <div className="mt-4 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por nombre o especialidad"
                className="h-11 pl-10"
              />
            </div>
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Select
                value={municipio || "todos"}
                onValueChange={(v) => setMunicipio(v === "todos" ? "" : v)}
              >
                <SelectTrigger className="h-11 pl-10">
                  <SelectValue placeholder="Municipio" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos los municipios</SelectItem>
                  {MUNICIPIOS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="h-11 px-6" onClick={applyToUrl}>
              Buscar
            </Button>
          </div>
        </div>
      </div>

      <main className="mx-auto grid w-full max-w-7xl flex-1 gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[280px_1fr] lg:px-8">
        <aside className="hidden lg:block">
          <div className="sticky top-24 rounded-2xl border border-border bg-card p-6 shadow-soft">
            <h3 className="mb-6 text-sm font-semibold text-secondary">
              Filtros
            </h3>
            {Filters}
          </div>
        </aside>

        <section>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-secondary sm:text-2xl">
                {especialidad ? `${especialidad}` : "Médicos en Zacatecas"}
                {municipio && (
                  <span className="text-muted-foreground"> · {municipio}</span>
                )}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {resultados.length}{" "}
                {resultados.length === 1
                  ? "profesional encontrado"
                  : "profesionales encontrados"}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="lg:hidden"
                onClick={() => setMobileFiltersOpen((o) => !o)}
              >
                <SlidersHorizontal className="mr-2 h-4 w-4" /> Filtros
              </Button>
              <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
                <SelectTrigger className="h-9 w-[180px] text-sm">
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
              {Filters}
            </div>
          )}

          {resultados.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
              <p className="text-base font-semibold text-secondary">
                No encontramos resultados
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Prueba ampliando los filtros o cambiando de municipio.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {resultados.map((d) => (
                <DoctorCard key={d.id} doctor={d} />
              ))}
            </div>
          )}
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
