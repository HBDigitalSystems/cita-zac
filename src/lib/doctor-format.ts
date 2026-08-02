// Cómo se presentan los datos de un médico.
//
// Vive aparte de las consultas para que la conversión de centavos y el trato
// profesional se hagan en un solo sitio. Antes estaban en los datos simulados;
// al pasar a la base de datos real había que sacarlos de ahí o la aplicación
// seguiría dependiendo de un archivo de mentira.

import type { DoctorSearchResult } from "@/services/doctors";

/**
 * "Dra. Ana Sofía García" — el trato depende del sexo registrado.
 *
 * El nombre viene de `doctor_profiles.display_name` y no de la cuenta: el RLS
 * de `public.users` no deja que un visitante lea el nombre de nadie, y abrirlo
 * expondría también su correo y su teléfono.
 */
export function doctorDisplayName(doctor: {
  gender: string | null;
  profile: { display_name: string | null } | null;
}): string {
  const title = doctor.gender === "female" ? "Dra." : "Dr.";
  const name = doctor.profile?.display_name?.trim();
  return name ? `${title} ${name}` : "Médico";
}

/** Los precios se guardan en centavos; no se muestran sin pasar por aquí. */
export function formatPrice(cents: number | null | undefined, currency = "MXN"): string {
  if (cents === null || cents === undefined) return "Precio no publicado";
  return `$${(cents / 100).toLocaleString("es-MX")} ${currency}`;
}

/** El consultorio principal, o el primero si ninguno está marcado. */
export function primaryRoom(doctor: DoctorSearchResult) {
  return doctor.consulting_rooms.find((room) => room.is_primary) ?? doctor.consulting_rooms[0];
}

const WEEKDAY_NAMES = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
] as const;

export function weekdayName(weekday: number): string {
  return WEEKDAY_NAMES[weekday] ?? "";
}

/** "09:00:00" → "09:00" */
export function formatTime(time: string): string {
  return time.slice(0, 5);
}

/** Minutos promedio de respuesta → "< 1 h", "Hoy mismo"… */
export function formatResponseTime(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined) return null;
  if (minutes <= 60) return "< 1 h";
  if (minutes <= 120) return "< 2 h";
  if (minutes <= 480) return "Hoy mismo";
  return "< 24 h";
}

/** "Hoy 10:30", "Mañana 09:00", "Jueves 16:00". */
export function formatNextAvailable(iso: string | null, from: Date = new Date()): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  const dayDiff = Math.round(
    (new Date(date).setHours(0, 0, 0, 0) - new Date(from).setHours(0, 0, 0, 0)) / 86_400_000,
  );
  const time = date.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  if (dayDiff <= 0) return `Hoy ${time}`;
  if (dayDiff === 1) return `Mañana ${time}`;
  return `${WEEKDAY_NAMES[date.getDay()]} ${time}`;
}
