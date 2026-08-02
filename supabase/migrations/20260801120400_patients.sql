-- =============================================================================
-- DoctorCita · Fase 1 · 05 — Pacientes
-- =============================================================================

create type public.gender as enum ('male', 'female', 'other', 'prefer_not_to_say');

create type public.blood_type as enum ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-');

-- -----------------------------------------------------------------------------
-- patients
-- -----------------------------------------------------------------------------
create table public.patients (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null unique references public.users(id) on delete cascade,

  -- Identidad
  curp                  text unique,
  birth_date            date,
  gender                public.gender,
  blood_type            public.blood_type,

  -- Domicilio
  municipality_id       smallint references public.municipalities(id) on delete set null,
  address               text,
  postal_code           text,

  -- Datos clínicos básicos (el historial completo vive en medical_records)
  allergies             text[] not null default '{}',
  chronic_conditions    text[] not null default '{}',
  current_medications   text[] not null default '{}',

  -- Contacto de emergencia
  emergency_contact_name         text,
  emergency_contact_phone        text,
  emergency_contact_relationship text,

  -- Seguro médico
  insurance_company_id  smallint references public.insurance_companies(id) on delete set null,
  insurance_policy_number text,

  -- Legal
  accepted_terms_at     timestamptz,
  accepted_privacy_at   timestamptz,
  marketing_opt_in      boolean not null default false,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- CURP: 18 caracteres con estructura oficial mexicana.
  constraint patients_curp_format check (
    curp is null or curp ~ '^[A-Z]{4}[0-9]{6}[HM][A-Z]{5}[0-9A-Z][0-9]$'
  ),
  constraint patients_postal_code_format check (
    postal_code is null or postal_code ~ '^[0-9]{5}$'
  ),
  constraint patients_birth_date_sane check (
    birth_date is null or (birth_date > '1900-01-01' and birth_date <= current_date)
  )
);

comment on table public.patients is 'Perfil de paciente (PRD Fase 3).';
comment on column public.patients.curp is 'CURP opcional, validada por formato oficial.';

create index patients_user_idx         on public.patients (user_id);
create index patients_municipality_idx on public.patients (municipality_id);

create trigger patients_set_updated_at
  before update on public.patients
  for each row execute function public.set_updated_at();

create trigger patients_audit
  after insert or update or delete on public.patients
  for each row execute function public.audit_row();

-- Edad calculada — se usa en filtros y en el expediente.
create or replace function public.patient_age(p public.patients)
returns integer
language sql
stable
as $$
  select case
    when p.birth_date is null then null
    else extract(year from age(current_date, p.birth_date))::integer
  end;
$$;

comment on function public.patient_age(public.patients) is
  'Columna computada: edad del paciente en años. Uso: select p.*, patient_age(p) from patients p.';

-- -----------------------------------------------------------------------------
-- Helper de RLS: id de paciente del usuario autenticado
-- -----------------------------------------------------------------------------
create or replace function public.current_patient_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.patients where user_id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.patients enable row level security;

-- El paciente gestiona su propio expediente.
create policy "patients_select_own"
  on public.patients for select
  to authenticated
  using (user_id = auth.uid());

create policy "patients_insert_own"
  on public.patients for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "patients_update_own"
  on public.patients for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Administradores: acceso completo.
create policy "patients_all_admin"
  on public.patients for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- NOTA: la policy que permite a un médico leer los datos del paciente con el
-- que tiene una cita se define en la migración de appointments, porque depende
-- de esa tabla.
