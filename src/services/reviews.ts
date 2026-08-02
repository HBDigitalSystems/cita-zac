// Reseñas verificadas (PRD Fase 8).
//
// «Verificada» no es una etiqueta de mercadotecnia: la base de datos impide
// insertar una reseña que no apunte a una cita COMPLETADA de esa misma pareja
// paciente-médico, y la clave única sobre `appointment_id` impide dejar dos.
// Aquí no se comprueba nada de eso; si esta capa lo repitiera, daría a entender
// que la garantía vive en el navegador, donde cualquiera puede saltársela.
//
// El nombre del autor NO se pide con un join a `public.users`. Esa tabla está
// cerrada por RLS a la propia fila, así que un visitante anónimo recibiría
// nulos; y abrirla publicaría en internet a qué especialista fue cada persona.
// La columna `author_display_name` guarda «Ana R.» calculado por un trigger al
// escribir la reseña.

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type PublicReview = {
  id: string;
  rating: number;
  comment: string | null;
  rating_punctuality: number | null;
  rating_attention: number | null;
  rating_facilities: number | null;
  author_display_name: string | null;
  is_anonymous: boolean;
  doctor_reply: string | null;
  doctor_replied_at: string | null;
  created_at: string;
};

const PUBLIC_SELECT = `
  id, rating, comment,
  rating_punctuality, rating_attention, rating_facilities,
  author_display_name, is_anonymous,
  doctor_reply, doctor_replied_at, created_at
`;

/** Reseñas publicadas de un médico. Las lee cualquiera, incluso sin sesión. */
export async function getDoctorReviews(doctorId: string): Promise<PublicReview[]> {
  const { data, error } = await supabase
    .from("reviews")
    .select(PUBLIC_SELECT)
    .eq("doctor_id", doctorId)
    .eq("status", "published")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as PublicReview[];
}

/** Desglose de cuántas reseñas hay de cada calificación, para el histograma. */
export function ratingBreakdown(reviews: PublicReview[]) {
  const buckets = [5, 4, 3, 2, 1].map((estrellas) => ({
    estrellas,
    total: reviews.filter((r) => r.rating === estrellas).length,
  }));
  const total = reviews.length;
  return buckets.map((b) => ({
    ...b,
    porcentaje: total === 0 ? 0 : Math.round((b.total / total) * 100),
  }));
}

/** Promedio de un criterio del desglose, ignorando quien no lo calificó. */
export function averageOf(
  reviews: PublicReview[],
  campo: "rating_punctuality" | "rating_attention" | "rating_facilities",
): number | null {
  const valores = reviews.map((r) => r[campo]).filter((v): v is number => v != null);
  if (valores.length === 0) return null;
  return Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 10) / 10;
}

export type ReviewableAppointment = {
  id: string;
  reference: string;
  starts_at: string;
  doctor_id: string;
  doctor_name: string;
  doctor_slug: string;
};

/**
 * Citas ya atendidas que el paciente todavía no ha reseñado.
 *
 * El filtro «todavía no reseñada» se hace aquí y no en la consulta porque
 * PostgREST no sabe expresar «sin fila relacionada» sobre una tabla incrustada
 * sin recurrir a una vista. El volumen es el historial de una persona, así que
 * traerlo entero y descartar en memoria no cuesta nada.
 */
export async function getReviewableAppointments(
  patientId: string,
): Promise<ReviewableAppointment[]> {
  const { data, error } = await supabase
    .from("appointments")
    .select(
      `id, reference, starts_at, doctor_id,
       reviews ( id ),
       doctors ( slug, doctor_profiles ( display_name ),
                 users!doctors_user_id_fkey ( full_name ) )`,
    )
    .eq("patient_id", patientId)
    .eq("status", "completed")
    .order("starts_at", { ascending: false });

  if (error) throw error;

  return (data ?? [])
    .filter((a: any) => !a.reviews || a.reviews.length === 0)
    .map((a: any) => ({
      id: a.id,
      reference: a.reference,
      starts_at: a.starts_at,
      doctor_id: a.doctor_id,
      doctor_name:
        a.doctors?.doctor_profiles?.display_name ??
        a.doctors?.users?.full_name ??
        "tu médico",
      doctor_slug: a.doctors?.slug ?? "",
    }));
}

export type NewReview = {
  appointmentId: string;
  patientId: string;
  doctorId: string;
  rating: number;
  comment?: string;
  puntualidad?: number;
  atencion?: number;
  instalaciones?: number;
  anonima?: boolean;
};

export type ReviewResult = { ok: true; id: string } | { ok: false; error: string };

/**
 * Publica la reseña.
 *
 * Los errores de la base de datos se traducen a algo legible: el trigger
 * responde en español pero la violación de unicidad llega como jerga de
 * PostgreSQL, y «duplicate key value violates unique constraint» no le dice
 * nada a un paciente.
 */
export async function createReview(input: NewReview): Promise<ReviewResult> {
  const { data, error } = await supabase
    .from("reviews")
    .insert({
      appointment_id: input.appointmentId,
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      rating: input.rating,
      comment: input.comment?.trim() || null,
      rating_punctuality: input.puntualidad ?? null,
      rating_attention: input.atencion ?? null,
      rating_facilities: input.instalaciones ?? null,
      is_anonymous: input.anonima ?? false,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Ya dejaste una opinión sobre esta consulta." };
    }
    if (error.message.includes("completada")) {
      return { ok: false, error: "Solo puedes opinar sobre una consulta ya atendida." };
    }
    return { ok: false, error: error.message };
  }

  return { ok: true, id: data.id };
}

/** El paciente cambia si su reseña aparece con nombre o no. */
export async function setReviewAnonymous(reviewId: string, anonima: boolean) {
  const { error } = await supabase
    .from("reviews")
    .update({ is_anonymous: anonima })
    .eq("id", reviewId);

  if (error) throw error;
}

/** Reseñas recibidas por el médico, para su panel. */
export async function getReviewsForDoctor(doctorId: string): Promise<PublicReview[]> {
  const { data, error } = await supabase
    .from("reviews")
    .select(PUBLIC_SELECT)
    .eq("doctor_id", doctorId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as PublicReview[];
}

/**
 * El médico responde públicamente.
 *
 * No puede tocar la calificación ni el texto del paciente: lo impide el trigger
 * `reviews_protect_columns`. La fecha de respuesta la sella la base de datos,
 * no el navegador, para que no dependa del reloj del cliente.
 */
export async function replyToReview(reviewId: string, respuesta: string) {
  const { error } = await supabase
    .from("reviews")
    .update({ doctor_reply: respuesta.trim() })
    .eq("id", reviewId);

  if (error) throw error;
}

export type ReviewRow = Tables<"reviews">;
