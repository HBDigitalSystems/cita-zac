-- =============================================================================
-- DoctorCita · Fase 1 · 07 — Consultorios y horarios
-- =============================================================================
-- Modelo de disponibilidad en tres capas (PRD Fase 4):
--   1. working_hours          → patrón semanal recurrente por consultorio
--   2. availability_exceptions→ excepciones puntuales (vacaciones, bloqueos,
--                               festivos, o disponibilidad extra)
--   3. appointments           → lo ya ocupado (migración 08)
-- Los huecos libres se calculan como (1) − (2) − (3). No se materializan slots
-- en tabla: se generan al vuelo, así no hay que mantener millones de filas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- consulting_rooms
-- -----------------------------------------------------------------------------
create table public.consulting_rooms (
  id              uuid primary key default gen_random_uuid(),
  doctor_id       uuid not null references public.doctors(id) on delete cascade,

  -- Opcional: si el consultorio está dentro de un hospital o clínica del catálogo.
  facility_id     uuid references public.facilities(id) on delete set null,

  name            text not null,
  municipality_id smallint not null references public.municipalities(id) on delete restrict,
  address         text not null,
  address_details text,                 -- "Piso 3, consultorio 12"
  postal_code     text,
  phone           text,
  latitude        numeric(9, 6),
  longitude       numeric(9, 6),
  google_place_id text,

  photos          text[] not null default '{}',
  amenities       text[] not null default '{}',   -- 'wifi', 'sala de espera', ...
  has_parking     boolean not null default false,
  is_accessible   boolean not null default false, -- accesibilidad para silla de ruedas

  -- Duración por defecto de las citas en este consultorio.
  slot_duration_minutes smallint not null default 30,
  buffer_minutes        smallint not null default 0,  -- descanso entre citas

  is_primary      boolean not null default false,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint consulting_rooms_postal_code_format check (
    postal_code is null or postal_code ~ '^[0-9]{5}$'
  ),
  constraint consulting_rooms_slot_duration_sane check (
    slot_duration_minutes between 5 and 240
  ),
  constraint consulting_rooms_buffer_sane check (buffer_minutes between 0 and 120)
);

comment on table public.consulting_rooms is
  'Consultorios del médico. Un médico puede tener varios (PRD Fase 4).';

create index consulting_rooms_doctor_idx       on public.consulting_rooms (doctor_id) where is_active;
create index consulting_rooms_municipality_idx on public.consulting_rooms (municipality_id) where is_active;
create index consulting_rooms_facility_idx     on public.consulting_rooms (facility_id);

-- Un solo consultorio principal por médico.
create unique index consulting_rooms_one_primary_per_doctor
  on public.consulting_rooms (doctor_id)
  where is_primary;

create trigger consulting_rooms_set_updated_at
  before update on public.consulting_rooms
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- working_hours — patrón semanal recurrente
-- -----------------------------------------------------------------------------
create table public.working_hours (
  id                 uuid primary key default gen_random_uuid(),
  consulting_room_id uuid not null references public.consulting_rooms(id) on delete cascade,

  -- 0 = domingo … 6 = sábado (coincide con Date.getDay() de JS).
  weekday            smallint not null,
  start_time         time not null,
  end_time           time not null,

  -- Permite telemedicina solo en ciertas franjas.
  allows_in_person   boolean not null default true,
  allows_video       boolean not null default false,

  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),

  constraint working_hours_weekday_range check (weekday between 0 and 6),
  constraint working_hours_time_order check (end_time > start_time)
);

comment on table public.working_hours is
  'Bloques horarios recurrentes por día de la semana. Varios bloques por día permiten modelar descansos (ej. 09:00-14:00 y 16:00-20:00).';

create index working_hours_room_weekday_idx
  on public.working_hours (consulting_room_id, weekday) where is_active;

