// Expediente clínico del paciente, tal como lo ve su médico tratante.

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Download,
  FileText,
  Loader2,
  Phone,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  TIPOS_DOCUMENTO,
  borrarDocumento,
  getDocumentosDePaciente,
  getNotasDePaciente,
  guardarNota,
  pesoLegible,
  subirDocumento,
  urlDeDocumento,
  type DocumentoClinico,
} from "@/services/clinical";
import type { Enums } from "@/integrations/supabase/types";

export type PacienteDeAgenda = {
  id: string;
  nombre: string;
  edad: number | null;
  tipo_sangre: string | null;
  telefono: string | null;
  alergias: string[];
  cronicos: string[];
  contacto_emergencia: string | null;
  telefono_emergencia: string | null;
  parentesco_emergencia: string | null;
};

function fecha(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function PatientRecord({
  paciente,
  doctorId,
  userId,
  appointmentId,
  abierto,
  onCerrar,
}: {
  paciente: PacienteDeAgenda;
  doctorId: string;
  userId: string;
  appointmentId?: string | null;
  abierto: boolean;
  onCerrar: () => void;
}) {
  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{paciente.nombre}</DialogTitle>
          <DialogDescription>
            {[
              paciente.edad !== null ? `${paciente.edad} años` : null,
              paciente.tipo_sangre,
            ]
              .filter(Boolean)
              .join(" · ") || "Expediente clínico"}
          </DialogDescription>
        </DialogHeader>

        <Urgencias paciente={paciente} />
        <Antecedentes paciente={paciente} />

        <Tabs defaultValue="consultas" className="mt-2">
          <TabsList className="w-full">
            <TabsTrigger value="consultas" className="flex-1">
              Consultas
            </TabsTrigger>
            <TabsTrigger value="estudios" className="flex-1">
              Estudios y análisis
            </TabsTrigger>
          </TabsList>

          <TabsContent value="consultas" className="mt-4">
            <Consultas
              patientId={paciente.id}
              doctorId={doctorId}
              appointmentId={appointmentId}
            />
          </TabsContent>

          <TabsContent value="estudios" className="mt-4">
            <Estudios
              patientId={paciente.id}
              doctorId={doctorId}
              userId={userId}
              appointmentId={appointmentId}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/** Contacto de emergencia, arriba y con el teléfono marcable. */
function Urgencias({ paciente }: { paciente: PacienteDeAgenda }) {
  if (!paciente.telefono_emergencia && !paciente.telefono) return null;

  return (
    <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-400">
        <Phone className="h-3.5 w-3.5" />
        Contacto en caso de emergencia
      </p>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {paciente.telefono_emergencia && (
          <div>
            <p className="text-sm font-medium text-secondary">
              {paciente.contacto_emergencia ?? "Contacto"}
              {paciente.parentesco_emergencia && (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {paciente.parentesco_emergencia}
                </span>
              )}
            </p>
            {/* Marcable: en el teléfono se llama con un toque, que es
                exactamente lo que hace falta en una urgencia. */}
            <a
              href={`tel:${paciente.telefono_emergencia}`}
              className="text-lg font-semibold tabular-nums text-primary hover:underline"
            >
              {paciente.telefono_emergencia}
            </a>
          </div>
        )}

        {paciente.telefono && (
          <div>
            <p className="text-sm font-medium text-secondary">Teléfono del paciente</p>
            <a
              href={`tel:${paciente.telefono}`}
              className="text-lg font-semibold tabular-nums text-primary hover:underline"
            >
              {paciente.telefono}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function Antecedentes({ paciente }: { paciente: PacienteDeAgenda }) {
  const hay = paciente.alergias.length > 0 || paciente.cronicos.length > 0;
  if (!hay) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {paciente.alergias.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            Alergias
          </p>
          <p className="mt-1 text-sm text-secondary">{paciente.alergias.join(", ")}</p>
        </div>
      )}

      {paciente.cronicos.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Padecimientos crónicos
          </p>
          <p className="mt-1 text-sm text-secondary">{paciente.cronicos.join(", ")}</p>
        </div>
      )}
    </div>
  );
}

function Consultas({
  patientId,
  doctorId,
  appointmentId,
}: {
  patientId: string;
  doctorId: string;
  appointmentId?: string | null;
}) {
  const queryClient = useQueryClient();
  const [escribiendo, setEscribiendo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [diagnostico, setDiagnostico] = useState("");
  const [plan, setPlan] = useState("");

  const notas = useQuery({
    queryKey: ["notas", patientId],
    queryFn: () => getNotasDePaciente(patientId),
  });

  const guardar = useMutation({
    mutationFn: () =>
      guardarNota({
        patientId,
        doctorId,
        appointmentId,
        chief_complaint: motivo,
        diagnosis: diagnostico,
        treatment_plan: plan,
      }),
    onSuccess: () => {
      toast.success("Nota guardada en el expediente.");
      setMotivo("");
      setDiagnostico("");
      setPlan("");
      setEscribiendo(false);
      void queryClient.invalidateQueries({ queryKey: ["notas", patientId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No pudimos guardar la nota."),
  });

  if (notas.isLoading) return <Skeleton className="h-24 rounded-xl" />;

  const lista = notas.data ?? [];

  return (
    <div className="space-y-4">
      {!escribiendo ? (
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setEscribiendo(true)}>
          <Plus className="h-4 w-4" />
          Nueva nota de consulta
        </Button>
      ) : (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <div className="space-y-1.5">
            <Label htmlFor="motivo">Motivo de consulta</Label>
            <Input id="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="diagnostico">Diagnóstico</Label>
            <Textarea
              id="diagnostico"
              rows={2}
              value={diagnostico}
              onChange={(e) => setDiagnostico(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="plan">Plan de tratamiento</Label>
            <Textarea id="plan" rows={2} value={plan} onChange={(e) => setPlan(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => guardar.mutate()}
              disabled={guardar.isPending || !diagnostico.trim()}
            >
              {guardar.isPending ? "Guardando…" : "Guardar nota"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEscribiendo(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {lista.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Todavía no has escrito notas de este paciente.
        </p>
      ) : (
        <ul className="space-y-3">
          {lista.map((n) => (
            <li key={n.id} className="rounded-xl border border-border p-4">
              <p className="text-xs text-muted-foreground">{fecha(n.created_at)}</p>
              {n.chief_complaint && (
                <p className="mt-1 text-sm">
                  <span className="font-medium text-secondary">Motivo:</span>{" "}
                  <span className="text-muted-foreground">{n.chief_complaint}</span>
                </p>
              )}
              {n.diagnosis && (
                <p className="mt-1 text-sm">
                  <span className="font-medium text-secondary">Diagnóstico:</span>{" "}
                  <span className="text-muted-foreground">{n.diagnosis}</span>
                </p>
              )}
              {n.treatment_plan && (
                <p className="mt-1 text-sm">
                  <span className="font-medium text-secondary">Plan:</span>{" "}
                  <span className="text-muted-foreground">{n.treatment_plan}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Se dice en la pantalla y no solo en el código: un médico que espera ver
          el historial completo podría dar por hecho que no hay antecedentes. */}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Aquí solo aparecen las notas que tú has escrito. Las de otros médicos que atiendan a este
        paciente no se muestran, ni ellos ven las tuyas.
      </p>
    </div>
  );
}

function Estudios({
  patientId,
  doctorId,
  userId,
  appointmentId,
}: {
  patientId: string;
  doctorId: string;
  userId: string;
  appointmentId?: string | null;
}) {
  const queryClient = useQueryClient();
  const entradaRef = useRef<HTMLInputElement>(null);

  const [archivo, setArchivo] = useState<File | null>(null);
  const [titulo, setTitulo] = useState("");
  const [tipo, setTipo] = useState<Enums<"document_type">>("lab_result");

  const docs = useQuery({
    queryKey: ["documentos", patientId],
    queryFn: () => getDocumentosDePaciente(patientId),
  });

  const subir = useMutation({
    mutationFn: async () => {
      if (!archivo) throw new Error("Elige un archivo.");
      const r = await subirDocumento({
        archivo,
        patientId,
        doctorId,
        uploaderId: userId,
        titulo: titulo.trim() || archivo.name,
        tipo,
        appointmentId,
      });
      if (!r.ok) throw new Error(r.error);
    },
    onSuccess: () => {
      toast.success("Documento agregado al expediente.");
      setArchivo(null);
      setTitulo("");
      void queryClient.invalidateQueries({ queryKey: ["documentos", patientId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No pudimos subir el documento."),
  });

  const borrar = useMutation({
    mutationFn: borrarDocumento,
    onSuccess: () => {
      toast.success("Documento eliminado.");
      void queryClient.invalidateQueries({ queryKey: ["documentos", patientId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No pudimos eliminarlo."),
  });

  async function abrir(doc: DocumentoClinico) {
    try {
      const url = await urlDeDocumento(doc.storage_path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No pudimos abrir el documento.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-xl border border-border p-4">
        <p className="text-sm font-medium text-secondary">Agregar estudio o análisis</p>

        <input
          ref={entradaRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setArchivo(f);
              if (!titulo) setTitulo(f.name.replace(/\.[^.]+$/, ""));
            }
            e.target.value = "";
          }}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => entradaRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            {archivo ? "Cambiar archivo" : "Elegir archivo"}
          </Button>
          {archivo && (
            <span className="truncate text-xs text-muted-foreground">
              {archivo.name} · {pesoLegible(archivo.size)}
            </span>
          )}
        </div>

        {archivo && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="titulo-doc">Título</Label>
                <Input
                  id="titulo-doc"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Biometría hemática"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tipo-doc">Tipo</Label>
                <select
                  id="tipo-doc"
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as Enums<"document_type">)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {TIPOS_DOCUMENTO.map((t) => (
                    <option key={t.valor} value={t.valor}>
                      {t.etiqueta}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <Button size="sm" onClick={() => subir.mutate()} disabled={subir.isPending}>
              {subir.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Subiendo…
                </>
              ) : (
                "Agregar al expediente"
              )}
            </Button>
          </>
        )}

        <p className="text-xs text-muted-foreground">
          PDF, JPG o PNG, hasta 25 MB. El paciente podrá verlo desde su panel.
        </p>
      </div>

      {docs.isLoading ? (
        <Skeleton className="h-20 rounded-xl" />
      ) : (docs.data ?? []).length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No hay estudios en el expediente.
        </p>
      ) : (
        <ul className="space-y-2">
          {(docs.data ?? []).map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-secondary">{d.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {TIPOS_DOCUMENTO.find((t) => t.valor === d.document_type)?.etiqueta}
                    {" · "}
                    {fecha(d.created_at)}
                    {d.size_bytes ? ` · ${pesoLegible(d.size_bytes)}` : ""}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => abrir(d)} aria-label="Abrir">
                  <Download className="h-4 w-4" />
                </Button>
                {d.uploaded_by === userId && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className={cn("text-muted-foreground hover:text-destructive")}
                    onClick={() => borrar.mutate(d.id)}
                    disabled={borrar.isPending}
                    aria-label="Eliminar"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
