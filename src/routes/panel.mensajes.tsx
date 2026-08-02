import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircle, Send, ArrowLeft, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { PanelHeading } from "@/routes/panel";
import { cn } from "@/lib/utils";
import { useAuth, isDoctor } from "@/store/auth";
import {
  getConversations,
  getMessages,
  groupByDay,
  horaDe,
  markConversationRead,
  sendMessage,
  subscribeToMessages,
  type ConversationSummary,
} from "@/services/messages";

export const Route = createFileRoute("/panel/mensajes")({
  // La notificación de mensaje nuevo llega con ?c=<id> para abrir el hilo
  // directamente. Se valida aquí: si no es una cadena, se ignora.
  validateSearch: (search: Record<string, unknown>) => ({
    c: typeof search.c === "string" ? search.c : undefined,
  }),
  head: () => ({ meta: [{ title: "Mensajes · DoctorCita" }] }),
  component: MessagesPanel,
});

function MessagesPanel() {
  const { user, roles } = useAuth();
  const { c: hiloDeLaUrl } = useSearch({ from: "/panel/mensajes" });
  const queryClient = useQueryClient();

  const lado = isDoctor(roles) ? "doctor" : "patient";
  const [abierto, setAbierto] = useState<string | null>(hiloDeLaUrl ?? null);

  const conversaciones = useQuery({
    queryKey: ["conversations", lado],
    queryFn: () => getConversations(lado),
    enabled: Boolean(user?.id),
  });

  const lista = conversaciones.data ?? [];
  const actual = lista.find((c) => c.id === abierto) ?? null;

  // Si la notificación traía un hilo que ya no existe (borrado, o de la otra
  // cuenta), se vuelve a la lista en lugar de dejar la pantalla en blanco.
  useEffect(() => {
    if (abierto && conversaciones.isFetched && !actual) setAbierto(null);
  }, [abierto, conversaciones.isFetched, actual]);

  const sinLeer = (c: ConversationSummary) =>
    lado === "patient" ? c.patient_unread_count : c.doctor_unread_count;

  return (
    <>
      <PanelHeading
        title="Mensajes"
        description="Consultas de seguimiento y coordinación con tus citas."
      />

      <div className="mt-6 grid gap-4 md:grid-cols-[20rem_1fr]">
        {/* En móvil se ve una cosa o la otra; en escritorio, ambas. */}
        <aside className={cn("md:block", abierto && "hidden")}>
          {conversaciones.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
            </div>
          ) : lista.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-8 text-center">
              <MessageCircle className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-3 text-sm font-medium text-secondary">Sin conversaciones</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {lado === "patient"
                  ? "Puedes escribir a un médico desde su perfil."
                  : "Tus pacientes pueden escribirte desde tu perfil."}
              </p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {lista.map((c) => {
                const nuevos = sinLeer(c);
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setAbierto(c.id)}
                      className={cn(
                        "w-full rounded-xl border p-3 text-left transition-colors",
                        c.id === abierto
                          ? "border-primary bg-primary-soft/40"
                          : "border-border bg-card hover:bg-muted/50",
                      )}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-secondary">
                          {c.otro_nombre}
                        </span>
                        {nuevos > 0 && (
                          <span
                            className="flex h-5 min-w-5 shrink-0 items-center justify-center
                                       rounded-full bg-primary px-1.5 text-[10px] font-semibold
                                       text-primary-foreground"
                          >
                            {nuevos}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {c.last_message_preview ?? "Sin mensajes todavía"}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className={cn("md:block", !abierto && "hidden")}>
          {actual ? (
            <Hilo
              conversacion={actual}
              userId={user!.id}
              onVolver={() => setAbierto(null)}
              onLeido={() => queryClient.invalidateQueries({ queryKey: ["conversations"] })}
            />
          ) : (
            <div className="flex h-full min-h-[24rem] items-center justify-center rounded-2xl border border-border bg-card">
              <p className="text-sm text-muted-foreground">Elige una conversación.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function Hilo({
  conversacion,
  userId,
  onVolver,
  onLeido,
}: {
  conversacion: ConversationSummary;
  userId: string;
  onVolver: () => void;
  onLeido: () => void;
}) {
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState("");
  const finRef = useRef<HTMLDivElement>(null);

  const mensajes = useQuery({
    queryKey: ["messages", conversacion.id],
    queryFn: () => getMessages(conversacion.id),
  });

  // Realtime: el mensaje del otro aparece sin recargar.
  useEffect(() => {
    return subscribeToMessages(conversacion.id, () => {
      void queryClient.invalidateQueries({ queryKey: ["messages", conversacion.id] });
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    });
  }, [conversacion.id, queryClient]);

  // Al abrir el hilo se marcan los recibidos como leídos. Depende del último
  // mensaje y no solo del id: si llega uno nuevo con la ventana abierta,
  // también hay que sellarlo.
  const ultimoId = mensajes.data?.at(-1)?.id;
  useEffect(() => {
    if (!mensajes.data?.length) return;
    void markConversationRead(conversacion.id).then(onLeido).catch(() => {});
    // `onLeido` se omite a propósito: es una función nueva en cada render del
    // padre e incluirla dispararía el efecto en bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversacion.id, ultimoId]);

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: "end" });
  }, [ultimoId]);

  const enviar = useMutation({
    mutationFn: () => sendMessage(conversacion.id, userId, texto),
    onSuccess: () => {
      setTexto("");
      void queryClient.invalidateQueries({ queryKey: ["messages", conversacion.id] });
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "No pudimos enviar el mensaje."),
  });

  const grupos = useMemo(() => groupByDay(mensajes.data ?? []), [mensajes.data]);

  return (
    <div className="flex h-[32rem] flex-col rounded-2xl border border-border bg-card">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onVolver}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="truncate text-sm font-semibold text-secondary">
          {conversacion.otro_nombre}
        </span>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {mensajes.isLoading ? (
          <Skeleton className="h-16 rounded-xl" />
        ) : grupos.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <MessageCircle className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Todavía no hay mensajes. Escribe el primero.
            </p>
          </div>
        ) : (
          grupos.map((g) => (
            <div key={g.clave} className="space-y-2">
              <div className="flex justify-center">
                <span className="rounded-full bg-muted px-3 py-0.5 text-[11px] text-muted-foreground">
                  {g.etiqueta}
                </span>
              </div>
              {g.mensajes.map((m) => {
                const mio = m.sender_id === userId;
                return (
                  <div key={m.id} className={cn("flex", mio ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[80%] rounded-2xl px-3.5 py-2",
                        mio
                          ? "rounded-br-sm bg-primary text-primary-foreground"
                          : "rounded-bl-sm bg-muted text-secondary",
                      )}
                    >
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>
                      <span
                        className={cn(
                          "mt-1 block text-right text-[10px]",
                          mio ? "text-primary-foreground/70" : "text-muted-foreground",
                        )}
                      >
                        {horaDe(m.created_at)}
                        {mio && m.read_at && " · leído"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
        <div ref={finRef} />
      </div>

      <footer className="border-t border-border p-3">
        {/* No es un canal de urgencias y conviene decirlo donde se escribe, no
            en unos términos que nadie lee. */}
        <p className="mb-2 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
          <ShieldAlert className="mt-px h-3 w-3 shrink-0" />
          No uses este chat para urgencias. Si es una emergencia, llama al 911.
        </p>
        <div className="flex items-end gap-2">
          <Textarea
            rows={1}
            value={texto}
            maxLength={2000}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // Enter envía, Mayús+Enter salta de línea. En móvil el teclado
              // manda su propio Enter, así que se comprueba que no haya
              // composición de texto en curso (acentos, predictivo).
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (texto.trim()) enviar.mutate();
              }
            }}
            placeholder="Escribe tu mensaje…"
            className="max-h-32 min-h-[2.5rem] resize-none"
          />
          <Button
            size="icon"
            onClick={() => enviar.mutate()}
            disabled={enviar.isPending || texto.trim().length === 0}
            aria-label="Enviar mensaje"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </footer>
    </div>
  );
}
