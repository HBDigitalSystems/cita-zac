// Consultas del directorio público de médicos.
//
// Toda la visibilidad la decide el RLS: `doctors_select_public` solo deja pasar
// perfiles verificados y con suscripción activa. Por eso aquí no se filtra por
// estado — si un médico no debe verse, la base de datos ya no lo devuelve.
// Añadir un `.eq("status", "verified")` daría una falsa sensación de seguridad:
// parecería que la protección vive en el cliente cuando vive en PostgreSQL.

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

/**
 * Forma anidada que devuelve el select de abajo. Es la misma que consumían los
 * datos simulados, así que los componentes no cambian.
 */
// El nombre sale de `doctor_profiles.display_name`, NO de `public.users`.
// Esa tabla tiene RLS de "cada quien ve lo suyo", así que a un visitante
// anónimo le llegaría null; y abrirla al público expondría correo y teléfono,
// porque el RLS decide qué filas se ven, no qué columnas.
//
// Nulabilidad: `profile` va como obligatorio y `municipality` también. Lo
// garantiza el esquema —consulting_rooms.municipality_id es NOT NULL y un
// perfil publicado siempre pasó por el alta— y las filas incompletas se
// descartan al normalizar. Tiparlos como nullables obligaría a comprobar en
// cada uso algo que nunca ocurre.
export type DoctorSearchResult = {
  id: string;
  slug: string;
  status: Tables<"doctors">["status"];
  license_number: string;
  years_of_experience: number | null;
  gender: Tables<"doctors">["gender"];
  rating_average: number;
  reviews_count: number;
  appointments_count: number;

  profile: Tables<"doctor_profiles">;
  specialty: Pick<Tables<"specialties">, "id" | "name" | "slug" | "icon"> | null;
  consulting_rooms: Array<
    Pick<
      Tables<"consulting_rooms">,
      | "id"
      | "name"
      | "address"
      | "address_details"
      | "phone"
      | "is_primary"
      | "has_parking"
      | "is_accessible"
    > & { municipality: Pick<Tables<"municipalities">, "id" | "name" | "slug"> }
  >;
  languages: Array<Pick<Tables<"languages">, "id" | "code" | "name">>;
  insurances: Array<Pick<Tables<"insurance_companies">, "id" | "name" | "slug">>;
  services: Array<
    Pick<Tables<"doctor_services">, "id" | "name" | "price_cents" | "duration_minutes">
  >;
};

export type DoctorDetail = DoctorSearchResult & {
  university: string | null;
  graduation_year: number | null;
  working_hours: Array<Pick<Tables<"working_hours">, "id" | "weekday" | "start_time" | "end_time">>;
  certifications: Array<
    Pick<Tables<"doctor_certifications">, "id" | "title" | "issuing_body" | "issued_year">
  >;
};

// Las relaciones se nombran por su clave foránea (`tabla!nombre_fkey`) siempre
// que haya más de un camino posible. Con `specialties` los hay dos —
// primary_specialty_id y la tabla puente doctor_specialties— y sin desambiguar
// PostgREST responde PGRST201 y falla la consulta entera, no solo ese trozo.
//
// Esta cadena es un parámetro de URL, no SQL: no admite comentarios dentro.
const LIST_SELECT = `
  id, slug, status, license_number, years_of_experience, gender,
  rating_average, reviews_count, appointments_count,
  doctor_profiles ( * ),
  specialties!doctors_primary_specialty_id_fkey ( id, name, slug, icon ),
  consulting_rooms ( id, name, address, address_details, phone, is_primary,
                     has_parking, is_accessible,
                     municipalities ( id, name, slug ) ),
  doctor_languages ( languages ( id, code, name ) ),
  doctor_insurances ( insurance_companies ( id, name, slug ) ),
  doctor_services ( id, name, price_cents, duration_minutes )
`;

const DETAIL_SELECT = `
  ${LIST_SELECT},
  university, graduation_year,
  doctor_certifications ( id, title, issuing_body, issued_year )
`;

/**
 * Aplana las tablas puente en listas simples.
 *
 * Devuelve null si al médico le falta el perfil: sin él no hay nada que
 * enseñar, y dejarlo pasar obligaría a comprobar nulos en toda la interfaz.
 * Ocurre solo con filas creadas a mano en la base de datos.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(row: any): DoctorSearchResult | null {
  if (!row.doctor_profiles) return null;

  return {
    id: row.id,
    slug: row.slug,
    status: row.status,
    license_number: row.license_number,
    years_of_experience: row.years_of_experience,
    gender: row.gender,
    rating_average: Number(row.rating_average ?? 0),
    reviews_count: row.reviews_count ?? 0,
    appointments_count: row.appointments_count ?? 0,

    profile: row.doctor_profiles,
    specialty: row.specialties ?? null,

    consulting_rooms: (row.consulting_rooms ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((room: any) => room.municipalities)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((room: any) => ({
        ...room,
        municipality: room.municipalities,
      })),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    languages: (row.doctor_languages ?? []).map((l: any) => l.languages).filter(Boolean),
    insurances: (row.doctor_insurances ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((i: any) => i.insurance_companies)
      .filter(Boolean),
    services: row.doctor_services ?? [],
  };
}

export type DoctorFilters = {
  query?: string;
  /**
   * Identificador, no slug: filtrar por `specialties.slug` obliga a marcar el
   * embed como `!inner` en el select, y sin eso PostgREST rechaza la consulta
   * entera. `primary_specialty_id` es una columna de la propia tabla `doctors`,
   * así que el filtro es directo y además usa su índice.
   *
   * Limitación conocida: filtra por la especialidad PRINCIPAL. Cuando un médico
   * pueda declarar varias, esto tendrá que mirar `doctor_specialties`.
   */
  specialtyId?: number;
  municipalitySlug?: string;
  gender?: "male" | "female";
  onlyTelemedicine?: boolean;
  onlyAcceptingNew?: boolean;
  minPriceCents?: number;
  maxPriceCents?: number;
  insuranceIds?: number[];
  languageIds?: number[];
  sort?: "rating" | "precio-asc" | "precio-desc" | "experiencia";
};

