// Catálogos públicos: municipios, especialidades, aseguradoras e idiomas.
//
// Cambian muy poco, así que quien los consuma debería cachearlos con tiempos de
// vida largos (en TanStack Query, `staleTime` de horas).

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Municipality = Pick<Tables<"municipalities">, "id" | "name" | "slug">;
export type Specialty = Pick<
  Tables<"specialties">,
  "id" | "name" | "slug" | "icon" | "is_featured" | "display_order"
>;
export type InsuranceCompany = Pick<Tables<"insurance_companies">, "id" | "name" | "slug">;
export type Language = Pick<Tables<"languages">, "id" | "code" | "name">;

export async function getMunicipalities(): Promise<Municipality[]> {
  const { data, error } = await supabase
    .from("municipalities")
    .select("id, name, slug")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getSpecialties(): Promise<Specialty[]> {
  const { data, error } = await supabase
    .from("specialties")
    .select("id, name, slug, icon, is_featured, display_order")
    .order("display_order")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getInsuranceCompanies(): Promise<InsuranceCompany[]> {
  const { data, error } = await supabase
    .from("insurance_companies")
    .select("id, name, slug")
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export async function getLanguages(): Promise<Language[]> {
  const { data, error } = await supabase.from("languages").select("id, code, name").order("id");
  if (error) throw error;
  return data ?? [];
}
