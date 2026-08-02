-- =============================================================================
-- DoctorCita · Fase 1 · 08 — Citas
-- =============================================================================

create type public.appointment_status as enum (
  'pending',              -- creada, pendiente de confirmación / pago
  'confirmed',            -- confirmada
  'in_progress',          -- el paciente está siendo atendido
  'completed',            -- atendida (habilita reseña, Fase 8)
  'cancelled_by_patient',
  'cancelled_by_doctor',
  'no_show',              -- el paciente no se presentó
  'rescheduled'           -- reemplazada por otra cita
);

create type public.appointment_modality as enum ('in_person', 'video', 'home_visit');

-- -----------------------------------------------------------------------------
-- appointments
-- -----------------------------------------------------------------------------
create table public.appointments (
  id                  uuid primary key default gen_random_uuid(),

  -- Folio legible para el paciente: DC-2026-000123
  reference           text not null unique,

  patient_id          uuid not null references public.patients(id) on delete restrict,
  doctor_id           uuid not null references public.doctors(id) on delete restrict,
  consulting_room_id  uuid references public.consulting_rooms(id) on delete set null,

  starts_at           timestamptz not null,
  ends_at             timestamptz not null,

  status              public.appointment_status not null default 'pending',
  modality            public.appointment_modality not null default 'in_person',

  reason              text,                 -- motivo de consulta (lo escribe el paciente)
  patient_notes       text,
  is_first_visit      boolean not null default true,

  -- Precio congelado en el momento de reservar: si el médico sube su tarifa
  -- después, la cita ya agendada mantiene el precio pactado.
  price_cents         integer,
  currency            char(3) not null default 'MXN',

  -- Cancelación / reprogramación
  cancelled_at        timestamptz,
  cancelled_by        uuid references public.users(id) on delete set null,
  cancellation_reason text,
  rescheduled_to      uuid references public.appointments(id) on delete set null,

  -- Videoconsulta (Fase 10) — proveedor aún sin definir
  video_room_url      text,
  video_provider      text,

  -- Recordatorios (Fase 8)
  reminder_sent_at    timestamptz,
  confirmed_at        timestamptz,
  completed_at        timestamptz,

  created_by          uuid references public.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint appointments_time_order check (ends_at > starts_at),
  constraint appointments_price_non_negative check (
    price_cents is null or price_cents >= 0
  ),
  -- Coherencia: si está cancelada, debe constar cuándo. La implicación es en un
  -- solo sentido a propósito: una cita cancelada y luego reprogramada queda con
  -- status='rescheduled' pero conserva su cancelled_at original.
  constraint appointments_cancellation_coherent check (
    status not in ('cancelled_by_patient', 'cancelled_by_doctor')
    or cancelled_at is not null
  ),
  -- Una videoconsulta no ocupa consultorio físico; el resto sí.
  constraint appointments_room_required_when_in_person check (
    modality <> 'in_person' or consulting_room_id is not null
  )
);

comment on table public.appointments is 'Citas médicas. Núcleo transaccional (PRD Fase 6).';
comment on column public.appointments.price_cents is
  'Precio congelado al reservar; independiente de cambios posteriores de tarifa.';

create index appointments_patient_idx    on public.appointments (patient_id, starts_at desc);
create index appointments_doctor_idx     on public.appointments (doctor_id, starts_at desc);
create index appointments_room_idx       on public.appointments (consulting_room_id, starts_at);
create index appointments_status_idx     on public.appointments (status);
create index appointments_upcoming_idx   on public.appointments (starts_at)
  where status in ('pending', 'confirmed');

-- -----------------------------------------------------------------------------
-- Garantía anti-doble-reserva
-- -----------------------------------------------------------------------------
-- Esta es la protección real contra que dos pacientes reserven el mismo hueco.
-- Se resuelve en la base de datos, no en la aplicación: aunque dos peticiones
-- lleguen en el mismo milisegundo, PostgreSQL rechaza la segunda. Sin esto, el
-- Realtime de Fase 6 solo esconde el problema en la UI.
alter table public.appointments
  add constraint appointments_no_double_booking
  exclude using gist (
    doctor_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status in ('pending', 'confirmed', 'in_progress'));

