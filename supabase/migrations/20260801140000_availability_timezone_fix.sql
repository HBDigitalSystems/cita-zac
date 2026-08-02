-- =============================================================================
-- DoctorCita · Corrección de zona horaria en el cálculo de disponibilidad
-- =============================================================================
-- La versión anterior construía cada hueco con (día + hora)::timestamptz.
-- Ese cast interpreta la hora en la zona del SERVIDOR, que en Supabase es UTC.
-- Resultado: un médico que atiende de 09:00 a 14:00 en Zacatecas aparecía
-- ofreciendo citas de 03:00 a 08:00, porque sus horas se guardaban como UTC y
-- se mostraban seis horas antes.
--
-- La corrección usa `timestamp AT TIME ZONE zona`, que interpreta la hora como
-- local de esa zona y devuelve el instante correcto. La zona sale de un ajuste
-- de plataforma en lugar de estar escrita en el código, para que el día que
-- DoctorCita opere fuera de Zacatecas no haya que tocar la función.
-- =============================================================================

insert into public.settings (key, value, description, is_public)
values (
  'platform.timezone',
  '"America/Mexico_City"'::jsonb,
  'Zona horaria en la que se interpretan los horarios de los consultorios.',
  true
)
on conflict (key) do nothing;

create or replace function public.get_available_slots(
  p_doctor_id uuid,
  p_room_id uuid,
  p_from date default current_date,
  p_days integer default 14
)
returns table (slot_start timestamptz, slot_end timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_slot_minutes integer;
  v_buffer       integer;
  v_min_advance  integer;
  v_max_advance  integer;
  v_timezone     text;
  v_visible      boolean;
begin
  select public.doctor_is_public(d) into v_visible
  from public.doctors d
  where d.id = p_doctor_id;

  if not coalesce(v_visible, false) then
    return;
  end if;

  select cr.slot_duration_minutes, cr.buffer_minutes
    into v_slot_minutes, v_buffer
  from public.consulting_rooms cr
  where cr.id = p_room_id
    and cr.doctor_id = p_doctor_id
    and cr.is_active;

  if v_slot_minutes is null then
    return;
  end if;

  select coalesce((value #>> '{}'), 'America/Mexico_City') into v_timezone
    from public.settings where key = 'platform.timezone';
  select coalesce((value)::integer, 2)  into v_min_advance
    from public.settings where key = 'appointments.min_advance_hours';
  select coalesce((value)::integer, 90) into v_max_advance
    from public.settings where key = 'appointments.max_advance_days';

  v_timezone    := coalesce(v_timezone, 'America/Mexico_City');
  v_min_advance := coalesce(v_min_advance, 2);
  v_max_advance := coalesce(v_max_advance, 90);
  p_days        := least(p_days, v_max_advance);

  return query
  with days as (
    select generate_series(p_from, p_from + (p_days - 1), interval '1 day')::date as day
  ),
  -- Cada bloque se ancla en la zona del consultorio. `AT TIME ZONE` interpreta
  -- la hora como local de esa zona, que es lo que el médico configuró.
  blocks as (
    select
      (d.day + wh.start_time) at time zone v_timezone as block_start,
      (d.day + wh.end_time)   at time zone v_timezone as block_end
    from days d
    join public.working_hours wh
      on wh.consulting_room_id = p_room_id
     and wh.is_active
     and wh.weekday = extract(dow from d.day)
  ),
  candidate_slots as (
    select
      b.block_start + (n * (v_slot_minutes + v_buffer) * interval '1 minute') as starts_at,
      b.block_start + (n * (v_slot_minutes + v_buffer) * interval '1 minute')
                    + (v_slot_minutes * interval '1 minute')                  as ends_at,
      b.block_end
    from blocks b
    cross join lateral generate_series(
      0,
      greatest(
        0,
        (extract(epoch from (b.block_end - b.block_start)) / 60
          / nullif(v_slot_minutes + v_buffer, 0))::integer - 1
      )
    ) as n
  )
  select cs.starts_at, cs.ends_at
  from candidate_slots cs
  where
    cs.starts_at >= now() + (v_min_advance * interval '1 hour')
    -- El hueco cabe entero dentro de SU bloque. Antes se comparaba contra el
    -- final más tardío del día, así que un turno de mañana podía desbordarse
    -- hacia el hueco de la comida cuando el médico también atendía por la tarde.
    and cs.ends_at <= cs.block_end
    and not exists (
      select 1
      from public.availability_exceptions ae
      where ae.doctor_id = p_doctor_id
        and ae.exception_type <> 'extra'
        and (ae.consulting_room_id is null or ae.consulting_room_id = p_room_id)
        and tstzrange(ae.starts_at, ae.ends_at) && tstzrange(cs.starts_at, cs.ends_at)
    )
    and not exists (
      select 1
      from public.appointments a
      where a.doctor_id = p_doctor_id
        and a.status in ('pending', 'confirmed', 'in_progress')
        and tstzrange(a.starts_at, a.ends_at) && tstzrange(cs.starts_at, cs.ends_at)
    )
  order by cs.starts_at;
end;
$$;

comment on function public.get_available_slots(uuid, uuid, date, integer) is
  'Huecos libres de un consultorio, en la zona horaria de la plataforma. SECURITY DEFINER para descontar las citas ocupadas sin exponerlas.';

grant execute on function public.get_available_slots(uuid, uuid, date, integer)
  to anon, authenticated;
