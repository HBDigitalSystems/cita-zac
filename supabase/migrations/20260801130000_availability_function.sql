-- =============================================================================
-- DoctorCita · Fase 6 · Cálculo de disponibilidad
-- =============================================================================
-- Un paciente necesita ver qué huecos quedan libres, pero NO puede leer la
-- tabla de citas: ahí están las de los demás pacientes, y el RLS lo impide con
-- razón. Exponerlas aunque fuera solo con hora y duración revelaría el ritmo de
-- trabajo del médico y, cruzando datos, quién acude a consulta.
--
-- Esta función resuelve la contradicción: corre con SECURITY DEFINER para poder
-- mirar las citas, pero devuelve únicamente los huecos LIBRES. Nunca sale de
-- aquí un dato de una cita ajena.
-- =============================================================================

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
  v_slot_minutes  integer;
  v_buffer        integer;
  v_min_advance   integer;
  v_max_advance   integer;
  v_visible       boolean;
begin
  -- Solo se calcula la agenda de médicos públicos. Sin esto, cualquiera podría
  -- sondear los horarios de un perfil sin publicar pasando su identificador.
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

  select coalesce((value)::integer, 2)  into v_min_advance
    from public.settings where key = 'appointments.min_advance_hours';
  select coalesce((value)::integer, 90) into v_max_advance
    from public.settings where key = 'appointments.max_advance_days';

  v_min_advance := coalesce(v_min_advance, 2);
  v_max_advance := coalesce(v_max_advance, 90);
  p_days := least(p_days, v_max_advance);

  return query
  with days as (
    select generate_series(p_from, p_from + (p_days - 1), interval '1 day')::date as day
  ),
  blocks as (
    select d.day, wh.start_time, wh.end_time
    from days d
    join public.working_hours wh
      on wh.consulting_room_id = p_room_id
     and wh.is_active
     and wh.weekday = extract(dow from d.day)
  ),
  candidate_slots as (
    select
      (b.day + b.start_time)::timestamptz
        + (n * (v_slot_minutes + v_buffer) * interval '1 minute') as starts_at,
      (b.day + b.start_time)::timestamptz
        + (n * (v_slot_minutes + v_buffer) * interval '1 minute')
        + (v_slot_minutes * interval '1 minute')                  as ends_at
    from blocks b
    cross join lateral generate_series(
      0,
      greatest(
        0,
        (extract(epoch from (b.end_time - b.start_time)) / 60
          / nullif(v_slot_minutes + v_buffer, 0))::integer - 1
      )
    ) as n
  )
  select cs.starts_at, cs.ends_at
  from candidate_slots cs
  where
    -- Con la antelación mínima que exija la plataforma.
    cs.starts_at >= now() + (v_min_advance * interval '1 hour')
    -- El hueco cabe entero dentro del bloque de trabajo.
    and cs.ends_at <= (cs.starts_at::date + (
          select max(b2.end_time) from blocks b2 where b2.day = cs.starts_at::date
        ))::timestamptz
    -- Sin vacaciones, festivos ni bloqueos por encima.
    and not exists (
      select 1
      from public.availability_exceptions ae
      where ae.doctor_id = p_doctor_id
        and ae.exception_type <> 'extra'
        and (ae.consulting_room_id is null or ae.consulting_room_id = p_room_id)
        and tstzrange(ae.starts_at, ae.ends_at) && tstzrange(cs.starts_at, cs.ends_at)
    )
    -- Y sin una cita activa ya encima. Este es el dato que el paciente no
    -- puede consultar por su cuenta y que esta función usa sin revelarlo.
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
  'Huecos libres de un consultorio. SECURITY DEFINER para poder descontar las citas ocupadas sin exponerlas.';

-- Cualquiera puede consultar la agenda pública de un médico publicado, con o
-- sin sesión: es parte del escaparate.
grant execute on function public.get_available_slots(uuid, uuid, date, integer)
  to anon, authenticated;
