// Abre (o recupera) el hilo de chat con un médico desde su ficha pública.

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/store/auth";
import { openConversation } from "@/services/messages";

export function MessageDoctorButton({ doctorId }: { doctorId: string }) {
  const { status } = useAuth();
  const navigate = useNavigate();
  const [abriendo, setAbriendo] = useState(false);

  async function abrir() {
    if (status !== "authenticated") {
      // Se guarda a dónde volver, igual que hace el botón de reservar.
      void navigate({ to: "/entrar", search: { redirect: window.location.pathname } });
      return;
    }

    setAbriendo(true);
    try {
      const id = await openConversation(doctorId);
      void navigate({ to: "/panel/mensajes", search: { c: id } });
    } catch (error) {
      // El caso más probable no es un fallo técnico: es que quien pulsa no
      // tiene expediente de paciente todavía. La función lo dice con ese
      // mensaje exacto, así que se muestra tal cual.
      toast.error(
        error instanceof Error ? error.message : "No pudimos abrir la conversación.",
      );
    } finally {
      setAbriendo(false);
    }
  }

  return (
    <button
      type="button"
      onClick={abrir}
      disabled={abriendo}
      className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border
                 py-2 font-medium text-secondary hover:border-primary hover:text-primary
                 disabled:opacity-60"
    >
      {abriendo ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <MessageCircle className="h-3.5 w-3.5" />
      )}
      Mensaje
    </button>
  );
}
