// El expediente del paciente, visto por él mismo.
//
// Es su información y la ve entera: las notas de todos sus médicos, no solo las
// de uno. Ese es justo el reverso de lo que ve un médico, que solo lee lo que
// él escribió. La asimetría la impone el RLS.

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Loader2, Stethoscope, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TIPOS_DOCUMENTO,
  borrarDocumento,
  getDocumentosDePaciente,
  getMisNotas,
  pesoLegible,
  subirDocumento,
  urlDeDocumento,
  type DocumentoClinico,
} from "@/services/clinical";
import type { Enums } from "@/integrations/supabase/types";

function fecha(iso: string) {
  return new Date(iso).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function PatientOwnRecord({
  patientId,
  userId,
}: {
  patientId: string;
  userId: string;
}) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-secondary">Mi expediente</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Tus consultas y tus estudios, en un solo lugar.
      </p>

      <Tabs defaultValue="consultas" className="mt-4">
        <TabsList>
          <TabsTrigger value="consultas">Consultas</TabsTrigger>
          <TabsTrigger value="estudios">Estudios y análisis</TabsTrigger>
        </TabsList>

        <TabsContent value="consultas" className="mt-4">
          <MisConsultas patientId={patientId} />
        </TabsContent>

        <TabsContent value="estudios" className="mt-4">
          <MisEstudios patientId={patientId} userId={userId} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

function MisConsultas({ patientId }: { patientId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["mis-notas", patientId],
    queryFn: () => getMisNotas(patientId),
  });

  if (isLoading) return <Skeleton className="h-28 rounded-2xl" />;

  const notas = data ?? [];

  if (notas.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Todavía no hay notas de consulta. Aparecerán aquí cuando tu médico las escriba.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {notas.map((n) => (
        <li key={n.id} className="rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-secondary">
              <Stethoscope className="h-4 w-4 text-muted-foreground" />
              {n.medico_nombre}
              {n.especialidad && (
                <span className="font-normal text-muted-foreground">· {n.especialidad}</span>
              )}
            </p>
            <time className="text-xs text-muted-foreground" dateTime={n.created_at}>
              {fecha(n.created_at)}
            </time>
          </div>

          <dl className="mt-3 space-y-1.5 text-sm">
            {n.chief_complaint && (
              <Campo etiqueta="Motivo de consulta" valor={n.chief_complaint} />
            )}
            {n.diagnosis && <Campo etiqueta="Diagnóstico" valor={n.diagnosis} />}
            {n.treatment_plan && <Campo etiqueta="Indicaciones" valor={n.treatment_plan} />}
          </dl>

          {n.follow_up_date && (
            <p className="mt-3 rounded-lg bg-primary-soft/40 px-3 py-2 text-xs text-secondary">
              Cita de seguimiento sugerida:{" "}
              <strong>
                {new Date(`${n.follow_up_date}T12:00:00`).toLocaleDateString("es-MX", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </strong>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function Campo({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="sm:flex sm:gap-2">
      <dt className="shrink-0 font-medium text-secondary sm:w-40">{etiqueta}</dt>
      <dd className="text-muted-foreground">{valor}</dd>
    </div>
  );
}

function MisEstudios({ patientId, userId }: { patientId: string; userId: string }) {
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
        // El paciente sube por su cuenta, sin médico asociado: puede traer un
        // análisis de un laboratorio particular.
        doctorId: null,
        uploaderId: userId,
        titulo: titulo.trim() || archivo.name,
        tipo,
      });
      if (!r.ok) throw new Error(r.error);
    },
    onSuccess: () => {
      toast.success("Estudio agregado a tu expediente.");
      setArchivo(null);
      setTitulo("");
      void queryClient.invalidateQueries({ queryKey: ["documentos", patientId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No pudimos subirlo."),
  });

  const borrar = useMutation({
    mutationFn: borrarDocumento,
    onSuccess: () => {
      toast.success("Estudio eliminado.");
      void queryClient.invalidateQueries({ queryKey: ["documentos", patientId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No pudimos eliminarlo."),
  });

  async function abrir(doc: DocumentoClinico) {
    try {
      const url = await urlDeDocumento(doc.storage_path);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No pudimos abrirlo.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <p className="text-sm font-medium text-secondary">Subir un estudio</p>
        <p className="text-xs text-muted-foreground">
          Análisis de un laboratorio particular, radiografías, recetas anteriores. Tu médico
          tratante podrá verlos durante la consulta.
        </p>

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
                <Label htmlFor="mi-titulo">Título</Label>
                <Input
                  id="mi-titulo"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mi-tipo">Tipo</Label>
                <select
                  id="mi-tipo"
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
                "Agregar a mi expediente"
              )}
            </Button>
          </>
        )}
      </div>

      {docs.isLoading ? (
        <Skeleton className="h-20 rounded-2xl" />
      ) : (docs.data ?? []).length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No tienes estudios guardados.
        </p>
      ) : (
        <ul className="space-y-2">
          {(docs.data ?? []).map((d) => (
            <li
              key={d.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-secondary">{d.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {TIPOS_DOCUMENTO.find((t) => t.valor === d.document_type)?.etiqueta}
                    {" · "}
                    {fecha(d.created_at)}
                    {d.uploaded_by !== userId && " · Lo subió tu médico"}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="icon" onClick={() => abrir(d)} aria-label="Abrir">
                  <Download className="h-4 w-4" />
                </Button>
                {/* Solo se puede borrar lo que uno subió: un estudio que dejó el
                    médico forma parte del expediente clínico. */}
                {d.uploaded_by === userId && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => borrar.mutate(d.id)}
                    disabled={borrar.isPending}
                    aria-label="Eliminar"
                  >
                    ×
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
