-- =============================================================================
-- DoctorCita · Ingresos del médico
-- =============================================================================
-- Contraparte de `expense_summary`, con una diferencia que define el diseño:
-- los gastos los ve la administración, los ingresos los ve cada médico y solo
-- los suyos.
--
-- SECURITY INVOKER, igual que en gastos. Si fuera DEFINER habría que filtrar a
-- mano por `current_doctor_id()` dentro, y ese filtro sería lo único que
-- separaría los ingresos de un médico de los de otro. Dejándola INVOKER, el
-- RLS de `appointments` hace ese trabajo: cada quien suma sobre las filas que
-- ya puede leer, y un error en esta función no puede filtrar nada.
--
-- Qué cuenta como ingreso: solo las citas COMPLETADAS. Una cita reservada y
-- cancelada no es dinero, y una pendiente todavía no lo es. El importe sale de
-- `price_cents`, que se congela al reservar: si el médico sube su tarifa
-- después, la consulta ya atendida mantiene el precio que se pactó.
-- =============================================================================

create or replace function public.doctor_income_summary(
  p_desde date default null,
  p_hasta date default null
)
returns table (
  mes                text,
  consultas          bigint,
  total_cents        bigint,
  presencial_cents   bigint,
  video_cents        bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    -- Se agrupa por el mes en hora local. Con la fecha UTC, una consulta del
    -- 31 de julio a las 19:00 caería en agosto y descuadraría el corte
    -- mensual justo en los días que más importan.
    to_char(a.starts_at at time zone coalesce(
      (select value #>> '{}' from public.settings where key = 'platform.timezone'),
      'America/Mexico_City'
    ), 'YYYY-MM'),
    count(*)::bigint,
    coalesce(sum(a.price_cents), 0)::bigint,
    coalesce(sum(a.price_cents) filter (where a.modality = 'in_person'), 0)::bigint,
    coalesce(sum(a.price_cents) filter (where a.modality = 'video'), 0)::bigint
  from public.appointments a
  where a.status = 'completed'
    and (p_desde is null or a.starts_at >= p_desde::timestamptz)
    and (p_hasta is null or a.starts_at < (p_hasta + 1)::timestamptz)
  group by 1
  order by 1 desc;
$$;

comment on function public.doctor_income_summary(date, date) is
  'Ingresos por mes de las citas atendidas. SECURITY INVOKER: el RLS decide de quién.';
