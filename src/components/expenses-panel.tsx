// Control de gastos del panel de administración.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  borrarGasto,
  crearConcepto,
  getConceptos,
  getGastos,
  getMedicosParaGasto,
  getResumen,
  pesos,
  registrarGasto,
} from "@/services/expenses";

/** Primer día del mes en curso y hoy, en el formato que espera un input date. */
function rangoPorDefecto() {
  const hoy = new Date();
  const primero = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { desde: iso(primero), hasta: iso(hoy) };
}

export function ExpensesPanel({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const inicial = useMemo(rangoPorDefecto, []);
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const [nuevoGasto, setNuevoGasto] = useState(false);
  const [nuevoConcepto, setNuevoConcepto] = useState(false);

  const resumen = useQuery({
    queryKey: ["expense-summary", desde, hasta],
    queryFn: () => getResumen(desde, hasta),
  });

  const gastos = useQuery({
    queryKey: ["expenses", desde, hasta],
    queryFn: () => getGastos(desde, hasta),
  });

  const eliminar = useMutation({
    mutationFn: borrarGasto,
    onSuccess: () => {
      toast.success("Gasto eliminado.");
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
      void queryClient.invalidateQueries({ queryKey: ["expense-summary"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No pudimos eliminarlo."),
  });

  const filas = resumen.data ?? [];
  const total = filas.reduce((a, r) => a + r.total_cents, 0);
  const general = filas.find((r) => r.doctor_id === null);
  const porMedico = filas.filter((r) => r.doctor_id !== null);

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-secondary">Gastos</h2>
          <p className="text-sm text-muted-foreground">
            Control de gastos de la clínica y por médico.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="desde" className="text-xs text-muted-foreground">
              Desde
            </Label>
            <Input
              id="desde"
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="h-9 w-[9.5rem]"
            />
          </div>
          <div>
            <Label htmlFor="hasta" className="text-xs text-muted-foreground">
              Hasta
            </Label>
            <Input
              id="hasta"
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="h-9 w-[9.5rem]"
            />
          </div>
          <Button size="sm" className="gap-2" onClick={() => setNuevoGasto(true)}>
            <Plus className="h-4 w-4" />
            Registrar gasto
          </Button>
        </div>
      </div>

      {resumen.isLoading ? (
        <Skeleton className="mt-4 h-28 rounded-2xl" />
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Tarjeta
              icono={<Wallet className="h-4 w-4" />}
              etiqueta="Gasto total del periodo"
              valor={pesos(total)}
              destacada
            />
            <Tarjeta
              icono={<Building2 className="h-4 w-4" />}
              etiqueta="Clínica en general"
              valor={pesos(general?.total_cents ?? 0)}
            />
            <Tarjeta
              icono={<Wallet className="h-4 w-4" />}
              etiqueta="Asignado a médicos"
              valor={pesos(total - (general?.total_cents ?? 0))}
            />
          </div>

          <div className="mt-4 rounded-2xl border border-border bg-card">
            <div className="border-b border-border px-5 py-3">
              <h3 className="text-sm font-semibold text-secondary">Por médico</h3>
            </div>

            {porMedico.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                No hay gastos asignados a ningún médico en este periodo.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {porMedico.map((r) => (
                  <li
                    key={r.doctor_id}
                    className="flex items-center justify-between gap-4 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-secondary">
                        {r.doctor_nombre}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.movimientos} {r.movimientos === 1 ? "movimiento" : "movimientos"}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      {/* La barra da la proporción de un vistazo; el número
                          exacto está al lado para quien lo necesite. */}
                      <div className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-muted sm:block">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${total ? (r.total_cents / total) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="text-sm font-semibold tabular-nums text-secondary">
                        {pesos(r.total_cents)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <div className="mt-4 rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h3 className="text-sm font-semibold text-secondary">Movimientos</h3>
          <button
            type="button"
            onClick={() => setNuevoConcepto(true)}
            className="text-xs text-primary hover:underline"
          >
            Administrar conceptos
          </button>
        </div>

        {gastos.isLoading ? (
          <Skeleton className="m-5 h-20 rounded-xl" />
        ) : (gastos.data ?? []).length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground">
            Sin movimientos en este periodo.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2 font-medium">Fecha</th>
                  <th className="px-5 py-2 font-medium">Concepto</th>
                  <th className="px-5 py-2 font-medium">Categoría</th>
                  <th className="px-5 py-2 font-medium">Asignado a</th>
                  <th className="px-5 py-2 text-right font-medium">Importe</th>
                  <th className="px-5 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(gastos.data ?? []).map((g) => (
                  <tr key={g.id}>
                    <td className="whitespace-nowrap px-5 py-2.5 text-muted-foreground tabular-nums">
                      {new Date(`${g.incurred_on}T12:00:00`).toLocaleDateString("es-MX", {
                        day: "numeric",
                        month: "short",
                      })}
                    </td>
                    <td className="px-5 py-2.5 font-medium text-secondary">{g.concept}</td>
                    <td className="px-5 py-2.5 text-muted-foreground">
                      {g.expense_categories?.name ?? "—"}
                    </td>
                    <td className="px-5 py-2.5 text-muted-foreground">
                      {g.doctor_id
                        ? (g.doctors?.doctor_profiles?.display_name ??
                          g.doctors?.users?.full_name ??
                          "Médico")
                        : "Clínica"}
                    </td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-right font-semibold tabular-nums text-secondary">
                      {pesos(g.amount_cents)}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => eliminar.mutate(g.id)}
                        disabled={eliminar.isPending}
                        aria-label={`Eliminar ${g.concept}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {nuevoGasto && (
        <DialogoGasto userId={userId} abierto onCerrar={() => setNuevoGasto(false)} />
      )}
      {nuevoConcepto && <DialogoConceptos abierto onCerrar={() => setNuevoConcepto(false)} />}
    </section>
  );
}

function Tarjeta({
  icono,
  etiqueta,
  valor,
  destacada,
}: {
  icono: React.ReactNode;
  etiqueta: string;
  valor: string;
  destacada?: boolean;
}) {
  return (
    <div
      className={
        destacada
          ? "rounded-2xl border border-primary/30 bg-primary-soft/40 p-4"
          : "rounded-2xl border border-border bg-card p-4"
      }
    >
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icono}
        {etiqueta}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-secondary">{valor}</p>
    </div>
  );
}

function DialogoGasto({
  userId,
  abierto,
  onCerrar,
}: {
  userId: string;
  abierto: boolean;
  onCerrar: () => void;
}) {
  const queryClient = useQueryClient();
  const [concepto, setConcepto] = useState("");
  const [importe, setImporte] = useState("");
  const [categoria, setCategoria] = useState<string>("");
  const [medico, setMedico] = useState<string>("");
  const [fecha, setFecha] = useState(rangoPorDefecto().hasta);
  const [notas, setNotas] = useState("");

  const conceptos = useQuery({ queryKey: ["expense-categories"], queryFn: () => getConceptos() });
  const medicos = useQuery({ queryKey: ["doctors-for-expense"], queryFn: getMedicosParaGasto });

  const guardar = useMutation({
    mutationFn: () =>
      registrarGasto({
        concept: concepto,
        pesos: Number(importe),
        categoryId: categoria || null,
        // Cadena vacía significa "clínica en general", que es un valor con
        // significado propio, no un campo sin rellenar.
        doctorId: medico || null,
        incurredOn: fecha,
        notes: notas,
        createdBy: userId,
      }),
    onSuccess: () => {
      toast.success("Gasto registrado.");
      void queryClient.invalidateQueries({ queryKey: ["expenses"] });
      void queryClient.invalidateQueries({ queryKey: ["expense-summary"] });
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No pudimos registrarlo."),
  });

  const importeValido = Number(importe) > 0 && Number.isFinite(Number(importe));

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar gasto</DialogTitle>
          <DialogDescription>
            Asígnalo a un médico o déjalo como gasto general de la clínica.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="g-concepto">Concepto</Label>
            <Input
              id="g-concepto"
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              placeholder="Renta de agosto"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="g-importe">Importe (MXN)</Label>
              <Input
                id="g-importe"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={importe}
                onChange={(e) => setImporte(e.target.value)}
                placeholder="2500"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-fecha">Fecha</Label>
              <Input
                id="g-fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="g-categoria">Categoría</Label>
            <select
              id="g-categoria"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Sin categoría</option>
              {(conceptos.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="g-medico">Asignar a</Label>
            <select
              id="g-medico"
              value={medico}
              onChange={(e) => setMedico(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Clínica en general</option>
              {(medicos.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="g-notas">Notas</Label>
            <Textarea
              id="g-notas"
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCerrar} disabled={guardar.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => guardar.mutate()}
            disabled={guardar.isPending || !concepto.trim() || !importeValido}
          >
            {guardar.isPending ? "Guardando…" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogoConceptos({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const queryClient = useQueryClient();
  const [nombre, setNombre] = useState("");

  const conceptos = useQuery({
    queryKey: ["expense-categories", "todos"],
    queryFn: () => getConceptos(false),
  });

  const crear = useMutation({
    mutationFn: () => crearConcepto(nombre),
    onSuccess: () => {
      toast.success("Concepto agregado.");
      setNombre("");
      void queryClient.invalidateQueries({ queryKey: ["expense-categories"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No pudimos agregarlo."),
  });

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Conceptos de gasto</DialogTitle>
          <DialogDescription>
            Agrega los que necesites para clasificar los gastos de tu clínica.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 py-2">
          <Input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Mantenimiento"
            onKeyDown={(e) => {
              if (e.key === "Enter" && nombre.trim()) crear.mutate();
            }}
          />
          <Button onClick={() => crear.mutate()} disabled={crear.isPending || !nombre.trim()}>
            Agregar
          </Button>
        </div>

        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {(conceptos.data ?? []).map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
            >
              <span className="text-secondary">{c.name}</span>
              {!c.is_active && <span className="text-xs text-muted-foreground">Inactivo</span>}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
