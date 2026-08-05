-- =============================================================================
-- DoctorCita · Secretarias y recepcionistas
-- =============================================================================
-- Los roles `secretary` y `receptionist` existen desde la Fase 1 pero no tenían
-- una sola policy: se podían asignar a una persona, esa persona entraba y no
-- veía absolutamente nada. Era una trampa — parecían funcionar hasta que
-- alguien los usaba.
--
-- Aquí se les da contenido. La regla que gobierna todo el archivo:
--
--   Una secretaria trabaja PARA un médico concreto, no para la plataforma.
--
-- Por eso el permiso no cuelga del rol sino de una asignación explícita. Tener
-- rol de secretaria no da acceso a nada; estar asignada a la Dra. Ruiz da
-- acceso a la agenda de la Dra. Ruiz y a nada más.
--
-- Y el límite que no se cruza: NO ve el expediente clínico. Ni alergias, ni
-- padecimientos, ni diagnósticos, ni notas. Eso obliga a un rodeo que conviene
-- entender antes de leer el resto: el nombre y el teléfono del paciente viven
-- en las mismas tablas que sus alergias, y el RLS decide QUÉ FILAS se ven, no
-- qué columnas. Dar acceso a la fila daría acceso a todo. La solución es una
-- función que devuelve solo las columnas permitidas.
-- =============================================================================

create table public.staff_assignments (
  id                    uuid primary key default gen_random_uuid(),

  staff_user_id         uuid not null references public.users(id)   on delete cascade,
  doctor_id             uuid not null references public.doctors(id) on delete cascade,

  -- Permisos por asignación, no por rol: la misma persona puede llevar la
  -- agenda de un médico y solo los mensajes de otro.
  can_manage_agenda     boolean not null default true,
  can_message           boolean not null default true,
  can_register_expenses boolean not null default false,

  is_active             boolean not null default true,

  created_by            uuid references public.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (staff_user_id, doctor_id)
);

comment on table public.staff_assignments is
  'Quién trabaja para qué médico. El permiso cuelga de aquí, no del rol.';

create index staff_assignments_staff_idx  on public.staff_assignments (staff_user_id) where is_active;
create index staff_assignments_doctor_idx on public.staff_assignments (doctor_id)     where is_active;

create trigger staff_assignments_set_updated_at
  before update on public.staff_assignments
  for each row execute function public.set_updated_at();

create trigger staff_assignments_audit
  after insert or update or delete on public.staff_assignments
  for each row execute function public.audit_row();

-- -----------------------------------------------------------------------------
-- ¿Para qué médicos trabajo?
-- -----------------------------------------------------------------------------
create or replace function public.staff_doctor_ids(p_permiso text default 'agenda')
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select sa.doctor_id
    from public.staff_assignments sa
   where sa.staff_user_id = auth.uid()
     and sa.is_active
     and case p_permiso
           when 'agenda'   then sa.can_manage_agenda
           when 'mensajes' then sa.can_message
           when 'gastos'   then sa.can_register_expenses
           else false
         end;
$$;

-- NO se revoca el permiso de ejecución, al contrario que en otras funciones
-- SECURITY DEFINER de este esquema. Dos motivos:
--
--   1. Las policies de abajo la invocan, y una expresión de RLS se evalúa como
--      el usuario que consulta. Sin EXECUTE, cualquier lectura o escritura
--      sobre las tablas afectadas falla con "permission denied" — incluidas
--      las de médicos y pacientes, que no tienen nada que ver con esto.
--
--   2. No hay nada que proteger: solo mira `auth.uid()`, así que como endpoint
--      RPC lo único que puede contar es para quién trabaja quien pregunta.

-- -----------------------------------------------------------------------------
-- RLS de las propias asignaciones
-- -----------------------------------------------------------------------------
alter table public.staff_assignments enable row level security;

-- El médico decide quién trabaja para él. Un administrador también, para poder
-- dar soporte.
create policy "staff_assignments_manage_doctor"
  on public.staff_assignments for all
  to authenticated
  using (doctor_id = public.current_doctor_id() or public.is_admin())
  with check (doctor_id = public.current_doctor_id() or public.is_admin());

