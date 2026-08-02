import { X, GitCompare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/use-hydrated";
import { useShortlist, MAX_COMPARE } from "@/store/doctor-shortlist";
import { doctorDisplayName } from "@/lib/doctor-format";
import type { DoctorSearchResult } from "@/services/doctors";

/**
 * Barra fija que aparece al añadir médicos al comparador.
 *
 * Recibe los médicos ya cargados en lugar de buscarlos por su cuenta: la lista
 * de resultados ya los tiene, y volver a consultarlos duplicaría peticiones.
 */
export function CompareBar({
  doctors,
  onCompare,
}: {
  doctors: DoctorSearchResult[];
  onCompare: () => void;
}) {
  const hydrated = useHydrated();
  const { compare, toggleCompare, clearCompare } = useShortlist();

  if (!hydrated || compare.length === 0) return null;

  const selected = compare
    .map((slug) => doctors.find((doctor) => doctor.slug === slug))
    .filter((doctor): doctor is DoctorSearchResult => doctor !== undefined);

  if (selected.length === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 shadow-elevated backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <span className="inline-flex items-center gap-2 text-sm font-medium text-secondary">
          <GitCompare className="h-4 w-4 text-primary" />
          Comparando {selected.length} de {MAX_COMPARE}
        </span>

        <ul className="flex flex-1 flex-wrap items-center gap-2">
          {selected.map((doctor) => (
            <li key={doctor.slug}>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background py-1 pl-3 pr-1 text-sm">
                {doctorDisplayName(doctor)}
                <button
                  type="button"
                  onClick={() => toggleCompare(doctor.slug)}
                  aria-label={`Quitar a ${doctorDisplayName(doctor)} del comparador`}
                  className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={clearCompare}>
            Vaciar
          </Button>
          <Button size="sm" onClick={onCompare} disabled={selected.length < 2}>
            {selected.length < 2 ? "Añade otro médico" : "Ver comparación"}
          </Button>
        </div>
      </div>
    </div>
  );
}
