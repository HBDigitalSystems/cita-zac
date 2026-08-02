// Validación del alta profesional del médico (PRD Fase 4).
//
// Refleja las restricciones que la base de datos ya impone sobre `doctors`,
// `doctor_profiles`, `consulting_rooms` y `working_hours`. Los precios se
// escriben en pesos y se convierten a centavos al guardar, porque la columna es
// un entero de centavos.

import { z } from "zod";

/** Un bloque horario de un día concreto. Varios por día modelan el descanso. */
export type ScheduleBlock = {
  weekday: number;
  startTime: string;
  endTime: string;
};

export const WEEKDAYS = [
  { value: 1, label: "Lunes", short: "L" },
  { value: 2, label: "Martes", short: "M" },
  { value: 3, label: "Miércoles", short: "X" },
  { value: 4, label: "Jueves", short: "J" },
  { value: 5, label: "Viernes", short: "V" },
  { value: 6, label: "Sábado", short: "S" },
  { value: 0, label: "Domingo", short: "D" },
] as const;

// La cédula profesional mexicana es numérica en emisiones antiguas y
// alfanumérica en las recientes. El constraint de la tabla acepta 6-12.
const licenseNumber = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9A-Z]{6,12}$/, "La cédula son 6 a 12 caracteres, sin espacios ni guiones.");

const currentYear = new Date().getFullYear();

/** Pesos → se admite vacío; el precio se publica o no, pero nunca es negativo. */
const priceInPesos = z
  .string()
  .refine(
    (v) => v === "" || (!Number.isNaN(Number(v)) && Number(v) >= 0),
    "Escribe un importe válido.",
  )
  .refine((v) => v === "" || Number(v) <= 100000, "Ese importe parece demasiado alto.");

export const credentialsStepSchema = z.object({
  licenseNumber,
  specialtyLicenseNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[0-9A-Z]{6,12}$/, "La cédula son 6 a 12 caracteres.")
    .optional()
    .or(z.literal("")),
  // El mensaje va también en el parseo, no solo en .positive(): con el campo
  // vacío, z.coerce.number() produce NaN y el error que sale es el genérico de
  // Zod en inglés ("Expected number, received nan").
  primarySpecialtyId: z.coerce
    .number({
      required_error: "Elige tu especialidad principal.",
      invalid_type_error: "Elige tu especialidad principal.",
    })
    .int()
    .positive("Elige tu especialidad principal."),
  university: z.string().optional(),
  graduationYear: z
    .string()
    .refine(
      (v) => v === "" || (Number(v) >= 1930 && Number(v) <= currentYear),
      `El año debe estar entre 1930 y ${currentYear}.`,
    )
    .optional()
    .or(z.literal("")),
  yearsOfExperience: z
    .string()
    .refine((v) => v === "" || (Number(v) >= 0 && Number(v) <= 70), "Entre 0 y 70 años.")
    .optional()
    .or(z.literal("")),
  gender: z.enum(["female", "male", "other", "prefer_not_to_say"]),
});

export const profileStepSchema = z.object({
  headline: z.string().max(120, "Máximo 120 caracteres.").optional(),
  biography: z
    .string()
    .min(40, "Escribe al menos 40 caracteres: es lo primero que lee un paciente.")
    .max(2000, "Máximo 2000 caracteres."),
  priceInPerson: priceInPesos,
  priceVideo: priceInPesos,
  priceFollowUp: priceInPesos,
  acceptsNewPatients: z.boolean(),
  offersTelemedicine: z.boolean(),
  offersEmergency: z.boolean(),
  cancellationHours: z
    .string()
    .refine((v) => v === "" || (Number(v) >= 0 && Number(v) <= 168), "Entre 0 y 168 horas."),
});

export const roomStepSchema = z.object({
  roomName: z.string().min(3, "Ponle un nombre a tu consultorio."),
  municipalityId: z.coerce
    .number({
      required_error: "Elige el municipio.",
      invalid_type_error: "Elige el municipio.",
    })
    .int()
    .positive("Elige el municipio."),
  address: z.string().min(5, "Escribe la calle y el número."),
  addressDetails: z.string().optional(),
  roomPhone: z
    .string()
    .regex(/^\+?[0-9]{10,15}$/, "Escribe 10 dígitos, sin espacios ni guiones.")
    .optional()
    .or(z.literal("")),
  postalCode: z
    .string()
    .regex(/^[0-9]{5}$/, "El código postal son 5 dígitos.")
    .optional()
    .or(z.literal("")),
  slotDuration: z.coerce.number().int().min(5).max(240),
  hasParking: z.boolean(),
  isAccessible: z.boolean(),
});

export const doctorOnboardingSchema = credentialsStepSchema
  .merge(profileStepSchema)
  .merge(roomStepSchema);

export type DoctorOnboardingValues = z.infer<typeof doctorOnboardingSchema>;

export const DOCTOR_STEP_FIELDS = [
  [
    "licenseNumber",
    "specialtyLicenseNumber",
    "primarySpecialtyId",
    "university",
    "graduationYear",
    "yearsOfExperience",
    "gender",
  ],
  [
    "headline",
    "biography",
    "priceInPerson",
    "priceVideo",
    "priceFollowUp",
    "acceptsNewPatients",
    "offersTelemedicine",
    "offersEmergency",
    "cancellationHours",
  ],
  [
    "roomName",
    "municipalityId",
    "address",
    "addressDetails",
    "roomPhone",
    "postalCode",
    "slotDuration",
    "hasParking",
    "isAccessible",
  ],
] as const satisfies ReadonlyArray<ReadonlyArray<keyof DoctorOnboardingValues>>;

/** "1200" → 120000 centavos. Cadena vacía significa "no publicado". */
export function pesosToCents(value: string | undefined): number | null {
  if (!value || value.trim() === "") return null;
  const pesos = Number(value);
  if (Number.isNaN(pesos)) return null;
  return Math.round(pesos * 100);
}

/**
 * Comprueba que los bloques de un mismo día no se solapen.
 *
 * La base de datos ya lo impide con una restricción EXCLUDE, pero ese error
 * llega en jerga de Postgres y después de enviar todo el formulario. Aquí se
 * detecta mientras se edita.
 */
export function findOverlap(blocks: ScheduleBlock[]): string | null {
  for (const day of new Set(blocks.map((b) => b.weekday))) {
    const ofDay = blocks
      .filter((b) => b.weekday === day)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    for (let i = 1; i < ofDay.length; i++) {
      if (ofDay[i].startTime < ofDay[i - 1].endTime) {
        const name = WEEKDAYS.find((w) => w.value === day)?.label ?? "";
        return `Los horarios del ${name.toLowerCase()} se enciman.`;
      }
    }
  }

  for (const block of blocks) {
    if (block.endTime <= block.startTime) {
      const name = WEEKDAYS.find((w) => w.value === block.weekday)?.label ?? "";
      return `En ${name.toLowerCase()}, la hora de fin debe ser posterior a la de inicio.`;
    }
  }

  return null;
}
