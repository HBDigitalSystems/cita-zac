// Consultas del panel de administración (PRD Fase 7).
//
// Todo lo de aquí exige rol administrativo. No hay ninguna comprobación en este
// archivo a propósito: quien decide es el RLS (`doctors_all_admin`,
// `users_all_admin`). Si un paciente llamara a estas funciones, PostgreSQL
// devolvería vacío o rechazaría la escritura. Duplicar la comprobación en el
// cliente daría la falsa impresión de que la seguridad vive aquí.

import { supabase } from "@/integrations/supabase/client";
import type { Enums, Tables } from "@/integrations/supabase/types";

export type DoctorForReview = {
  id: string;
  slug: string;
  status: Enums<"doctor_status">;
  license_number: string;
  specialty_license_number: string | null;
  university: string | null;
  graduation_year: number | null;
  years_of_experience: number | null;
  gender: Tables<"doctors">["gender"];
  created_at: string;
  rejection_reason: string | null;
  has_active_subscription: boolean;

  users: { full_name: string | null; email: string | null; phone: string | null } | null;
  specialties: { name: string } | null;
  doctor_profiles: {
    display_name: string | null;
    headline: string | null;
    biography: string | null;
    photo_url: string | null;
    price_in_person_cents: number | null;
  } | null;
  consulting_rooms: Array<{
    name: string;
    address: string;
    municipalities: { name: string } | null;
  }>;
};

const REVIEW_SELECT = `
  id, slug, status, license_number, specialty_license_number,
  university, graduation_year, years_of_experience, gender,
  created_at, rejection_reason, has_active_subscription,
  users!doctors_user_id_fkey ( full_name, email, phone ),
  specialties!doctors_primary_specialty_id_fkey ( name ),
  doctor_profiles ( display_name, headline, biography, photo_url, price_in_person_cents ),
  consulting_rooms ( name, address, municipalities ( name ) )
`;

/** Médicos que esperan revisión, los más antiguos primero. */
export async function getDoctorsForReview(): Promise<DoctorForReview[]> {
  const { data, error } = await supabase
    .from("doctors")
    .select(REVIEW_SELECT)
    .in("status", ["pending_verification", "draft", "rejected"])
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as DoctorForReview[];
}

/** Médicos ya resueltos, para consultar el histórico. */
export async function getReviewedDoctors(): Promise<DoctorForReview[]> {
  const { data, error } = await supabase
    .from("doctors")
    .select(REVIEW_SELECT)
    .in("status", ["verified", "suspended"])
    .order("verified_at", { ascending: false, nullsFirst: false });

  if (error) throw error;
  return (data ?? []) as unknown as DoctorForReview[];
}

/**
 * Aprueba a un médico.
 *
 * `verified_by` deja constancia de quién lo autorizó: en una plataforma médica
 * hay que poder responder "¿quién validó esta cédula?" meses después. El
 * trigger de auditoría además guarda el cambio completo en `audit_logs`.
 */
export async function approveDoctor(doctorId: string, adminUserId: string) {
  const { error } = await supabase
    .from("doctors")
    .update({
      status: "verified",
      verified_at: new Date().toISOString(),
      verified_by: adminUserId,
      rejection_reason: null,
    })
    .eq("id", doctorId);

  if (error) throw error;
}

/** Rechaza a un médico. El motivo es obligatorio: se le muestra en su panel. */
export async function rejectDoctor(doctorId: string, reason: string) {
  const { error } = await supabase
    .from("doctors")
    .update({ status: "rejected", rejection_reason: reason })
    .eq("id", doctorId);

  if (error) throw error;
}

/** Suspende un perfil ya publicado. Deja de verse en el buscador al instante. */
export async function suspendDoctor(doctorId: string, reason: string) {
  const { error } = await supabase
    .from("doctors")
    .update({ status: "suspended", rejection_reason: reason })
    .eq("id", doctorId);

  if (error) throw error;
}

export type PlatformStats = {
  medicos_publicados: number;
  medicos_pendientes: number;
  pacientes: number;
  citas: number;
};

/**
 * Cifras de la portada del panel.
 *
 * Se piden con `head: true` y `count: exact`: solo viaja el número, no las
 * filas. Contar pacientes trayéndose la tabla entera sería absurdo, y además
 * innecesario para pintar un dígito.
 */
export async function getPlatformStats(): Promise<PlatformStats> {
  const [publicados, pendientes, pacientes, citas] = await Promise.all([
    supabase
      .from("doctors")
      .select("*", { count: "exact", head: true })
      .eq("status", "verified")
      .then(({ count }) => count ?? 0),
    supabase
      .from("doctors")
      .select("*", { count: "exact", head: true })
      .in("status", ["pending_verification", "draft"])
      .then(({ count }) => count ?? 0),
    supabase
      .from("patients")
      .select("*", { count: "exact", head: true })
      .then(({ count }) => count ?? 0),
    supabase
      .from("appointments")
      .select("*", { count: "exact", head: true })
      .then(({ count }) => count ?? 0),
  ]);

  return {
    medicos_publicados: publicados,
    medicos_pendientes: pendientes,
    pacientes,
    citas,
  };
}
