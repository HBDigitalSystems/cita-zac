// Centro de notificaciones (PRD Fase 8).
//
// Nadie escribe aquí desde el navegador: `notifications` no tiene política de
// INSERT. Los avisos los generan triggers en la base de datos cuando pasa el
// hecho que los motiva —se agenda una cita, se cancela, llega un mensaje—, de
// modo que un aviso nunca puede ser fabricado por un cliente. Este archivo solo
// lee, marca como leído y borra.

import { supabase } from "@/integrations/supabase/client";
import type { Enums } from "@/integrations/supabase/types";

export type Notification = {
  id: string;
  notification_type: Enums<"notification_type">;
  title: string;
  body: string | null;
  action_url: string | null;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

/**
 * Las notificaciones del usuario en sesión.
 *
 * No lleva `.eq("user_id", ...)`: la policy `notifications_select_own` ya
 * restringe a las propias, y añadir el filtro aquí sugeriría que es este
 * código el que protege la privacidad.
 */
export async function getNotifications(limite = 30): Promise<Notification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id, notification_type, title, body, action_url, payload, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(limite);

  if (error) throw error;
  return (data ?? []) as Notification[];
}

/** Cuántas quedan sin leer. Solo viaja el número, no las filas. */
export async function getUnreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .is("read_at", null);

  if (error) throw error;
  return count ?? 0;
}

export async function markAsRead(id: string) {
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);

  if (error) throw error;
}

/**
 * Marca todas como leídas en una sola llamada.
 *
 * Va por función porque un UPDATE masivo desde PostgREST exigiría enumerar los
 * identificadores, y la lista puede no estar entera en memoria.
 */
export async function markAllAsRead(): Promise<number> {
  const { data, error } = await supabase.rpc("mark_all_notifications_read");
  if (error) throw error;
  return (data as number) ?? 0;
}

export async function deleteNotification(id: string) {
  const { error } = await supabase.from("notifications").delete().eq("id", id);
  if (error) throw error;
}

/**
 * Avisa en cuanto llega una notificación nueva, sin recargar.
 *
 * El filtro por `user_id` es obligatorio aquí y no es redundante con el RLS:
 * Realtime lo necesita para no abrir un flujo por cada fila insertada en la
 * tabla. La autorización la sigue haciendo el RLS al entregar la fila.
 *
 * Devuelve la función para darse de baja; hay que llamarla al desmontar o la
 * conexión queda abierta.
 */
export function subscribeToNotifications(
  userId: string,
  onNew: (n: Notification) => void,
): () => void {
  const canal = supabase
    .channel(`notificaciones:${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
      (payload) => onNew(payload.new as Notification),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(canal);
  };
}

/** Icono por tipo de aviso. Devuelve el nombre, no el componente, para no atar
 *  el servicio a la biblioteca de iconos. */
export function iconNameFor(tipo: Enums<"notification_type">): string {
  if (tipo.startsWith("appointment")) return "calendar";
  if (tipo.startsWith("review")) return "star";
  if (tipo === "message_received") return "message-circle";
  if (tipo.startsWith("doctor")) return "badge-check";
  if (tipo.startsWith("subscription") || tipo === "payment_failed") return "credit-card";
  if (tipo === "prescription_issued" || tipo === "document_shared") return "file-text";
  return "bell";
}

/** «hace 3 h», «ayer», «12 mar». */
export function relativeTime(iso: string): string {
  const ahora = Date.now();
  const t = new Date(iso).getTime();
  const min = Math.round((ahora - t) / 60000);

  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;

  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  if (h < 48) return "ayer";

  return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}