-- Y cada quien ve sus propias asignaciones, para saber para quién trabaja.
create policy "staff_assignments_select_own"
  on public.staff_assignments for select
  to authenticated
  using (staff_user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Agenda
-- -----------------------------------------------------------------------------
create policy "appointments_select_staff"
  on public.appointments for select
  to authenticated
  using (doctor_id in (select public.staff_doctor_ids('agenda')));

-- Confirmar, cancelar, reprogramar. El trigger que protege columnas
-- privilegiadas sigue aplicando.
create policy "appointments_update_staff"
  on public.appointments for update
  to authenticated
  using (doctor_id in (select public.staff_doctor_ids('agenda')))
  with check (doctor_id in (select public.staff_doctor_ids('agenda')));

-- Agendar por teléfono para un paciente que llama.
create policy "appointments_insert_staff"
  on public.appointments for insert
  to authenticated
  with check (doctor_id in (select public.staff_doctor_ids('agenda')));

-- -----------------------------------------------------------------------------
-- La agenda que ve el personal, sin expediente clínico
-- -----------------------------------------------------------------------------
-- Devuelve el nombre y el teléfono del paciente y NADA más. No hay forma de
-- sacar de aquí una alergia ni un padecimiento, porque no se seleccionan.
--
-- SECURITY DEFINER porque tiene que leer `public.users` y `public.patients`,
-- tablas a las que el personal no tiene —ni debe tener— acceso directo. La
-- comprobación de permiso está dentro: solo devuelve filas de médicos para los
-- que quien llama trabaja de verdad.
create or replace function public.staff_agenda(
  p_doctor_id uuid,
  p_desde date default null,
  p_hasta date default null
)
returns table (
  id                uuid,
  reference         text,
  starts_at         timestamptz,
  ends_at           timestamptz,
  status            public.appointment_status,
  modality          public.appointment_modality,
  reason            text,
  is_first_visit    boolean,
  paciente_nombre   text,
  paciente_telefono text,
  consultorio       text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Sin asignación activa no se devuelve nada. Es lo que impide que alguien
  -- con rol de secretaria consulte la agenda de un médico ajeno pasándole
  -- otro identificador.
  if p_doctor_id is null
     or p_doctor_id not in (select public.staff_doctor_ids('agenda')) then
    return;
  end if;

  return query
    select a.id, a.reference, a.starts_at, a.ends_at, a.status, a.modality,
           a.reason, a.is_first_visit,
           coalesce(u.full_name, 'Paciente'),
           u.phone,
           cr.name
      from public.appointments a
      join public.patients p  on p.id = a.patient_id
      join public.users u     on u.id = p.user_id
      left join public.consulting_rooms cr on cr.id = a.consulting_room_id
     where a.doctor_id = p_doctor_id
       and (p_desde is null or a.starts_at >= p_desde::timestamptz)
       and (p_hasta is null or a.starts_at < (p_hasta + 1)::timestamptz)
     order by a.starts_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- Mensajería
-- -----------------------------------------------------------------------------
-- El personal contesta en nombre del consultorio para coordinar horarios.
--
-- Tiene una consecuencia que hay que asumir a conciencia: un paciente escribe
-- en ese chat creyendo que solo lo lee su médico, y puede contar un síntoma.
-- No hay forma técnica de evitarlo sin partir el chat en dos hilos. Queda
-- registrado aquí para que sea una decisión y no un descuido, y por eso el
-- permiso es por asignación y desactivable (`can_message`).
create policy "conversations_select_staff"
  on public.conversations for select
  to authenticated
  using (doctor_id in (select public.staff_doctor_ids('mensajes')));

create policy "conversations_update_staff"
  on public.conversations for update
  to authenticated
  using (doctor_id in (select public.staff_doctor_ids('mensajes')))
  with check (doctor_id in (select public.staff_doctor_ids('mensajes')));

create policy "messages_select_staff"
  on public.messages for select
  to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and c.doctor_id in (select public.staff_doctor_ids('mensajes'))
  ));

create policy "messages_insert_staff"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and c.doctor_id in (select public.staff_doctor_ids('mensajes'))
    )
  );

-- -----------------------------------------------------------------------------
-- Gastos
-- -----------------------------------------------------------------------------
-- Solo capturar. NO se le da SELECT: los totales por médico son información
-- laboral, y el personal no tiene por qué saber cuánto cuesta cada profesional
-- a la clínica.
create policy "expenses_insert_staff"
  on public.expenses for insert
  to authenticated
  with check (doctor_id in (select public.staff_doctor_ids('gastos')));

-- Para elegir el concepto al capturar.
create policy "expense_categories_select_staff"
  on public.expense_categories for select
  to authenticated
  using (
    is_active
    and exists (
      select 1 from public.staff_assignments sa
      where sa.staff_user_id = auth.uid() and sa.is_active and sa.can_register_expenses
    )
  );
