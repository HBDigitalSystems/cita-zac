// Chat interno paciente ↔ médico (PRD Fase 8).
//
// Hay un único hilo por pareja, con índice único en la base de datos. Quién
// puede leerlo y escribir en él lo decide el RLS; qué se puede tocar dentro lo
// deciden triggers: un mensaje enviado es inmutable salvo su acuse de lectura,
// y el resumen del hilo (último mensaje, contadores de no leídos) lo mantiene
// la base de datos. Nada de eso se repite aquí.
//
// Aviso de alcance: esto NO es un canal cifrado de extremo a extremo. El
// contenido queda legible para quien administre la base de datos. Sirve para
// coordinar citas y dudas de seguimiento, no para sustituir el expediente.

import { supabase } from "@/integrations/supabase/client";

export type ConversationSummary = {
  id: string;
  patient_id: string;
  doctor_id: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  patient_unread_count: number;
  doctor_unread_count: number;
  /** Con quién se habla, ya resuelto según de qué lado esté quien mira. */
  otro_nombre: string;
  otro_slug: string | null;
  otro_foto: string | null;
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  read_at: string | null;
  created_at: string;
};

/**
 * Los hilos de quien esté en sesión.
 *
 * No lleva filtro por participante: la policy `conversations_select_participant`
 * ya devuelve solo los propios. `lado` decide de quién se muestra el nombre —
 * un médico ve al paciente y viceversa.
 */
export async function getConversations(lado: "patient" | "doctor"): Promise<ConversationSummary[]> {
  const { data, error } = await supabase
    .from("conversations")
    .select(
      `id, patient_id, doctor_id, last_message_at, last_message_preview,
       patient_unread_count, doctor_unread_count,
       patients ( users ( full_name ) ),
       doctors ( slug, users!doctors_user_id_fkey ( full_name ),
                 doctor_profiles ( display_name, photo_url ) )`,
    )
    .order("last_message_at", { ascending: false, nullsFirst: false });

  if (error) throw error;

  return (data ?? []).map((c: any) => {
    const doctorNombre =
      c.doctors?.doctor_profiles?.display_name ?? c.doctors?.users?.full_name ?? "Médico";
    // El nombre del paciente solo llega si RLS lo permite: un médico puede
    // leerlo porque tiene cita con él. Si llegara nulo se cae a una etiqueta
    // neutra en vez de pintar "null".
    const pacienteNombre = c.patients?.users?.full_name ?? "Paciente";

    return {
      id: c.id,
      patient_id: c.patient_id,
      doctor_id: c.doctor_id,
      last_message_at: c.last_message_at,
      last_message_preview: c.last_message_preview,
      patient_unread_count: c.patient_unread_count,
      doctor_unread_count: c.doctor_unread_count,
      otro_nombre: lado === "patient" ? doctorNombre : pacienteNombre,
      otro_slug: lado === "patient" ? (c.doctors?.slug ?? null) : null,
      otro_foto: lado === "patient" ? (c.doctors?.doctor_profiles?.photo_url ?? null) : null,
    };
  });
}

export async function getMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_id, body, read_at, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as ChatMessage[];
}

export async function sendMessage(conversationId: string, senderId: string, body: string) {
  const texto = body.trim();
  if (!texto) return;

  const { error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: senderId, body: texto });

  if (error) throw error;
}

/** Marca los mensajes recibidos como leídos y pone a cero el propio contador. */
export async function markConversationRead(conversationId: string) {
  const { error } = await supabase.rpc("mark_conversation_read", {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
}

/** Abre el hilo con un médico, o devuelve el que ya existía. */
export async function openConversation(doctorId: string): Promise<string> {
  const { data, error } = await supabase.rpc("open_conversation", { p_doctor_id: doctorId });
  if (error) throw error;
  return data as string;
}

/**
 * Escucha los mensajes nuevos de un hilo.
 *
 * El filtro por `conversation_id` no sustituye al RLS —que sigue decidiendo si
 * la fila se entrega— pero evita abrir un flujo por cada mensaje de la
 * plataforma.
 */
export function subscribeToMessages(
  conversationId: string,
  onNew: (m: ChatMessage) => void,
): () => void {
  const canal = supabase
    .channel(`chat:${conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => onNew(payload.new as ChatMessage),
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(canal);
  };
}

/** Agrupa por día para poder poner separadores de fecha en el hilo. */
export function groupByDay(mensajes: ChatMessage[]) {
  const grupos = new Map<string, ChatMessage[]>();

  for (const m of mensajes) {
    // La clave se calcula en la zona horaria de quien mira, no en UTC: en
    // México un mensaje de las 19:00 cae al día siguiente si se agrupa por la
    // fecha UTC, y el hilo mostraría separadores en días equivocados.
    const d = new Date(m.created_at);
    const clave = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave)!.push(m);
  }

  return [...grupos.entries()].map(([clave, items]) => ({
    clave,
    etiqueta: etiquetaDeDia(items[0].created_at),
    mensajes: items,
  }));
}

function etiquetaDeDia(iso: string): string {
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date();
  ayer.setDate(hoy.getDate() - 1);

  const mismoDia = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (mismoDia(d, hoy)) return "Hoy";
  if (mismoDia(d, ayer)) return "Ayer";

  return d.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

export function horaDe(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}
