// Expediente clínico: notas de consulta y documentos (PRD Fase 7).
//
// Es el bloque más sensible del producto. Dos reglas del esquema que conviene
// tener presentes al leer este archivo, porque explican por qué las consultas
// son tan escuetas:
//
//   · Un médico solo lee SUS notas, no las de otros médicos que atiendan al
//     mismo paciente. Un cardiólogo no tiene por qué leer lo que escribió el
//     psiquiatra. Lo impone `medical_records_select_doctor`.
//
//   · Un administrador de la plataforma NO puede leer nada de aquí. No hay
//     policy que se lo permita, y es a propósito.
//
// Ninguna de las dos se comprueba en este archivo. Si se repitieran aquí darían
// a entender que la privacidad depende del navegador.

import { supabase } from "@/integrations/supabase/client";
import type { Enums } from "@/integrations/supabase/types";

export type NotaClinica = {
  id: string;
  appointment_id: string | null;
  chief_complaint: string | null;
  history: string | null;
  physical_exam: string | null;
  diagnosis: string | null;
  treatment_plan: string | null;
  notes: string | null;
  follow_up_date: string | null;
  vitals: Record<string, unknown>;
  created_at: string;
};

export type DocumentoClinico = {
  id: string;
  title: string;
  description: string | null;
  document_type: Enums<"document_type">;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  is_visible_to_patient: boolean;
  uploaded_by: string;
  created_at: string;
};

/** Notas clínicas del paciente que este médico ha escrito. */
export async function getNotasDePaciente(patientId: string): Promise<NotaClinica[]> {
  const { data, error } = await supabase
    .from("medical_records")
    .select(
      `id, appointment_id, chief_complaint, history, physical_exam,
       diagnosis, treatment_plan, notes, follow_up_date, vitals, created_at`,
    )
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as NotaClinica[];
}

/** Documentos del paciente visibles para quien consulta. */
export async function getDocumentosDePaciente(patientId: string): Promise<DocumentoClinico[]> {
  const { data, error } = await supabase
    .from("documents")
    .select(
      `id, title, description, document_type, storage_path,
       mime_type, size_bytes, is_visible_to_patient, uploaded_by, created_at`,
    )
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as DocumentoClinico[];
}

export type NotaConMedico = NotaClinica & {
  medico_nombre: string;
  medico_slug: string | null;
  especialidad: string | null;
};

/**
 * Las notas clínicas del propio paciente, de TODOS sus médicos.
 *
 * Asimetría deliberada con `getNotasDePaciente`: el paciente ve su expediente
 * entero —es suyo— mientras que cada médico solo ve lo que él escribió. Lo
 * decide el RLS, no esta consulta.
 *
 * El nombre del médico se toma de `doctor_profiles`, que es público, y no de
 * `public.users`, que está cerrado a la propia fila y devolvería nulos.
 */