-- Evita que dos bloques del mismo día se solapen en el mismo consultorio.
-- Requiere btree_gist (para el operador = sobre uuid/smallint) y el tipo
-- public.timerange, ambos creados en la migración 01.
alter table public.working_hours
  add constraint working_hours_no_overlap
  exclude using gist (
    consulting_room_id with =,
    weekday with =,
    public.timerange(start_time, end_time) with &&
  ) where (is_active);

-- -----------------------------------------------------------------------------
-- availability_exceptions — vacaciones, festivos, bloqueos y extras
-- -----------------------------------------------------------------------------
create type public.availability_exception_type as enum (
  'vacation',   -- vacaciones del médico
  'holiday',    -- día festivo
  'block',      -- bloqueo puntual (congreso, quirófano, personal)
  'extra'       -- disponibilidad adicional fuera del patrón semanal
);

create table public.availability_exceptions (
  id                 uuid primary key default gen_random_uuid(),
  doctor_id          uuid not null references public.doctors(id) on delete cascade,

  -- Si es null, la excepción aplica a TODOS los consultorios del médico.
  consulting_room_id uuid references public.consulting_rooms(id) on delete cascade,

  exception_type     public.availability_exception_type not null,

  starts_at          timestamptz not null,
  ends_at            timestamptz not null,

  reason             text,
  created_at         timestamptz not null default now(),

  constraint availability_exceptions_time_order check (ends_at > starts_at)
);

comment on table public.availability_exceptions is
  'Excepciones al patrón semanal. type=extra ABRE disponibilidad; el resto la CIERRA.';

create index availability_exceptions_doctor_range_idx
  on public.availability_exceptions (doctor_id, starts_at, ends_at);
create index availability_exceptions_room_idx
  on public.availability_exceptions (consulting_room_id);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.consulting_rooms        enable row level security;
alter table public.working_hours           enable row level security;
alter table public.availability_exceptions enable row level security;

-- Consultorios visibles públicamente si el médico es público (los necesita el
-- buscador y el perfil).
create policy "consulting_rooms_select_public"
  on public.consulting_rooms for select
  to anon, authenticated
  using (is_active and exists (
    select 1 from public.doctors d
    where d.id = doctor_id and public.doctor_is_public(d)
  ));

create policy "consulting_rooms_manage_own"
  on public.consulting_rooms for all
  to authenticated
  using (doctor_id = public.current_doctor_id() or public.is_admin())
  with check (doctor_id = public.current_doctor_id() or public.is_admin());

-- Horarios: públicos, porque el paciente necesita ver los huecos antes de reservar.
create policy "working_hours_select_public"
  on public.working_hours for select
  to anon, authenticated
  using (exists (
    select 1
    from public.consulting_rooms cr
    join public.doctors d on d.id = cr.doctor_id
    where cr.id = consulting_room_id and public.doctor_is_public(d)
  ));

create policy "working_hours_manage_own"
  on public.working_hours for all
  to authenticated
  using (exists (
    select 1 from public.consulting_rooms cr
    where cr.id = consulting_room_id
      and (cr.doctor_id = public.current_doctor_id() or public.is_admin())
  ))
  with check (exists (
    select 1 from public.consulting_rooms cr
    where cr.id = consulting_room_id
      and (cr.doctor_id = public.current_doctor_id() or public.is_admin())
  ));

-- Excepciones: públicas en lectura (sin el motivo, que se filtra en la capa de
-- aplicación) para poder pintar los huecos reales en el calendario.
create policy "availability_exceptions_select_public"
  on public.availability_exceptions for select
  to anon, authenticated
  using (exists (
    select 1 from public.doctors d
    where d.id = doctor_id and public.doctor_is_public(d)
  ));

create policy "availability_exceptions_manage_own"
  on public.availability_exceptions for all
  to authenticated
  using (doctor_id = public.current_doctor_id() or public.is_admin())
  with check (doctor_id = public.current_doctor_id() or public.is_admin());
