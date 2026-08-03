// Esquemas de validación de los formularios de acceso (PRD Fase 2).
//
// Los mensajes van en español y en segunda persona porque los lee el paciente,
// no el desarrollador: dicen qué falta y cómo arreglarlo, sin jerga.

import { z } from "zod";

/** Roles que alguien puede elegir al registrarse por su cuenta. */
export const SIGNUP_ROLES = ["patient", "doctor"] as const;
export type SignupRole = (typeof SIGNUP_ROLES)[number];

const email = z
  .string()
  .min(1, "Escribe tu correo electrónico.")
  .email("Ese correo no parece válido. Revisa que tenga @ y un dominio.");

// Ocho caracteres con letra y número. Supabase acepta seis por defecto, pero
// una cuenta médica da acceso a datos clínicos y conviene subir el listón.
const password = z
  .string()
  .min(8, "La contraseña necesita al menos 8 caracteres.")
  .regex(/[a-zA-Z]/, "Incluye al menos una letra.")
  .regex(/[0-9]/, "Incluye al menos un número.");

const phone = z
  .string()
  .regex(/^\+?[0-9]{10,15}$/, "Escribe 10 dígitos, sin espacios ni guiones.")
  .optional()
  .or(z.literal(""));

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Escribe tu contraseña."),
  // Sin `.default()`: con él, Zod deja el campo opcional a la entrada y
  // obligatorio a la salida, y los dos tipos dejan de encajar en el resolver de
  // React Hook Form. El valor inicial se pone en defaultValues del formulario.
  rememberMe: z.boolean(),
});

export type LoginValues = z.infer<typeof loginSchema>;

export const signupSchema = z
  .object({
    firstName: z.string().min(2, "Escribe tu nombre."),
    lastName: z.string().min(2, "Escribe tus apellidos."),
    email,
    phone,
    password,
    confirmPassword: z.string(),
    role: z.enum(SIGNUP_ROLES),
    acceptTerms: z.literal(true, {
      errorMap: () => ({ message: "Necesitas aceptar los términos para continuar." }),
    }),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Las contraseñas no coinciden.",
    path: ["confirmPassword"],
  });

export type SignupValues = z.infer<typeof signupSchema>;

export const forgotPasswordSchema = z.object({ email });
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Las contraseñas no coinciden.",
    path: ["confirmPassword"],
  });

export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;

/**
 * Traduce los errores de Supabase Auth, que llegan en inglés y en lenguaje de
 * API, a algo que una persona pueda leer y accionar.
 */
export function translateAuthError(message: string | undefined): string {
  if (!message) return "No pudimos completar la operación. Inténtalo de nuevo.";

  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "Correo o contraseña incorrectos.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Todavía no has confirmado tu correo. Revisa tu bandeja de entrada.";
  }
  if (
    normalized.includes("user already registered") ||
    normalized.includes("already been registered")
  ) {
    return "Ya existe una cuenta con este correo. Inicia sesión o recupera tu contraseña.";
  }
  if (normalized.includes("email rate limit") || normalized.includes("too many requests")) {
    return "Demasiados intentos seguidos. Espera unos minutos y vuelve a probar.";
  }
  if (normalized.includes("password should be at least")) {
    return "La contraseña es demasiado corta.";
  }
  if (normalized.includes("failed to fetch") || normalized.includes("networkerror")) {
    return "No hay conexión con el servidor. Revisa tu internet e inténtalo otra vez.";
  }

  return message;
}