comment on constraint appointments_no_double_booking on public.appointments is
  'Impide solapamiento de citas activas del mismo médico a nivel de base de datos.';

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

create trigger appointments_audit
  after insert or update or delete on public.appointments
  for each row execute function public.audit_row();

-- -----------------------------------------------------------------------------
-- Folio secuencial legible
-- -----------------------------------------------------------------------------
create sequence public.appointment_reference_seq;

create or replace function public.generate_appointment_reference()
returns trigger
language plpgsql
as $$
begin
  if new.reference is null or new.reference = '' then
    new.reference := 'DC-' || to_char(now(), 'YYYY') || '-' ||
                     lpad(nextval('public.appointment_reference_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger appointments_generate_reference
  before insert on public.appointments
  for each row execute function public.generate_appointment_reference();

-- -----------------------------------------------------------------------------
-- Sellos de tiempo automáticos por cambio de estado
-- -----------------------------------------------------------------------------
create or replace function public.handle_appointment_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'confirmed' and new.confirmed_at is null then
      new.confirmed_at := now();
    end if;

    if new.status = 'completed' and new.completed_at is null then
      new.completed_at := now();
    end if;

    if new.status in ('cancelled_by_patient', 'cancelled_by_doctor')
       and new.cancelled_at is null then
      new.cancelled_at := now();
      new.cancelled_by := coalesce(new.cancelled_by, auth.uid());
    end if;
  end if;

  return new;
end;
$$;

create trigger appointments_status_timestamps
  before update on public.appointments
  for each row execute function public.handle_appointment_status_change();

-- Contador desnormalizado de citas atendidas por médico.
create or replace function public.sync_doctor_appointments_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.begin_internal_write();

  if new.status = 'completed' and old.status is distinct from 'completed' then
    update public.doctors
       set appointments_count = appointments_count + 1
     where id = new.doctor_id;
  elsif old.status = 'completed' and new.status is distinct from 'completed' then
    update public.doctors
       set appointments_count = greatest(appointments_count - 1, 0)
     where id = new.doctor_id;
  end if;

  perform public.end_internal_write();
  return new;
end;
$$;

create trigger appointments_sync_doctor_count
  after update of status on public.appointments
  for each row execute function public.sync_doctor_appointments_count();

-- -----------------------------------------------------------------------------
-- Helpers de RLS entre paciente y médico
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER: se usan dentro de policies de otras tablas y deben poder
-- consultar appointments sin quedar atrapadas por el RLS de appointments.
create or replace function public.doctor_treats_patient(p_patient_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.appointments a
    where a.patient_id = p_patient_id
      and a.doctor_id = public.current_doctor_id()
  );
$$;

comment on function public.doctor_treats_patient(uuid) is
  'true si el médico autenticado tiene o tuvo alguna cita con ese paciente. Base del acceso clínico.';

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.appointments enable row level security;

create policy "appointments_select_patient"
  on public.appointments for select
  to authenticated
  using (patient_id = public.current_patient_id());

create policy "appointments_select_doctor"
  on public.appointments for select
  to authenticated
  using (doctor_id = public.current_doctor_id());

create policy "appointments_insert_patient"
  on public.appointments for insert
  to authenticated
  with check (patient_id = public.current_patient_id());

-- El médico también puede agendar por el paciente (cita telefónica o presencial).
create policy "appointments_insert_doctor"
  on public.appointments for insert
  to authenticated
  with check (doctor_id = public.current_doctor_id());

create policy "appointments_update_patient"
  on public.appointments for update
  to authenticated
  using (patient_id = public.current_patient_id())
  with check (patient_id = public.current_patient_id());

create policy "appointments_update_doctor"
  on public.appointments for update
  to authenticated
  using (doctor_id = public.current_doctor_id())
  with check (doctor_id = public.current_doctor_id());

create policy "appointments_all_admin"
  on public.appointments for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Policy diferida desde la migración 05
-- -----------------------------------------------------------------------------
-- Un médico necesita leer la ficha del paciente al que atiende. No podía
-- definirse antes porque depende de appointments.
create policy "patients_select_treating_doctor"
  on public.patients for select
  to authenticated
  using (public.doctor_treats_patient(id));