/**
 * Directorio público de médicos.
 *
 * NOTA sobre el filtrado: los criterios que PostgREST resuelve bien —
 * especialidad, sexo, orden— van al servidor. Los que dependen de tablas
 * anidadas (municipio, aseguradora, idioma, precio) se aplican después sobre el
 * resultado. Con el volumen actual es intrascendente; cuando el directorio
 * crezca hay que mover todo esto a una función de PostgreSQL y paginar allí,
 * porque traerse el directorio entero para filtrarlo en el navegador no escala.
 */
export async function searchDoctors(filters: DoctorFilters = {}): Promise<DoctorSearchResult[]> {
  let request = supabase.from("doctors").select(LIST_SELECT);

  if (filters.specialtyId) {
    request = request.eq("primary_specialty_id", filters.specialtyId);
  }
  if (filters.gender) {
    request = request.eq("gender", filters.gender);
  }

  switch (filters.sort) {
    case "experiencia":
      request = request.order("years_of_experience", { ascending: false, nullsFirst: false });
      break;
    case "rating":
    default:
      request = request
        .order("rating_average", { ascending: false })
        .order("reviews_count", { ascending: false });
  }

  const { data, error } = await request;
  if (error) throw error;

  let results = (data ?? [])
    .map(normalize)
    .filter((doctor): doctor is DoctorSearchResult => doctor !== null);

  const term = filters.query?.trim().toLowerCase();
  if (term) {
    results = results.filter((doctor) =>
      [
        doctor.profile.display_name ?? "",
        doctor.specialty?.name ?? "",
        ...doctor.services.map((s) => s.name),
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }

  if (filters.municipalitySlug) {
    results = results.filter((doctor) =>
      doctor.consulting_rooms.some((room) => room.municipality?.slug === filters.municipalitySlug),
    );
  }

  if (filters.onlyTelemedicine) {
    results = results.filter((doctor) => doctor.profile?.offers_telemedicine);
  }
  if (filters.onlyAcceptingNew) {
    results = results.filter((doctor) => doctor.profile?.accepts_new_patients);
  }

  if (filters.minPriceCents !== undefined || filters.maxPriceCents !== undefined) {
    results = results.filter((doctor) => {
      const price = doctor.profile?.price_in_person_cents;
      // Sin precio publicado no se descarta: no tener tarifa visible no
      // significa estar fuera del rango que busca el paciente.
      if (price === null || price === undefined) return true;
      if (filters.minPriceCents !== undefined && price < filters.minPriceCents) return false;
      if (filters.maxPriceCents !== undefined && price > filters.maxPriceCents) return false;
      return true;
    });
  }

  if (filters.insuranceIds?.length) {
    results = results.filter((doctor) =>
      doctor.insurances.some((insurance) => filters.insuranceIds!.includes(insurance.id)),
    );
  }

  if (filters.languageIds?.length) {
    results = results.filter((doctor) =>
      filters.languageIds!.every((id) => doctor.languages.some((language) => language.id === id)),
    );
  }

  if (filters.sort === "precio-asc" || filters.sort === "precio-desc") {
    const priceOf = (d: DoctorSearchResult) =>
      d.profile?.price_in_person_cents ?? Number.MAX_SAFE_INTEGER;
    results = [...results].sort((a, b) =>
      filters.sort === "precio-asc" ? priceOf(a) - priceOf(b) : priceOf(b) - priceOf(a),
    );
  }

  return results;
}

/** Perfil público completo. Devuelve null si no existe o no es visible. */
export async function getDoctorBySlug(slug: string): Promise<DoctorDetail | null> {
  const { data, error } = await supabase
    .from("doctors")
    .select(DETAIL_SELECT)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any;
  const rooms = row.consulting_rooms ?? [];
  const primaryRoomId = (rooms.find((r: { is_primary: boolean }) => r.is_primary) ?? rooms[0])?.id;

  // Los horarios cuelgan del consultorio, no del médico: se piden aparte para
  // no multiplicar filas en el select anidado principal.
  const { data: hours } = primaryRoomId
    ? await supabase
        .from("working_hours")
        .select("id, weekday, start_time, end_time")
        .eq("consulting_room_id", primaryRoomId)
        .order("weekday")
        .order("start_time")
    : { data: [] };

  const base = normalize(row);
  if (!base) return null;

  return {
    ...base,
    university: row.university ?? null,
    graduation_year: row.graduation_year ?? null,
    working_hours: hours ?? [],
    certifications: row.doctor_certifications ?? [],
  };
}

/** Los mejor calificados, para la portada. */
export async function getFeaturedDoctors(limit = 3): Promise<DoctorSearchResult[]> {
  const { data, error } = await supabase
    .from("doctors")
    .select(LIST_SELECT)
    .order("rating_average", { ascending: false })
    .order("reviews_count", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? [])
    .map(normalize)
    .filter((doctor): doctor is DoctorSearchResult => doctor !== null);
}

/** Cuántos médicos visibles hay por especialidad, para las tarjetas de portada. */
export async function getSpecialtyCounts(): Promise<Record<number, number>> {
  const { data, error } = await supabase.from("doctors").select("primary_specialty_id");
  if (error) throw error;

  const counts: Record<number, number> = {};
  for (const row of data ?? []) {
    const id = row.primary_specialty_id;
    if (id !== null) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}
