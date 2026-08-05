// Control de gastos de la clínica (panel de administración).
//
// Todo lo de aquí exige rol administrativo, y quien lo impone es el RLS
// (`expenses_all_admin`). No se comprueba en este archivo: si un médico llamara
// a estas funciones, PostgreSQL le devolvería vacío o rechazaría la escritura.

import { supabase } from "@/integrations/supabase/client";

export type ConceptoGasto = {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  is_active: boolean;
};

export type Gasto = {
  id: string;
  concept: string;
  amount_cents: number;
  incurred_on: string;
  notes: string | null;
  doctor_id: string | null;
  category_id: string | null;
  expense_categories: { name: string } | null;
  doctors: {
    slug: string;
    users: { full_name: string | null } | null;
    doctor_profiles: { display_name: string | null } | null;
  } | null;
};

export type ResumenGasto = {
  doctor_id: string | null;
  doctor_nombre: string;
  total_cents: number;
  movimientos: number;
};

export async function getConceptos(soloActivos = true): Promise<ConceptoGasto[]> {
  let q = supabase
    .from("expense_categories")
    .select("id, name, slug, description, is_active")
    .order("name");

  if (soloActivos) q = q.eq("is_active", true);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ConceptoGasto[];
}

export async function crearConcepto(name: string, description?: string) {
  const { error } = await supabase
    .from("expense_categories")
    .insert({ name: name.trim(), description: description?.trim() || null });

  if (error) {
    // El índice único es sobre lower(name): "Renta" y "renta" son el mismo
    // concepto, y decírselo así al administrador es más útil que el error de
    // PostgreSQL sobre una restricción que no conoce.
    if (error.code === "23505") throw new Error("Ya existe un concepto con ese nombre.");
    throw error;
  }
}

/** Se desactiva, no se borra: un concepto usado en gastos pasados no puede desaparecer. */
export async function desactivarConcepto(id: string, activo: boolean) {
  const { error } = await supabase
    .from("expense_categories")
    .update({ is_active: activo })
    .eq("id", id);
  if (error) throw error;
}

export async function getGastos(desde?: string, hasta?: string): Promise<Gasto[]> {
  let q = supabase
    .from("expenses")
    .select(
      `id, concept, amount_cents, incurred_on, notes, doctor_id, category_id,
       expense_categories ( name ),
       doctors ( slug, users!doctors_user_id_fkey ( full_name ),
                 doctor_profiles ( display_name ) )`,
    )
    .order("incurred_on", { ascending: false })
    .limit(300);

  if (desde) q = q.gte("incurred_on", desde);
  if (hasta) q = q.lte("incurred_on", hasta);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as Gasto[];
}

/** Totales por médico. Los suma la base de datos, no el navegador. */
export async function getResumen(desde?: string, hasta?: string): Promise<ResumenGasto[]> {
  const { data, error } = await supabase.rpc("expense_summary", {
    p_desde: desde ?? undefined,
    p_hasta: hasta ?? undefined,
  });

  if (error) throw error;
  return ((data ?? []) as ResumenGasto[]).map((r) => ({
    ...r,
    total_cents: Number(r.total_cents),
    movimientos: Number(r.movimientos),
  }));
}

export async function registrarGasto(input: {
  concept: string;
  pesos: number;
  categoryId: string | null;
  doctorId: string | null;
  incurredOn: string;
  notes?: string;
  createdBy: string;
}) {
  const { error } = await supabase.from("expenses").insert({
    concept: input.concept.trim(),
    // Se convierte a centavos aquí, en el único punto donde el importe entra al
    // sistema. Guardarlo en pesos con decimales acumularía errores de redondeo
    // al sumar cientos de gastos.
    amount_cents: Math.round(input.pesos * 100),
    category_id: input.categoryId,
    doctor_id: input.doctorId,
    incurred_on: input.incurredOn,
    notes: input.notes?.trim() || null,
    created_by: input.createdBy,
  });

  if (error) throw error;
}

export async function borrarGasto(id: string) {
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) throw error;
}

/** Médicos verificados, para asignarles el gasto. */
export async function getMedicosParaGasto() {
  const { data, error } = await supabase
    .from("doctors")
    .select(
      `id, users!doctors_user_id_fkey ( full_name ), doctor_profiles ( display_name )`,
    )
    .in("status", ["verified", "suspended"]);

  if (error) throw error;
  return (data ?? []).map((d: any) => ({
    id: d.id as string,
    nombre: d.doctor_profiles?.display_name ?? d.users?.full_name ?? "Médico",
  }));
}

export function pesos(cents: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
