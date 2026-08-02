// Formulario con el que el paciente califica una consulta ya atendida
// (PRD Fase 8).
//
// Solo aparece para citas completadas y sin reseña previa. Esa lista la calcula
// el servicio, y quien manda de verdad es la base de datos: si alguien forzara
// el envío sobre una cita no atendida, el trigger lo rechaza.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star, PencilLine } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  createReview,
  getReviewableAppointments,
  type ReviewableAppointment,
} from "@/services/reviews";

/** Selector de estrellas accesible: son botones de radio, no iconos decorativos. */
function SelectorEstrellas({
  valor,
  onChange,
  etiqueta,
  size = "lg",
}: {
  valor: number;
  onChange: (v: number) => void;
  etiqueta: string;
  size?: "sm" | "lg";
}) {
  const [encima, setEncima] = useState(0);
  const pintadas = encima || valor;

  return (
    <div
      role="radiogroup"
      aria-label={etiqueta}
      className="flex items-center gap-1"
      onMouseLeave={() => setEncima(0)}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={valor === n}
          aria-label={`${n} ${n === 1 ? "estrella" : "estrellas"}`}
          onMouseEnter={() => setEncima(n)}
          onClick={() => onChange(n)}
          className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Star
            className={cn(
              size === "lg" ? "h-7 w-7" : "h-5 w-5",
              "transition-colors",
              n <= pintadas ? "fill-amber-400 text-amber-400" : "text-muted-foreground/40",
            )}
          />
        </button>
      ))}
    </div>
  );
}

const CRITERIOS = [
  { clave: "puntualidad", etiqueta: "Puntualidad" },
  { clave: "atencion", etiqueta: "Trato y atención" },
  { clave: "instalaciones", etiqueta: "Instalaciones" },
] as const;

function DialogoResena({
  cita,
  patientId,
  abierto,
  onCerrar,
}: {
  cita: ReviewableAppointment;
  patientId: string;
  abierto: boolean;
  onCerrar: () => void;
}) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [comentario, setComentario] = useState("");
  const [anonima, setAnonima] = useState(false);
  const [detalle, setDetalle] = useState<Record<string, number>>({});

  const enviar = useMutation({
    mutationFn: () =>
      createReview({
        appointmentId: cita.id,
        patientId,
        doctorId: cita.doctor_id,
        rating,
        comment: comentario,
        puntualidad: detalle.puntualidad,
        atencion: detalle.atencion,
        instalaciones: detalle.instalaciones,
        anonima,
      }),
    onSuccess: (r) => {
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success("Gracias por tu opinión.");
      void queryClient.invalidateQueries({ queryKey: ["reviewable"] });
      void queryClient.invalidateQueries({ queryKey: ["reviews"] });
      onCerrar();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No pudimos publicar tu opinión."),
  });

  return (
    <Dialog open={abierto} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>¿Cómo fue tu consulta?</DialogTitle>
          <DialogDescription>
            Tu opinión con {cita.doctor_name} ayuda a otros pacientes a elegir. Folio {cita.reference}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-muted/40 py-5">
            <SelectorEstrellas
              valor={rating}
              onChange={setRating}
              etiqueta="Calificación general"
            />
            <p className="text-xs text-muted-foreground">
              {rating === 0 ? "Toca una estrella para calificar" : `${rating} de 5`}
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium text-secondary">
              Detalle <span className="font-normal text-muted-foreground">(opcional)</span>
            </p>
            {CRITERIOS.map(({ clave, etiqueta }) => (
              <div key={clave} className="flex items-center justify-between gap-4">
                <Label className="text-sm font-normal text-muted-foreground">{etiqueta}</Label>
                <SelectorEstrellas
                  size="sm"
                  etiqueta={etiqueta}
                  valor={detalle[clave] ?? 0}
                  onChange={(v) => setDetalle((d) => ({ ...d, [clave]: v }))}
                />
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="comentario">Tu comentario</Label>
            <Textarea
              id="comentario"
              rows={4}
              maxLength={1000}
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Cuenta cómo te atendieron, si te explicaron con claridad, si respetaron tu hora…"
            />
            {/* Aviso explícito: lo que se escriba aquí queda en una página que
                cualquiera puede leer, incluidos buscadores. */}
            <p className="text-xs text-muted-foreground">
              Se publica en el perfil del médico. No incluyas datos personales ni detalles de tu
              diagnóstico.
            </p>
          </div>

          <div className="flex items-start gap-2.5 rounded-xl border border-border p-3">
            <Checkbox
              id="anonima"
              checked={anonima}
              onCheckedChange={(v) => setAnonima(v === true)}
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="anonima" className="text-sm font-normal">
                Publicar como anónima
              </Label>
              <p className="text-xs text-muted-foreground">
                Aparecerá «Paciente verificado» en lugar de tu nombre.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCerrar} disabled={enviar.isPending}>
            Ahora no
          </Button>
          <Button onClick={() => enviar.mutate()} disabled={rating === 0 || enviar.isPending}>
            {enviar.isPending ? "Publicando…" : "Publicar opinión"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Tarjeta que invita a opinar sobre las consultas ya atendidas. */
export function PendingReviews({ patientId }: { patientId: string }) {
  const [abierta, setAbierta] = useState<ReviewableAppointment | null>(null);

  const { data: pendientes = [] } = useQuery({
    queryKey: ["reviewable", patientId],
    queryFn: () => getReviewableAppointments(patientId),
  });

  if (pendientes.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-secondary">Cuenta cómo te fue</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {pendientes.length === 1
          ? "Tienes una consulta sin opinión."
          : `Tienes ${pendientes.length} consultas sin opinión.`}
      </p>

      <ul className="mt-4 space-y-3">
        {pendientes.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border
                       border-border bg-card p-4"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-secondary">{c.doctor_name}</p>
              <p className="text-xs text-muted-foreground">
                Consulta del{" "}
                {new Date(c.starts_at).toLocaleDateString("es-MX", {
                  day: "numeric",
                  month: "long",
                })}{" "}
                · {c.reference}
              </p>
            </div>
            <Button size="sm" variant="outline" className="gap-2" onClick={() => setAbierta(c)}>
              <PencilLine className="h-4 w-4" />
              Escribir opinión
            </Button>
          </li>
        ))}
      </ul>

      {abierta && (
        <DialogoResena
          // La clave fuerza a React a montar un formulario limpio por cita: sin
          // ella, abrir una segunda reseña conservaría las estrellas de la
          // anterior porque el estado vive dentro del componente.
          key={abierta.id}
          cita={abierta}
          patientId={patientId}
          abierto
          onCerrar={() => setAbierta(null)}
        />
      )}
    </section>
  );
}
