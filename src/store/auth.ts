// Estado de sesión de la aplicación (PRD Fase 2).
//
// La sesión la gestiona Supabase Auth y se persiste en localStorage; aquí solo
// se refleja y se le añade la resolución de roles.
//
// NOTA IMPORTANTE sobre roles: la fuente de verdad es la tabla `user_roles`,
// que crea la Fase 1. Mientras las migraciones no estén aplicadas en el
// proyecto de Supabase, esa consulta falla con "tabla inexistente". En ese caso
// se recurre al rol que se guardó en los metadatos del usuario al registrarse.
// Es una red de seguridad para poder desarrollar, NO una autorización válida:
// los metadatos los controla el cliente y cualquiera podría manipularlos. El
// permiso real lo aplica el RLS de PostgreSQL en cada consulta.

import { create } from "zustand";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

/** Cómo se resolvió el rol; se usa para avisar en desarrollo. */
export type RoleSource = "database" | "metadata" | "none";

type AuthState = {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  roles: string[];
  roleSource: RoleSource;

  /**
   * Si los roles ya se resolvieron. Imprescindible: `roles` empieza vacío y
   * tarda una consulta en llenarse. Sin esta bandera, cualquier guarda que
   * pregunte "¿es médico?" recibe que no durante ese instante y desvía a la
   * persona a un panel que no le toca.
   */
  rolesLoaded: boolean;

  signOut: () => Promise<void>;
  refreshRoles: () => Promise<void>;
};

/** Nivel de privilegio por rol; el número bajo manda. Refleja `roles.level`. */
const ROLE_LEVEL: Record<string, number> = {
  super_admin: 10,
  general_admin: 20,
  medical_admin: 30,
  doctor: 40,
  secretary: 50,
  receptionist: 60,
  patient: 70,
};

async function resolveRoles(user: User | null): Promise<{ roles: string[]; source: RoleSource }> {
  if (!user) return { roles: [], source: "none" };

  const { data, error } = await supabase
    .from("user_roles")
    .select("roles(key)")
    .eq("user_id", user.id);

  if (!error && data) {
    const roles = data
      .map((row) => (row.roles as { key: string } | null)?.key)
      .filter((key): key is string => Boolean(key));
    if (roles.length > 0) return { roles, source: "database" };
  }

  if (error) {
    // 42P01 = tabla inexistente en Postgres; PGRST205 = PostgREST no la conoce.
    const missingTable = error.code === "42P01" || error.code === "PGRST205";
    if (missingTable) {
      console.warn(
        "[auth] La tabla user_roles no existe todavía. Usando el rol de los metadatos. " +
          "Aplica las migraciones de la Fase 1 para tener autorización real.",
      );
    } else {
      console.error("[auth] No se pudieron leer los roles:", error.message);
    }
  }

  const fallback = user.user_metadata?.role;
  return typeof fallback === "string" && fallback in ROLE_LEVEL
    ? { roles: [fallback], source: "metadata" }
    : { roles: [], source: "none" };
}

export const useAuth = create<AuthState>()((set, get) => ({
  status: "loading",
  session: null,
  user: null,
  roles: [],
  roleSource: "none",
  rolesLoaded: false,

  signOut: async () => {
    await supabase.auth.signOut();
    set({
      status: "anonymous",
      session: null,
      user: null,
      roles: [],
      roleSource: "none",
      rolesLoaded: true,
    });
  },

  refreshRoles: async () => {
    const { roles, source } = await resolveRoles(get().user);
    set({ roles, roleSource: source, rolesLoaded: true });
  },
}));

