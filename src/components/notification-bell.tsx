// Campana de notificaciones de la cabecera (PRD Fase 8).

import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BadgeCheck,
  Calendar,
  CreditCard,
  FileText,
  MessageCircle,
  Star,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useAuth } from "@/store/auth";
import {
  getNotifications,
  iconNameFor,
  markAllAsRead,
  markAsRead,
  relativeTime,
  subscribeToNotifications,
  type Notification,
} from "@/services/notifications";

const ICONOS = {
  calendar: Calendar,
  star: Star,
  "message-circle": MessageCircle,
  "badge-check": BadgeCheck,
  "credit-card": CreditCard,
  "file-text": FileText,
  bell: Bell,
} as const;

function IconoDe({ tipo }: { tipo: Notification["notification_type"] }) {
  const Icono = ICONOS[iconNameFor(tipo) as keyof typeof ICONOS] ?? Bell;
  return <Icono className="h-4 w-4" />;
}

export function NotificationBell() {
  const { status, user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: avisos = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => getNotifications(),
    enabled: status === "authenticated",
    // Se refresca sola por Realtime; este intervalo es la red de seguridad por
    // si el socket se cae sin avisar (suspensión del portátil, cambio de red).
    refetchInterval: 5 * 60 * 1000,
  });

  // Realtime: el aviso aparece sin recargar. Se invalida la consulta en vez de
  // insertar la fila a mano, para que el orden y el recorte los siga decidiendo
  // el mismo sitio.
  useEffect(() => {
    if (status !== "authenticated" || !user?.id) return;
    return subscribeToNotifications(user.id, () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    });
  }, [status, user?.id, queryClient]);

  const marcarUna = useMutation({
    mutationFn: markAsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const marcarTodas = useMutation({
    mutationFn: markAllAsRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  /**
   * Marca la notificación como leída y lleva a donde apunta.
   *
   * `action_url` es una cadena que llega de la base de datos, así que no encaja
   * en el `to` de `<Link>`, que TanStack Router comprueba contra el árbol de
   * rutas en tiempo de compilación. Se navega a mano y se acota a rutas
   * internas: una barra sola al principio. La comprobación no sobra aunque hoy
   * el valor lo escriban solo triggers — si mañana alguien alimenta ese campo
   * desde otro sitio, esto evita que una notificación se convierta en un salto
   * a un dominio ajeno.
   */
  function abrir(a: Notification) {
    if (a.read_at === null) marcarUna.mutate(a.id);

    const destino = a.action_url;
    if (!destino) return;
    if (!destino.startsWith("/") || destino.startsWith("//")) return;

    void navigate({ to: destino as never });
  }

  if (status !== "authenticated") return null;

  const sinLeer = avisos.filter((a) => a.read_at === null).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={sinLeer > 0 ? `Notificaciones, ${sinLeer} sin leer` : "Notificaciones"}
        >
          <Bell className="h-5 w-5" />
          {sinLeer > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center
                         rounded-full bg-primary px-1 text-[10px] font-semibold leading-none
                         text-primary-foreground"
            >
              {/* Más de 9 se corta: el número exacto no ayuda, y tres cifras
                  desbordan el círculo. */}
              {sinLeer > 9 ? "9+" : sinLeer}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-secondary">Notificaciones</span>
          {sinLeer > 0 && (
            <button
              type="button"
              onClick={() => marcarTodas.mutate()}
              disabled={marcarTodas.isPending}
              className="text-xs text-primary hover:underline disabled:opacity-50"
            >
              Marcar todas como leídas
            </button>
          )}
        </div>

        {avisos.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            No tienes notificaciones.
          </p>
        ) : (
          <ScrollArea className="max-h-[26rem]">
            <ul className="divide-y divide-border">
              {avisos.map((a) => {
                const noLeida = a.read_at === null;
                const contenido = (
                  <div className="flex gap-3 px-4 py-3 text-left">
                    <span
                      className={cn(
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                        noLeida ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                      )}
                    >
                      <IconoDe tipo={a.notification_type} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p
                          className={cn(
                            "truncate text-sm",
                            noLeida ? "font-semibold text-secondary" : "text-muted-foreground",
                          )}
                        >
                          {a.title}
                        </p>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {relativeTime(a.created_at)}
                        </span>
                      </div>
                      {a.body && (
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                          {a.body}
                        </p>
                      )}
                    </div>
                  </div>
                );

                return (
                  <li key={a.id} className={cn(noLeida && "bg-primary/[0.03]")}>
                    <button
                      type="button"
                      onClick={() => abrir(a)}
                      className="block w-full hover:bg-muted/50"
                    >
                      {contenido}
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
