// Validación del alta de paciente (PRD Fase 3).
//
// Las reglas replican las restricciones que la base de datos ya impone en la
// tabla `patients`: formato de CURP, código postal de cinco dígitos y fecha de
// nacimiento razonable. Validar aquí no sustituye a la base de datos —esa es la
// que manda—, pero evita que alguien rellene cinco pasos para que el servidor
// lo rechace al final.

import { z } from "zod";

export const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

export const GENDERS = [
  { value: "female", label: "Mujer" },
  { value: "male", label: "Hombre" },
  { value: "other", label: "Otro" },
  { value: "prefer_not_to_say", label: "Prefiero no decirlo" },
] as const;

/** CURP mexicana: 18 caracteres con estructura oficial. */
const curp = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[0-9A-Z][0-9]$/,
    "La CURP debe tener 18 caracteres con el formato oficial.",
  )
  .optional()
  .or(z.literal(""));

const postalCode = z
  .string()
  .regex(/^[0-9]{5}$/, "El código postal son 5 dígitos.")
  .optional()
  .or(z.literal(""));

const phone = z
  .string()
  .regex(/^\+?[0-9]{10,15}$/, "Escribe 10 dígitos, sin espacios ni guiones.")
  .optional()
  .or(z.literal(""));

// Los pasos se validan por separado para poder avanzar de uno en uno.

export const personalStepSchema = z.object({
  birthDate: z
    .string()
    .min(1, "Necesitamos tu fecha de nacimiento.")
    .refine((value) => {
      const date = new Date(value);
      return !Number.isNaN(date.getTime()) && date <= new Date() && date > new Date("1900-01-01");
    }, "Esa fecha no parece correcta."),
  gender: z.enum(["female", "male", "other", "prefer_not_to_say"], {
    errorMap: () => ({ message: "Elige una opción." }),
  }),
  curp,
});

export const addressStepSchema = z.object({
  // El mensaje va también en el parseo, no solo en .positive(): con el campo
  // vacío, z.coerce.number() produce NaN y saldría el genérico de Zod en inglés.
  municipalityId: z.coerce
    .number({
      required_error: "Elige tu municipio.",
      invalid_type_error: "Elige tu municipio.",
    })
    .int()
    .positive("Elige tu municipio."),
  address: z.string().optional(),
  postalCode,
});

export const healthStepSchema = z.object({
  bloodType: z.enum(BLOOD_TYPES).optional().or(z.literal("")),
  allergies: z.string().optional(),
  chronicConditions: z.string().optional(),
  currentMedications: z.string().optional(),
});

export const emergencyStepSchema = z.object({
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: phone,
  emergencyContactRelationship: z.string().optional(),
  insuranceCompanyId: z.string().optional(),
  insurancePolicyNumber: z.string().optional(),
});

export const patientOnboardingSchema = personalStepSchema
  .merge(addressStepSchema)
  .merge(healthStepSchema)
  .merge(emergencyStepSchema);

export type PatientOnboardingValues = z.infer<typeof patientOnboardingSchema>;

/** Los campos que valida cada paso, para comprobar solo lo visible. */
export const STEP_FIELDS = [
  ["birthDate", "gender", "curp"],
  ["municipalityId", "address", "postalCode"],
  ["bloodType", "allergies", "chronicConditions", "currentMedications"],
  [
    "emergencyContactName",
    "emergencyContactPhone",
    "emergencyContactRelationship",
    "insuranceCompanyId",
    "insurancePolicyNumber",
  ],
] as const satisfies ReadonlyArray<ReadonlyArray<keyof PatientOnboardingValues>>;

/**
 * "Polen, penicilina, mariscos" → ["Polen", "penicilina", "mariscos"]
 *
 * En la base de datos son arrays de texto; en el formulario se escriben
 * separados por comas porque pedir "añadir elemento" para tres alergias es
 * más fricción que valor.
 */
export function toList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
