// Ingresos del médico, en su panel.
//
// Solo cuentan las citas atendidas. Una reservada y cancelada no es dinero, y
// una pendiente todavía no lo es. El importe sale del precio congelado al
// reservar, así que subir la tarifa hoy no cambia lo que ya se cobró.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Monitor, Stethoscope, TrendingUp, Wallet } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";

type Mes = {
  mes: string;
  consultas: number;
  total_cents: number;
  presencial_cents: number;
  video_cents: number;
};

function pesos(cents: number): string {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** "2026-05" → "mayo 2026" */
function nombreDeMes(clave: string): string {
  const [anio, mes] = clave.split("-");
  const d = new Date(Number(anio), Number(mes) - 1, 1);
  return d.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
}

/** Los últimos doce meses, que es el corte con el que se piensa un consultorio. */
function rangoPorDefecto() {
  const hoy = new Date();
  const desde = new Date(hoy.getFullYear(), hoy.getMonth() - 11, 1);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { desde: iso(desde), hasta: iso(hoy) };
}

async function getIngresos(desde: string, hasta: string): Promise<Mes[]> {
  const { data, error } = await supabase.rpc("doctor_income_summary", {
    p_desde: desde,
    p_hasta: hasta,
  });

  if (error) throw error;
  return ((data ?? []) as Mes[]).map((m) => ({
    ...m,
    consultas: Number(m.consultas),
    total_cents: Number(m.total_cents),
    presencial_cents: Number(m.presencial_cents),
    video_cents: Number(m.video_cents),
  }));
}

export function DoctorIncomePanel() {
  const inicial = useMemo(rangoPorDefecto, []);
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);

  const { data, isLoading } = useQuery({
    queryKey: ["doctor-income", desde, hasta],
    queryFn: () => getIngresos(desde, hasta),
  });

  const meses = data ?? [];
  const total = meses.reduce((a, m) => a + m.total_cents, 0);
  const consultas = meses.reduce((a, m) => a + m.consultas, 0);
  const presencial = meses.reduce((a, m) => a + m.presencial_cents, 0);
  const video = meses.reduce((a, m) => a + m.video_cents, 0);
  const maximo = Math.max(1, ...meses.map((m) => m.total_cents));

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-secondary">Tus ingresos</h2>
          <p className="text-sm text-muted-foreground">
            De las consultas que marcaste como atendidas.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label htmlFor="i-desde" className="text-xs text-muted-foreground">
              Desde
            </Label>
            <Input
              id="i-desde"
              type="date"
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
              className="h-9 w-[9.5rem]"
            />
          </div>
          <div>
            <Label htmlFor="i-hasta" className="text-xs text-muted-foreground">
              Hasta
            </Label>
            <Input
              id="i-hasta"
              type="date"
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
              className="h-9 w-[9.5rem]"
            />
          </div>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="mt-4 h-28 rounded-2xl" />
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tarjeta
              destacada
              icono={<Wallet className="h-4 w-4" />}
              etiqueta="Total del periodo"
              valor={pesos(total)}
            />
            <Tarjeta
              icono={<TrendingUp className="h-4 w-4" />}
              etiqueta="Consultas atendidas"
              valor={String(consultas)}
              pie={consultas > 0 ? `${pesos(Math.round(total / consultas))} en promedio` : undefined}
            />
            <Tarjeta
              icono={<Stethoscope className="h-4 w-4" />}
              etiqueta="Presencial"
              valor={pesos(presencial)}
            />
            <Tarjeta
              icono={<Monitor className="h-4 w-4" />}
              etiqueta="Videoconsulta"
              valor={pesos(video)}
            />
          </div>

          <div className="mt-4 rounded-2xl border border-border bg-card">
            <div className="border-b border-border px-5 py-3">
              <h3 className="text-sm font-semibold text-secondary">Mes a mes</h3>
            </div>

            {meses.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                Todavía no hay consultas atendidas en este periodo. Marca una cita como
                atendida en tu agenda y aparecerá aquí.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {meses.map((m) => (
                  <li key={m.mes} className="flex items-center justify-between gap-4 px-5 py-3">
                    <div className="min-w-0">
                      {/* Primera letra en mayúscula: toLocaleDateString devuelve
                          los meses en minúscula en español. */}
                      <p className="text-sm font-medium capitalize text-secondary">
                        {nombreDeMes(m.mes)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {m.consultas} {m.consultas === 1 ? "consulta" : "consultas"}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      {/* La barra es relativa al mejor mes del periodo, no a una
                          meta inventada: sirve para comparar entre sí. */}
                      <div className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-muted sm:block">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${(m.total_cents / maximo) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-semibold tabular-nums text-secondary">
                        {pesos(m.total_cents)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Se dice explícitamente: alguien podría tomar esta cifra por lo que
              cobró de verdad, y la plataforma no procesa pagos todavía. */}
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Es el valor de las consultas atendidas al precio pactado al reservar. No refleja
            cobros ni pagos: la plataforma todavía no procesa dinero.
          </p>
        </>
      )}
    </section>
  );
}

function Tarjeta({
  icono,
  etiqueta,
  valor,
  pie,
  destacada,
}: {
  icono: React.ReactNode;
  etiqueta: string;
  valor: string;
  pie?: string;
  destacada?: boolean;
}) {
  return (
    <div
      className={
        destacada
          ? "rounded-2xl border border-primary/30 bg-primary-soft/40 p-4"
          : "rounded-2xl border border-border bg-card p-4"
      }
    >
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icono}
        {etiqueta}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-secondary">{valor}</p>
      {pie && <p className="mt-0.5 text-xs text-muted-foreground">{pie}</p>}
    </div>
  );
}
