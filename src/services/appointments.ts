// Disponibilidad y reserva de citas (PRD Fase 6).

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Slot = { start: string; end: string };

/** Un día de agenda con sus huecos libres. */
export type DaySlots = {
  date: string;
  label: string;
  slots: Slot[];
};

/**
 * Huecos libres de un consultorio.
 *
 * Va contra la función `get_available_slots` de PostgreSQL y no contra las
 * tablas: el cálculo necesita descontar las citas ocupadas, que el RLS oculta
 * a los pacientes —y debe ocultarlas—. La función corre con SECURITY DEFINER y
 * devuelve solo lo libre, sin filtrar ni una cita ajena.
 */
export async function getAvailableSlots(
  doctorId: string,
  roomId: string,
  days = 14,
): Promise<Slot[]> {
  const { data, error } = await supabase.rpc("get_available_slots", {
    p_doctor_id: doctorId,
    p_room_id: roomId,
    p_from: new Date().toISOString().slice(0, 10),
    p_days: days,
  });

  if (error) throw error;

  return ((data ?? []) as Array<{ slot_start: string; slot_end: string }>).map((row) => ({
    start: row.slot_start,
    end: row.slot_end,
  }));
}

const WEEKDAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/**
 * Zona en la que se interpretan las agendas. Coincide con el ajuste
 * `platform.timezone` que usa la función de PostgreSQL.
 *
 * El día de una cita tiene que ser el del consultorio, no el del navegador ni
 * el de UTC: un hueco de las 19:00 en Zacatecas es la 01:00 UTC del día
 * siguiente, y agruparlo por UTC lo mandaba al día equivocado. El síntoma era
 * un médico que no trabaja sábados con huecos el sábado, heredados del viernes.
 */
const CLINIC_TIMEZONE = "America/Mexico_City";

/** "2026-08-03" en la zona del consultorio, no en UTC. */
function clinicDateKey(iso: string): string {
  // en-CA da directamente el formato aaaa-mm-dd.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Agrupa los huecos por día, con la etiqueta que verá el paciente. */
export function groupByDay(slots: Slot[]): DaySlots[] {
  const todayKey = clinicDateKey(new Date().toISOString());

  const byDate = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = clinicDateKey(slot.start);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key)!.push(slot);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, daySlots]) => {
      // Mediodía para calcular la diferencia de días: evita que un cambio de
      // horario de verano desplace la cuenta.
      const day = new Date(`${date}T12:00:00`);
      const today = new Date(`${todayKey}T12:00:00`);
      const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);

      const label =
        diff === 0
          ? "Hoy"
          : diff === 1
            ? "Mañana"
            : `${WEEKDAY_NAMES[day.getDay()].slice(0, 3)} ${day.getDate()}`;

      return { date, label, slots: daySlots };
    });
}

/** "16:30" en la zona del consultorio. */
export function formatSlotTime(iso: string): string {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: CLINIC_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export type BookingInput = {
  patientId: string;
  doctorId: string;
  roomId: string;
  slot: Slot;
  modality: Tables<"appointments">["modality"];
  reason: string;
  priceCents: number | null;
  isFirstVisit: boolean;
};

export type BookingResult =
  | { ok: true; reference: string; id: string }
  | { ok: false; reason: "taken" | "denied" | "unknown"; message: string };

/**
 * Crea la cita.
 *
 * El caso interesante es `taken`: entre que el paciente vio el hueco y pulsó
 * reservar, otra persona pudo quedárselo. Quien lo impide no es esta función
 * sino una restricción EXCLUDE en PostgreSQL, así que la carrera se resuelve
 * siempre, incluso con dos peticiones simultáneas.
 */
export async function bookAppointment(input: BookingInput): Promise<BookingResult> {
  const { data, error } = await supabase
    .from("appointments")
    .insert({
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      consulting_room_id: input.roomId,
      starts_at: input.slot.start,
      ends_at: input.slot.end,
      status: "pending",
      modality: input.modality,
      reason: input.reason || null,
      is_first_visit: input.isFirstVisit,
      price_cents: input.priceCents,
    })
    .select("id, reference")
    .single();

  if (error) {
    // 23P01 = violación de una restricción EXCLUDE: alguien reservó antes.
    if (error.code === "23P01" || error.message.includes("no_double_booking")) {
      return {
        ok: false,
        reason: "taken",
        message: "Alguien acaba de reservar ese horario. Elige otro, por favor.",
      };
    }
    if (error.code === "42501") {
      return {
        ok: false,
        reason: "denied",
        message: "Tu sesión caducó. Vuelve a iniciar sesión e inténtalo de nuevo.",
      };
    }
    return { ok: false, reason: "unknown", message: error.message };
  }

  return { ok: true, id: data.id, reference: data.reference };
}

/** Las citas del paciente, para su panel. */
export async function getPatientAppointments(patientId: string) {
  const { data, error } = await supabase
    .from("appointments")
    .select(
      `id, reference, starts_at, ends_at, status, modality, reason, price_cents,
       doctors ( slug, users!doctors_user_id_fkey ( full_name ), gender,
                 specialties!doctors_primary_specialty_id_fkey ( name ) ),
       consulting_rooms ( name, address, municipalities ( name ) )`,
    )
    .eq("patient_id", patientId)
    .order("starts_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/**
 * La agenda del médico, con los datos del paciente.
 *
 * El nombre y el teléfono vienen de `public.users`, que un médico solo puede
 * leer para los pacientes con los que tiene cita — lo restringe una policy de
 * RLS, no esta consulta.
 */
export async function getDoctorAppointments(doctorId: string) {
  const { data, error } = await supabase
    .from("appointments")
    .select(
      `id, reference, starts_at, ends_at, status, modality, reason, price_cents, is_first_visit,
       patients ( id, birth_date, gender, blood_type, allergies, chronic_conditions,
                  emergency_contact_name, emergency_contact_phone,
                  emergency_contact_relationship,
                  users ( full_name, email, phone ) ),
       consulting_rooms ( name )`,
    )
    .eq("doctor_id", doctorId)
    .order("starts_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/** El médico confirma una cita que estaba pendiente. */
export async function confirmAppointment(appointmentId: string) {
  const { error } = await supabase
    .from("appointments")
    .update({ status: "confirmed" })
    .eq("id", appointmentId);

  if (error) throw error;
}

/**
 * El médico marca la cita como atendida.
 *
 * Tiene dos efectos en cadena que dispara la base de datos: incrementa el
 * contador de consultas del médico y habilita que el paciente deje reseña.
 */
export async function completeAppointment(appointmentId: string) {
  const { error } = await supabase
    .from("appointments")
    .update({ status: "completed" })
    .eq("id", appointmentId);

  if (error) throw error;
}

/**
 * Cancela una cita. El trigger de la base de datos sella la fecha y el autor.
 *
 * Quién cancela importa y por eso es explícito: el estado queda registrado como
 * `cancelled_by_patient` o `cancelled_by_doctor`, y de ahí dependen las
 * políticas de reembolso y las métricas de cumplimiento del médico.
 */
export async function cancelAppointment(
  appointmentId: string,
  quien: "patient" | "doctor" = "patient",
  reason?: string,
) {
  const { error } = await supabase
    .from("appointments")
    .update({
      status: quien === "doctor" ? "cancelled_by_doctor" : "cancelled_by_patient",
      cancellation_reason: reason ?? null,
    })
    .eq("id", appointmentId);

  if (error) throw error;
}
