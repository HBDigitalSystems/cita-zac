// Subida de imágenes a Supabase Storage.
//
// La foto se procesa en el navegador antes de subirla, y no es una optimización
// opcional: sin ello, subir desde el móvil falla casi siempre.
//
//   · El bucket `avatars` acepta 5 MB como máximo, y una foto de un teléfono
//     reciente ronda los 4-9 MB. El rechazo llegaría del servidor, después de
//     haber gastado los datos del usuario en subirla.
//
//   · Un iPhone guarda en HEIC salvo que se le diga lo contrario, y el bucket
//     solo admite JPEG, PNG y WebP. Al redibujar la imagen en un lienzo y
//     exportarla, el formato de origen deja de importar: Safari sabe decodificar
//     HEIC aunque no sepa subirlo.
//
//   · Una foto de perfil se muestra como mucho a 400 px. Subir 4000 px de ancho
//     es tirar datos móviles para que el navegador la reduzca igual.
//
// Quién puede escribir dónde lo decide el RLS de `storage.objects`: la ruta
// tiene que empezar por el identificador del usuario. Aquí no se comprueba.

import { supabase } from "@/integrations/supabase/client";

/** Lado máximo de la imagen ya procesada. */
const LADO_MAXIMO = 800;

export type ImagenProcesada = { blob: Blob; extension: string; tipo: string };

/**
 * Reduce y reencoda la imagen en el navegador.
 *
 * WebP pesa bastante menos que JPEG a igual calidad y lo entienden todos los
 * navegadores desde 2021; si `toBlob` no lo produce —Safari antiguo—, se cae a
 * JPEG, que el bucket también acepta.
 */
export async function procesarImagen(archivo: File): Promise<ImagenProcesada> {
  const url = URL.createObjectURL(archivo);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("No pudimos leer la imagen. Prueba con otra."));
      el.src = url;
    });

    const escala = Math.min(1, LADO_MAXIMO / Math.max(img.width, img.height));
    const ancho = Math.round(img.width * escala);
    const alto = Math.round(img.height * escala);

    const lienzo = document.createElement("canvas");
    lienzo.width = ancho;
    lienzo.height = alto;

    const ctx = lienzo.getContext("2d");
    if (!ctx) throw new Error("Tu navegador no permite procesar la imagen.");

    // Fondo blanco: un PNG con transparencia acabaría con fondo negro al
    // exportarlo a JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, ancho, alto);
    ctx.drawImage(img, 0, 0, ancho, alto);

    const intentar = (tipo: string) =>
      new Promise<Blob | null>((resolve) => lienzo.toBlob(resolve, tipo, 0.85));

    const webp = await intentar("image/webp");
    if (webp && webp.type === "image/webp") {
      return { blob: webp, extension: "webp", tipo: "image/webp" };
    }

    const jpeg = await intentar("image/jpeg");
    if (jpeg) return { blob: jpeg, extension: "jpg", tipo: "image/jpeg" };

    throw new Error("No pudimos preparar la imagen para subirla.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type SubidaResultado = { ok: true; url: string } | { ok: false; error: string };

/**
 * Sube la foto de perfil y devuelve su URL pública.
 *
 * El nombre lleva la marca de tiempo para esquivar la caché: si se reutilizara
 * siempre el mismo, el navegador y la CDN seguirían sirviendo la foto anterior
 * durante horas y parecería que la subida no funcionó.
 */
export async function subirAvatar(archivo: File, userId: string): Promise<SubidaResultado> {
  try {
    const { blob, extension, tipo } = await procesarImagen(archivo);

    // La ruta DEBE empezar por el id del usuario: es lo que comprueba la policy
    // `avatars_write_own`.
    const ruta = `${userId}/perfil-${Date.now()}.${extension}`;

    const { error } = await supabase.storage
      .from("avatars")
      .upload(ruta, blob, { contentType: tipo, upsert: true });

    if (error) return { ok: false, error: traducir(error.message) };

    const { data } = supabase.storage.from("avatars").getPublicUrl(ruta);
    return { ok: true, url: data.publicUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No pudimos subir la imagen." };
  }
}

/** Guarda la URL en el perfil del médico. */
export async function guardarFotoDeMedico(doctorId: string, url: string) {
  const { error } = await supabase
    .from("doctor_profiles")
    .upsert({ doctor_id: doctorId, photo_url: url }, { onConflict: "doctor_id" });

  if (error) throw error;
}

/** Guarda la URL en la cuenta, para el avatar general. */
export async function guardarAvatarDeUsuario(userId: string, url: string) {
  const { error } = await supabase.from("users").update({ avatar_url: url }).eq("id", userId);
  if (error) throw error;
}

/** Los mensajes de Storage llegan en inglés y en jerga. */
function traducir(mensaje: string): string {
  const m = mensaje.toLowerCase();
  if (m.includes("exceeded") || m.includes("too large")) {
    return "La imagen pesa demasiado. Prueba con una más pequeña.";
  }
  if (m.includes("mime") || m.includes("content type")) {
    return "Ese formato no se admite. Usa JPG, PNG o WebP.";
  }
  if (m.includes("row-level security") || m.includes("unauthorized")) {
    return "No tienes permiso para subir esta imagen. Vuelve a iniciar sesión.";
  }
  return mensaje;
}
