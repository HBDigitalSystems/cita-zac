// Servicios y tratamientos que ofrece el médico, y sus redes sociales.
//
// Ambas cosas ya se pintaban en la ficha pública desde la Fase 5, pero no había
// forma de editarlas: los datos solo podían entrar por SQL. Aquí se cierra ese
// hueco.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { formatPrice } from "@/lib/doctor-format";

type Servicio = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  duration_minutes: number | null;
  is_active: boolean;
};

async function getServicios(doctorId: string): Promise<Servicio[]> {
  const { data, error } = await supabase
    .from("doctor_services")
    .select("id, name, description, price_cents, duration_minutes, is_active")
    .eq("doctor_id", doctorId)
    .order("display_order")
    .order("name");

  if (error) throw error;
  return (data ?? []) as Servicio[];
}

export function DoctorServicesPanel({ doctorId }: { doctorId: string }) {
  const queryClient = useQueryClient();
  const [nombre, setNombre] = useState("");
  const [precio, setPrecio] = useState("");
  const [duracion, setDuracion] = useState("");

  const servicios = useQuery({
    queryKey: ["doctor-services", doctorId],
    queryFn: () => getServicios(doctorId),
  });

  const agregar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("doctor_services").insert({
        doctor_id: doctorId,
        name: nombre.trim(),
        // En centavos como el resto de importes del esquema. Vacío significa
        // "consultar precio", que no es lo mismo que gratis.
        price_cents: precio ? Math.round(Number(precio) * 100) : null,
        duration_minutes: duracion ? Number(duracion) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Servicio agregado.");
      setNombre("");
      setPrecio("");
      setDuracion("");
      void queryClient.invalidateQueries({ queryKey: ["doctor-services", doctorId] });
      // La ficha pública lo muestra: se invalida para que aparezca sin recargar.
      void queryClient.invalidateQueries({ queryKey: ["doctor"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No pudimos agregarlo."),
  });

  const quitar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("doctor_services").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Servicio eliminado.");
      void queryClient.invalidateQueries({ queryKey: ["doctor-services", doctorId] });
      void queryClient.invalidateQueries({ queryKey: ["doctor"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No pudimos eliminarlo."),
  });

  return (
    <section className="mt-8 rounded-2xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold text-secondary">Servicios que ofreces</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Aparecen en tu perfil público, en la pestaña «Servicios».
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_8rem_8rem_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="s-nombre">Servicio</Label>
          <Input
            id="s-nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Electrocardiograma"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-precio">Precio (MXN)</Label>
          <Input
            id="s-precio"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            placeholder="800"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="s-duracion">Minutos</Label>
          <Input
            id="s-duracion"
            type="number"
            min="0"
            step="5"
            inputMode="numeric"
            value={duracion}
            onChange={(e) => setDuracion(e.target.value)}
            placeholder="30"
          />
        </div>
        <div className="flex items-end">
          <Button
            className="w-full gap-2 sm:w-auto"
            onClick={() => agregar.mutate()}
            disabled={agregar.isPending || !nombre.trim()}
          >
            <Plus className="h-4 w-4" />
            Agregar
          </Button>
        </div>
      </div>

      {servicios.isLoading ? (
        <Skeleton className="mt-5 h-20 rounded-xl" />
      ) : (servicios.data ?? []).length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Todavía no has agregado servicios. Sin ellos, tu perfil solo muestra el precio de
          consulta general.
        </p>
      ) : (
        <ul className="mt-5 divide-y divide-border">
          {(servicios.data ?? []).map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-secondary">{s.name}</p>
                <p className="text-xs text-muted-foreground">
                  {s.price_cents ? formatPrice(s.price_cents) : "Consultar precio"}
                  {s.duration_minutes ? ` · ${s.duration_minutes} min` : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => quitar.mutate(s.id)}
                disabled={quitar.isPending}
                aria-label={`Eliminar ${s.name}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Edición de los enlaces a redes sociales que se muestran en la ficha. */
export function DoctorSocialPanel({
  doctorId,
  facebookUrl,
  instagramUrl,
}: {
  doctorId: string;
  facebookUrl: string | null;
  instagramUrl: string | null;
}) {
  const queryClient = useQueryClient();
  const [facebook, setFacebook] = useState(facebookUrl ?? "");
  const [instagram, setInstagram] = useState(instagramUrl ?? "");

  const guardar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("doctor_profiles").upsert(
        {
          doctor_id: doctorId,
          facebook_url: facebook.trim() || null,
          instagram_url: instagram.trim() || null,
        },
        { onConflict: "doctor_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Redes actualizadas.");
      void queryClient.invalidateQueries({ queryKey: ["doctor-profile"] });
      void queryClient.invalidateQueries({ queryKey: ["doctor"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No pudimos guardarlo."),
  });

  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold text-secondary">Redes sociales</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Se muestran con su icono en tu perfil público.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="r-facebook">Facebook</Label>
          <Input
            id="r-facebook"
            value={facebook}
            onChange={(e) => setFacebook(e.target.value)}
            placeholder="tu.usuario"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-instagram">Instagram</Label>
          <Input
            id="r-instagram"
            value={instagram}
            onChange={(e) => setInstagram(e.target.value)}
            placeholder="@tu.usuario"
          />
        </div>
      </div>

      {/* Se dice para que nadie crea que hace falta la dirección entera. */}
      <p className="mt-2 text-xs text-muted-foreground">
        Puedes escribir solo tu nombre de usuario; nosotros completamos el enlace.
      </p>

      <Button className="mt-4" onClick={() => guardar.mutate()} disabled={guardar.isPending}>
        {guardar.isPending ? "Guardando…" : "Guardar redes"}
      </Button>
    </section>
  );
}