// --------------------------------------------------- "mantener sesión iniciada"
// Supabase persiste la sesión en localStorage siempre; no distingue entre
// "recuérdame" y "solo esta vez". Se implementa aquí con dos marcas:
//   · localStorage  → la preferencia, sobrevive al cierre del navegador
//   · sessionStorage→ señal de "esta pestaña sigue viva", se borra al cerrar
// Si la preferencia es "solo esta vez" y la señal de sesión ya no está, es que
// el navegador se cerró: se cierra la sesión antes de restaurarla.
const SESSION_ONLY_KEY = "doctorcita.session-only";
const SESSION_ALIVE_KEY = "doctorcita.session-alive";

export function setRememberMe(remember: boolean) {
  if (typeof window === "undefined") return;
  if (remember) {
    localStorage.removeItem(SESSION_ONLY_KEY);
    sessionStorage.removeItem(SESSION_ALIVE_KEY);
  } else {
    localStorage.setItem(SESSION_ONLY_KEY, "1");
    sessionStorage.setItem(SESSION_ALIVE_KEY, "1");
  }
}

function shouldDiscardSession(): boolean {
  if (typeof window === "undefined") return false;
  return (
    localStorage.getItem(SESSION_ONLY_KEY) === "1" &&
    sessionStorage.getItem(SESSION_ALIVE_KEY) !== "1"
  );
}

/**
 * Arranca la escucha de sesión. Se llama una sola vez desde el componente raíz.
 * Es idempotente: llamarlo de más no crea suscripciones duplicadas.
 */
let initialized = false;

export function initializeAuth() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const applySession = (session: Session | null) => {
    useAuth.setState({
      session,
      user: session?.user ?? null,
      status: session ? "authenticated" : "anonymous",
    });

    // El rol se consulta fuera del callback: supabase-js advierte de bloqueos
    // si se hacen llamadas a su API dentro del propio onAuthStateChange.
    if (session?.user) {
      void resolveRoles(session.user).then(({ roles, source }) =>
        useAuth.setState({ roles, roleSource: source, rolesLoaded: true }),
      );
    } else {
      useAuth.setState({ roles: [], roleSource: "none", rolesLoaded: true });
    }
  };

  void supabase.auth.getSession().then(async ({ data }) => {
    if (data.session && shouldDiscardSession()) {
      await supabase.auth.signOut();
      localStorage.removeItem(SESSION_ONLY_KEY);
      applySession(null);
      return;
    }
    applySession(data.session);
  });

  supabase.auth.onAuthStateChange((event, session) => {
    // Solo un cierre de sesión explícito deja al usuario como anónimo.
    if (event === "SIGNED_OUT") {
      applySession(null);
      return;
    }

    // Un evento sin sesión que NO sea SIGNED_OUT se ignora a propósito.
    // supabase-js emite INITIAL_SESSION y TOKEN_REFRESHED que pueden llegar con
    // session=null de forma pasajera —por ejemplo mientras renueva el token—, y
    // tratarlos como "ya no hay sesión" expulsaba al usuario a mitad de un
    // formulario largo. Si la sesión de verdad se perdió, la renovación falla y
    // acaba llegando un SIGNED_OUT.
    if (!session) return;

    applySession(session);
  });
}

// ------------------------------------------------------------------ helpers

export function highestRoleLevel(roles: string[]): number {
  return roles.reduce((min, role) => Math.min(min, ROLE_LEVEL[role] ?? 999), 999);
}

export function isAdmin(roles: string[]): boolean {
  return highestRoleLevel(roles) <= 30;
}

/**
 * Si esta persona actúa como médico.
 *
 * Se pregunta por el rol concreto y no por el nivel: un administrador tiene más
 * privilegios que un médico, pero no tiene agenda ni pacientes, así que en la
 * mensajería no está del lado del médico.
 */
export function isDoctor(roles: string[]): boolean {
  return roles.includes("doctor");
}

/** A dónde mandar a alguien nada más iniciar sesión, según su rol. */
export function panelPathForRoles(roles: string[]): string {
  if (isAdmin(roles)) return "/panel/admin";
  if (roles.includes("doctor")) return "/panel/medico";
  return "/panel/paciente";
}
