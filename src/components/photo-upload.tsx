// Subida de la foto de perfil del médico (PRD Fase 4, pendiente hasta ahora).

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { guardarAvatarDeUsuario, guardarFotoDeMedico, subirAvatar } from "@/services/storage";

export function PhotoUpload({
  doctorId,
  userId,
  fotoActual,
  onSubida,
}: {
  doctorId: string;
  userId: string;
  fotoActual: string | null;
  onSubida?: (url: string) => void;
}) {
  const queryClient = useQueryClient();
  const entradaRef = useRef<HTMLInputElement>(null);

  // Vista previa inmediata desde el archivo local: subir y procesar tarda unos
  // segundos en una conexión móvil, y sin esto parece que no pasó nada.
  const [previa, setPrevia] = useState<string | null>(null);

  const subir = useMutation({
    mutationFn: async (archivo: File) => {
      const r = await subirAvatar(archivo, userId);
      if (!r.ok) throw new Error(r.error);

      await guardarFotoDeMedico(doctorId, r.url);
      // El avatar de la cuenta se actualiza también, para que la misma cara
      // salga en el chat y en la cabecera. Si falla, la foto del perfil ya
      // quedó guardada y no tiene sentido dar la subida por fallida.
      await guardarAvatarDeUsuario(userId, r.url).catch(() => {});

      return r.url;
    },
    onSuccess: (url) => {
      toast.success("Foto actualizada.");
      onSubida?.(url);
      void queryClient.invalidateQueries({ queryKey: ["doctor-profile"] });
    },
    onError: (e) => {
      setPrevia(null);
      toast.error(e instanceof Error ? e.message : "No pudimos subir la foto.");
    },
  });

  function elegir(archivo: File | undefined) {
    if (!archivo) return;

    // Se comprueba antes de procesar para dar un mensaje claro; el límite real
    // lo impone el bucket, y el redimensionado deja casi cualquier foto por
    // debajo. Esto solo ataja un archivo absurdo, como un vídeo renombrado.
    if (!archivo.type.startsWith("image/")) {
      toast.error("Elige una imagen.");
      return;
    }
    if (archivo.size > 25 * 1024 * 1024) {
      toast.error("Esa imagen es demasiado grande. Elige otra.");
      return;
    }

    setPrevia(URL.createObjectURL(archivo));
    subir.mutate(archivo);
  }

  const mostrada = previa ?? fotoActual;

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-5">
      <div className="relative">
        <div
          className={cn(
            "flex h-24 w-24 items-center justify-center overflow-hidden rounded-full",
            "border-2 border-border bg-muted",
          )}
        >
          {mostrada ? (
            <img src={mostrada} alt="" className="h-full w-full object-cover" />
          ) : (
            <UserRound className="h-10 w-10 text-muted-foreground/50" />
          )}
        </div>

        {subir.isPending && (
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
            <Loader2 className="h-6 w-6 animate-spin text-white" />
          </div>
        )}
      </div>

      <div className="text-center sm:text-left">
        <p className="text-sm font-medium text-secondary">Tu foto de perfil</p>
        <p className="mt-0.5 max-w-xs text-xs text-muted-foreground">
          Es lo primero que ve un paciente. Usa una foto tuya, de frente y con buena luz.
        </p>

        <input
          ref={entradaRef}
          type="file"
          // `image/*` a secas y sin `capture`: así el teléfono deja elegir entre
          // hacer una foto o tomarla de la galería. Poner `capture` obligaría a
          // usar la cámara en ese momento, que casi nunca es lo que se quiere.
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            elegir(e.target.files?.[0]);
            // Se limpia para que volver a elegir el mismo archivo dispare el
            // evento otra vez.
            e.target.value = "";
          }}
        />

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-3 gap-2"
          disabled={subir.isPending}
          onClick={() => entradaRef.current?.click()}
        >
          <Camera className="h-4 w-4" />
          {subir.isPending ? "Subiendo…" : fotoActual ? "Cambiar foto" : "Subir foto"}
        </Button>
      </div>
    </div>
  );
}
