// Reseñas recibidas por el médico, con posibilidad de responder (PRD Fase 8).
//
// El médico NO puede editar ni borrar lo que escribió el paciente: el trigger
// `reviews_protect_columns` rechaza cualquier cambio en la calificación, el
// comentario o el estado. Solo puede añadir su respuesta, que se publica junto
// a la reseña. Esa asimetría es lo que hace creíble el sistema de opiniones, y
// por eso vive en la base de datos y no en este componente.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareQuote, Star } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { getReviewsForDoctor, replyToReview, type PublicReview } from "@/services/reviews";

function Estrellas({ valor }: { valor: number }) {
  return (
    <span className="flex items-center gap-0.5 text-amber-400" aria-label={`${valor} de 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={cn("h-3.5 w-3.5", i < valor && "fill-current")} />
      ))}
    </span>
  );
}

function Respuesta({ resena }: { resena: PublicReview }) {
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(resena.doctor_reply ?? "");

  const guardar = useMutation({
    mutationFn: () => replyToReview(resena.id, texto),
    onSuccess: () => {
      toast.success("Respuesta publicada.");
      void queryClient.invalidateQueries({ queryKey: ["doctor-reviews"] });
      void queryClient.invalidateQueries({ queryKey: ["reviews"] });
      setEditando(false);
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "No pudimos publicar tu respuesta."),
  });

  if (resena.doctor_reply && !editando) {
    return (
      <div className="mt-4 rounded-xl border-l-2 border-primary bg-muted/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-secondary">Tu respuesta</p>
          <button
            type="button"
            onClick={() => setEditando(true)}
            className="text-xs text-primary hover:underline"
          >
            Editar
          </button>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{resena.doctor_reply}</p>
      </div>
    );
  }

  if (!editando) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="mt-4 gap-2"
        onClick={() => setEditando(true)}
      >
        <MessageSquareQuote className="h-4 w-4" />
        Responder
      </Button>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      <Textarea
        rows={3}
        value={texto}
        maxLength={1000}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Agradece la visita o aclara lo que haga falta. Se publica en tu perfil."
      />
      {/* El recordatorio no es decorativo: responder en público a un paciente
          identificable puede revelar por qué fue a consulta. */}
      <p className="text-xs text-muted-foreground">
        Tu respuesta es pública. No menciones diagnósticos, tratamientos ni datos del paciente.
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => guardar.mutate()}
          disabled={guardar.isPending || texto.trim().length === 0}
        >
          {guardar.isPending ? "Publicando…" : "Publicar respuesta"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setTexto(resena.doctor_reply ?? "");
            setEditando(false);
          }}
        >
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export function DoctorReviewsPanel({ doctorId }: { doctorId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["doctor-reviews", doctorId],
    queryFn: () => getReviewsForDoctor(doctorId),
  });

  if (isLoading) return <Skeleton className="h-32 rounded-2xl" />;

  const lista = data ?? [];
  const sinResponder = lista.filter((r) => !r.doctor_reply).length;

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-secondary">Opiniones de tus pacientes</h2>
        {sinResponder > 0 && (
          <span className="text-sm text-muted-foreground">
            {sinResponder} sin responder
          </span>
        )}
      </div>

      {lista.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Todavía no has recibido opiniones. Aparecerán aquí cuando un paciente califique una
          consulta ya atendida.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {lista.map((r) => (
            <article key={r.id} className="rounded-2xl border border-border bg-card p-6">
              <header className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-secondary">
                    {r.author_display_name ?? "Paciente verificado"}
                  </p>
                  <time className="text-xs text-muted-foreground" dateTime={r.created_at}>
                    {new Date(r.created_at).toLocaleDateString("es-MX", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </time>
                </div>
                <Estrellas valor={r.rating} />
              </header>

              {r.comment && (
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{r.comment}</p>
              )}

              <Respuesta resena={r} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
