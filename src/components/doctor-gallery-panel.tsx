// Galería de fotos y certificaciones del médico.
//
// Las dos cosas se muestran en su perfil público, así que la advertencia de la
// galería no es de trámite: una foto del consultorio con un paciente de fondo
// queda publicada en internet.

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { subirFotoGaleria } from "@/services/storage";

type Foto = { id: string; url: string; caption: string | null };
type Certificacion = {
  id: string;
  title: string;
  issuing_body: string | null;
  issued_year: number | null;
};

export function DoctorGalleryPanel({
  doctorId,
  userId,
}: {
  doctorId: string;
  userId: string;
}) {
  return (
    <>
      <Galeria doctorId={doctorId} userId={userId} />
      <Certificaciones doctorId={doctorId} />
    </>
  );
}

function Galeria({ doctorId, userId }: { doctorId: string; userId: string }) {
  const queryClient = useQueryClient();
  const entradaRef = useRef<HTMLInputElement>(null);

  const fotos = useQuery({
    queryKey: ["doctor-media", doctorId],
    queryFn: async (): Promise<Foto[]> => {
      const { data, error } = await supabase
        .from("doctor_media")
        .select("id, url, caption")
        .eq("doctor_id", doctorId)
        .order("display_order")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as Foto[];
    },
  });

  const subir = useMutation({
    mutationFn: async (archivo: File) => {
      const r = await subirFotoGaleria(archivo, userId);
      if (!r.ok) throw new Error(r.error);

      const { error } = await supabase
        .from("doctor_media")
        .insert({ doctor_id: doctorId, media_type: "image", url: r.url });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Foto agregada a tu galería.");
      void queryClient.invalidateQueries({ queryKey: ["doctor-media", doctorId] });
      void queryClient.invalidateQueries({ queryKey: ["doctor"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No pudimos subir la foto."),
  });

  const quitar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("doctor_media").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Foto eliminada.");
      void queryClient.invalidateQueries({ queryKey: ["doctor-media", doctorId] });
      void queryClient.invalidateQueries({ queryKey: ["doctor"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No pudimos eliminarla."),
  });

  const lista = fotos.data ?? [];

  return (
    <section className="mt-8 rounded-2xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-secondary">Galería de tu consultorio</h2>
          <p className="mt-1 max-w-lg text-sm text-muted-foreground">
            La sala de espera, el equipo, el espacio de consulta. Ayuda al paciente a saber a
            dónde va.
          </p>
        </div>

        <input
          ref={entradaRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) subir.mutate(f);
            e.target.value = "";
          }}
        />
        <Button
          variant="outline"
          className="gap-2"
          disabled={subir.isPending}
          onClick={() => entradaRef.current?.click()}
        >
          {subir.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImagePlus className="h-4 w-4" />
          )}
          {subir.isPending ? "Subiendo…" : "Agregar foto"}
        </Button>
      </div>

      {/* No es una advertencia de trámite: estas fotos quedan publicadas en
          internet, y un paciente reconocible de fondo es un dato de salud. */}
      <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
        Estas fotos son públicas. Asegúrate de que no aparezca ningún paciente, ni expedientes,
        ni pantallas con información clínica.
      </p>

      {fotos.isLoading ? (
        <Skeleton className="mt-5 h-32 rounded-xl" />
      ) : lista.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Todavía no has subido fotos.
        </p>
      ) : (
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {lista.map((f) => (
            <li key={f.id} className="group relative">
              <img
                src={f.url}
                alt={f.caption ?? ""}
                loading="lazy"
                className="aspect-[4/3] w-full rounded-xl border border-border object-cover"
              />
              <Button
                variant="secondary"
                size="icon"
                aria-label="Eliminar foto"
                onClick={() => quitar.mutate(f.id)}
                disabled={quitar.isPending}
                // Visible siempre en táctil, donde no hay «pasar el ratón por
                // encima»; en escritorio aparece al acercarse.
                className="absolute right-2 top-2 h-7 w-7 opacity-100 shadow-sm sm:opacity-0
                           sm:transition-opacity sm:group-hover:opacity-100
                           sm:group-focus-within:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Certificaciones({ doctorId }: { doctorId: string }) {
  const queryClient = useQueryClient();
  const [titulo, setTitulo] = useState("");
  const [institucion, setInstitucion] = useState("");
  const [anio, setAnio] = useState("");

  const certs = useQuery({
    queryKey: ["doctor-certifications", doctorId],
    queryFn: async (): Promise<Certificacion[]> => {
      const { data, error } = await supabase
        .from("doctor_certifications")
        .select("id, title, issuing_body, issued_year")
        .eq("doctor_id", doctorId)
        .order("issued_year", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Certificacion[];
    },
  });

  const agregar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("doctor_certifications").insert({
        doctor_id: doctorId,
        title: titulo.trim(),
        issuing_body: institucion.trim() || null,
        issued_year: anio ? Number(anio) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Certificación agregada.");
      setTitulo("");
      setInstitucion("");
      setAnio("");
      void queryClient.invalidateQueries({ queryKey: ["doctor-certifications", doctorId] });
      void queryClient.invalidateQueries({ queryKey: ["doctor"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No pudimos agregarla."),
  });

  const quitar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("doctor_certifications").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Certificación eliminada.");
      void queryClient.invalidateQueries({ queryKey: ["doctor-certifications", doctorId] });
      void queryClient.invalidateQueries({ queryKey: ["doctor"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No pudimos eliminarla."),
  });

  const anioActual = new Date().getFullYear();
  const lista = certs.data ?? [];

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold text-secondary">Certificaciones y formación</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Consejos, diplomados y cursos. Aparecen en tu perfil, en «Formación».
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_7rem_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="c-titulo">Título</Label>
          <Input
            id="c-titulo"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Consejo Mexicano de Cardiología"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-institucion">Institución</Label>
          <Input
            id="c-institucion"
            value={institucion}
            onChange={(e) => setInstitucion(e.target.value)}
            placeholder="UNAM"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-anio">Año</Label>
          <Input
            id="c-anio"
            type="number"
            inputMode="numeric"
            min="1950"
            max={anioActual}
            value={anio}
            onChange={(e) => setAnio(e.target.value)}
            placeholder={String(anioActual)}
          />
        </div>
        <div className="flex items-end">
          <Button
            className="w-full gap-2 sm:w-auto"
            onClick={() => agregar.mutate()}
            disabled={agregar.isPending || !titulo.trim()}
          >
            <Plus className="h-4 w-4" />
            Agregar
          </Button>
        </div>
      </div>

      {certs.isLoading ? (
        <Skeleton className="mt-5 h-16 rounded-xl" />
      ) : lista.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Todavía no has agregado certificaciones.
        </p>
      ) : (
        <ul className="mt-5 divide-y divide-border">
          {lista.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Award className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-secondary">{c.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {[c.issuing_body, c.issued_year].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => quitar.mutate(c.id)}
                disabled={quitar.isPending}
                aria-label={`Eliminar ${c.title}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