export async function getMisNotas(patientId: string): Promise<NotaConMedico[]> {
  const { data, error } = await supabase
    .from("medical_records")
    .select(
      `id, appointment_id, chief_complaint, history, physical_exam,
       diagnosis, treatment_plan, notes, follow_up_date, vitals, created_at,
       doctors ( slug, doctor_profiles ( display_name ),
                 specialties!doctors_primary_specialty_id_fkey ( name ) )`,
    )
    .eq("patient_id", patientId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((n: any) => ({
    ...n,
    medico_nombre: n.doctors?.doctor_profiles?.display_name ?? "Tu médico",
    medico_slug: n.doctors?.slug ?? null,
    especialidad: n.doctors?.specialties?.name ?? null,
  })) as NotaConMedico[];
}

/** Guarda la nota de una consulta. */
export async function guardarNota(input: {
  patientId: string;
  doctorId: string;
  appointmentId?: string | null;
  chief_complaint?: string;
  diagnosis?: string;
  treatment_plan?: string;
  notes?: string;
  follow_up_date?: string | null;
}) {
  const { error } = await supabase.from("medical_records").insert({
    patient_id: input.patientId,
    doctor_id: input.doctorId,
    appointment_id: input.appointmentId ?? null,
    chief_complaint: input.chief_complaint?.trim() || null,
    diagnosis: input.diagnosis?.trim() || null,
    treatment_plan: input.treatment_plan?.trim() || null,
    notes: input.notes?.trim() || null,
    follow_up_date: input.follow_up_date || null,
  });

  if (error) throw error;
}

export const TIPOS_DOCUMENTO: Array<{ valor: Enums<"document_type">; etiqueta: string }> = [
  { valor: "lab_result", etiqueta: "Análisis de laboratorio" },
  { valor: "imaging", etiqueta: "Estudio de imagen" },
  { valor: "prescription", etiqueta: "Receta" },
  { valor: "referral", etiqueta: "Referencia" },
  { valor: "consent", etiqueta: "Consentimiento" },
  { valor: "insurance", etiqueta: "Seguro" },
  { valor: "other", etiqueta: "Otro" },
];

export type SubidaDocumento =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Sube un estudio al bucket privado y registra su ficha.
 *
 * El archivo va a `<mi_id>/…` porque es lo único que permite escribir la policy
 * de Storage. Quién puede LEERLO después no depende de esa carpeta sino de la
 * fila de `documents`: ahí consta de qué paciente es, y con eso el paciente y
 * su médico tratante pueden abrirlo aunque el archivo esté en la carpeta del
 * otro.
 *
 * El orden importa. Primero el archivo y después la ficha: si se hiciera al
 * revés y fallara la subida, quedaría una ficha apuntando a un archivo que no
 * existe, y el expediente mostraría un estudio imposible de abrir.
 */
export async function subirDocumento(input: {
  archivo: File;
  patientId: string;
  doctorId: string | null;
  uploaderId: string;
  titulo: string;
  tipo: Enums<"document_type">;
  descripcion?: string;
  appointmentId?: string | null;
}): Promise<SubidaDocumento> {
  const { archivo, uploaderId } = input;

  const limpio = archivo.name.replace(/[^\w.\-]/g, "_").slice(-80);
  const ruta = `${uploaderId}/${Date.now()}-${limpio}`;

  const { error: errorSubida } = await supabase.storage
    .from("medical-documents")
    .upload(ruta, archivo, { contentType: archivo.type || undefined });

  if (errorSubida) {
    return { ok: false, error: traducirStorage(errorSubida.message) };
  }

  const { data, error } = await supabase
    .from("documents")
    .insert({
      patient_id: input.patientId,
      doctor_id: input.doctorId,
      uploaded_by: uploaderId,
      appointment_id: input.appointmentId ?? null,
      title: input.titulo.trim(),
      description: input.descripcion?.trim() || null,
      document_type: input.tipo,
      storage_path: ruta,
      mime_type: archivo.type || null,
      size_bytes: archivo.size,
    })
    .select("id")
    .single();

  if (error) {
    // La ficha no se pudo crear, así que nadie podría abrir ese archivo nunca:
    // sin fila en `documents` no hay quien lo autorice. Se retira para no dejar
    // un estudio médico almacenado y fuera de todo control.
    await supabase.storage.from("medical-documents").remove([ruta]);
    return { ok: false, error: error.message };
  }

  return { ok: true, id: data.id };
}

/**
 * URL temporal para abrir o descargar un documento.
 *
 * El bucket es privado: no hay URL pública. Supabase firma el enlace y comprueba
 * el RLS al hacerlo, así que si quien pide no tiene permiso, esto falla — no
 * devuelve un enlace que luego no funcione.
 */
export async function urlDeDocumento(storagePath: string, segundos = 300): Promise<string> {
  const { data, error } = await supabase.storage
    .from("medical-documents")
    .createSignedUrl(storagePath, segundos);

  if (error) throw new Error("No pudimos abrir el documento. Puede que ya no esté disponible.");
  return data.signedUrl;
}

/** Borra la ficha; un trigger retira el archivo del bucket. */
export async function borrarDocumento(id: string) {
  const { error } = await supabase.from("documents").delete().eq("id", id);
  if (error) throw error;
}

export function pesoLegible(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function traducirStorage(mensaje: string): string {
  const m = mensaje.toLowerCase();
  if (m.includes("exceeded") || m.includes("too large")) {
    return "El archivo pesa más de 25 MB. Comprímelo o divídelo.";
  }
  if (m.includes("mime") || m.includes("content type")) {
    return "Ese formato no se admite. Usa PDF, JPG o PNG.";
  }
  return mensaje;
}
