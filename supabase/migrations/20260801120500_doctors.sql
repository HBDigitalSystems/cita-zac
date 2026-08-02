-- =============================================================================
-- DoctorCita · Fase 1 · 06 — Médicos y perfil profesional
-- =============================================================================
-- `doctors` guarda lo verificable (cédulas, estado de validación, visibilidad).
-- `doctor_profiles` guarda lo editable de marketing (bio, precios, políticas).
-- El resto son tablas satélite N:M o 1:N del perfil público (Fase 4 / Fase 5).
-- =============================================================================

create type public.doctor_status as enum (
  'draft',                -- registro iniciado, sin enviar a validación
  'pending_verification', -- enviado, esperando revisión del admin médico
  'verified',             -- cédula validada
  'rejected',             -- documentación rechazada
  'suspended'             -- dado de baja por incumplimiento
);

-- -----------------------------------------------------------------------------
-- doctors
-- -----------------------------------------------------------------------------
create table public.doctors (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null unique references public.users(id) on delete cascade,

  -- URL pública: /medicos/[especialidad]/[municipio]/[slug]  (Fase 12)
  slug                     text not null unique,

  -- Credenciales profesionales
  license_number           text not null unique,   -- cédula profesional
  specialty_license_number text,                   -- cédula de especialidad
  university               text,
  graduation_year          smallint,
  years_of_experience      smallint,

  -- Especialidad principal (la que manda en la URL y en las tarjetas).
  -- Las adicionales viven en doctor_specialties.
  primary_specialty_id     smallint references public.specialties(id) on delete restrict,

  gender                   public.gender,

  -- Estado y visibilidad
  status                   public.doctor_status not null default 'draft',
  verified_at              timestamptz,
  verified_by              uuid references public.users(id) on delete set null,
  rejection_reason         text,

  -- Lo mantiene el trigger de suscripciones (Fase 9). Sin suscripción activa
  -- el perfil no aparece en el buscador público.
  has_active_subscription  boolean not null default false,

  -- Métricas desnormalizadas: las mantiene el trigger de reviews (Fase 8).
  -- Se guardan aquí para poder ordenar el listado sin joins costosos.
  rating_average           numeric(3, 2) not null default 0,
  reviews_count            integer not null default 0,
  appointments_count       integer not null default 0,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint doctors_graduation_year_sane check (
    graduation_year is null or graduation_year between 1930 and extract(year from current_date)
  ),
  constraint doctors_experience_sane check (
    years_of_experience is null or years_of_experience between 0 and 70
  ),
  constraint doctors_rating_range check (rating_average between 0 and 5),
  -- Cédula profesional mexicana: 7-8 dígitos históricamente, alfanumérica en
  -- emisiones recientes.
  constraint doctors_license_format check (license_number ~ '^[0-9A-Z]{6,12}$')
);

comment on table public.doctors is 'Datos verificables del profesional de la salud (PRD Fase 3).';
comment on column public.doctors.has_active_subscription is
  'Desnormalizado desde subscriptions. Controla la visibilidad pública (Fase 9).';
comment on column public.doctors.rating_average is
  'Desnormalizado desde reviews para poder ordenar el buscador sin joins.';

create index doctors_status_idx    on public.doctors (status);
create index doctors_specialty_idx on public.doctors (primary_specialty_id);
create index doctors_rating_idx    on public.doctors (rating_average desc, reviews_count desc);

create trigger doctors_set_updated_at
  before update on public.doctors
  for each row execute function public.set_updated_at();

create trigger doctors_audit
  after insert or update or delete on public.doctors
  for each row execute function public.audit_row();

-- -----------------------------------------------------------------------------
-- Visibilidad pública — regla única, usada por RLS y por el buscador
-- -----------------------------------------------------------------------------
create or replace function public.doctor_is_public(d public.doctors)
returns boolean
language sql
stable
as $$
  select d.status = 'verified'
     and (d.has_active_subscription
          or coalesce((select (value)::boolean
                       from public.settings
                       where key = 'doctors.require_subscription'), true) = false);
$$;

comment on function public.doctor_is_public(public.doctors) is
  'Regla única de visibilidad: verificado + suscripción activa (salvo que el ajuste global la desactive).';

-- -----------------------------------------------------------------------------
-- Helper de RLS: id de médico del usuario autenticado
-- -----------------------------------------------------------------------------
create or replace function public.current_doctor_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.doctors where user_id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- Generación de slug único a partir del nombre
-- -----------------------------------------------------------------------------
create or replace function public.generate_doctor_slug()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_slug text;
  candidate text;
  suffix    integer := 1;
begin
  if new.slug is not null and new.slug <> '' then
    return new;
  end if;

  select public.slugify(coalesce(u.full_name, 'medico'))
    into base_slug
  from public.users u
  where u.id = new.user_id;

  base_slug := coalesce(nullif(base_slug, ''), 'medico');
  candidate := base_slug;

  while exists (select 1 from public.doctors where slug = candidate) loop
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix;
  end loop;

  new.slug := candidate;
  return new;
end;
$$;

create trigger doctors_generate_slug
  before insert on public.doctors
  for each row execute function public.generate_doctor_slug();

-- -----------------------------------------------------------------------------
-- doctor_profiles (1:1) — contenido editable del perfil público
-- -----------------------------------------------------------------------------
create table public.doctor_profiles (
  doctor_id                uuid primary key references public.doctors(id) on delete cascade,

  headline                 text,          -- "Cardiólogo intervencionista en Zacatecas"
  biography                text,
  photo_url                text,
  cover_photo_url          text,
  signature_url            text,          -- firma digital para recetas
  cv_url                   text,

  -- Precios en centavos de MXN para evitar errores de redondeo con floats.
  price_in_person_cents    integer,
  price_video_cents        integer,
  price_follow_up_cents    integer,
  price_home_visit_cents   integer,
  currency                 char(3) not null default 'MXN',

  -- Toggles operativos (Fase 4)
  accepts_new_patients     boolean not null default true,
  offers_telemedicine      boolean not null default false,
  offers_emergency         boolean not null default false,
  offers_home_visits       boolean not null default false,

  -- Políticas
  cancellation_policy      text,
  cancellation_hours       smallint not null default 24,
  average_response_minutes integer,

  -- Redes sociales
  website                  text,
  facebook_url             text,
  instagram_url            text,
  linkedin_url             text,
  whatsapp_phone           text,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint doctor_profiles_prices_non_negative check (
    coalesce(price_in_person_cents, 0)  >= 0 and
    coalesce(price_video_cents, 0)      >= 0 and
    coalesce(price_follow_up_cents, 0)  >= 0 and
    coalesce(price_home_visit_cents, 0) >= 0
  ),
  constraint doctor_profiles_cancellation_hours_sane check (
    cancellation_hours between 0 and 168
  )
);

comment on table public.doctor_profiles is 'Contenido editable del perfil público del médico (PRD Fase 4).';
comment on column public.doctor_profiles.price_in_person_cents is
  'Precio en centavos MXN. Se evita numeric/float para no arrastrar errores de redondeo.';

create trigger doctor_profiles_set_updated_at
  before update on public.doctor_profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Relaciones N:M del perfil
-- -----------------------------------------------------------------------------
create table public.doctor_specialties (
  doctor_id    uuid not null references public.doctors(id) on delete cascade,
  specialty_id smallint not null references public.specialties(id) on delete restrict,
  primary key (doctor_id, specialty_id)
);

create table public.doctor_subspecialties (
  doctor_id       uuid not null references public.doctors(id) on delete cascade,
  subspecialty_id smallint not null references public.subspecialties(id) on delete restrict,
  primary key (doctor_id, subspecialty_id)
);

create table public.doctor_languages (
  doctor_id   uuid not null references public.doctors(id) on delete cascade,
  language_id smallint not null references public.languages(id) on delete restrict,
  primary key (doctor_id, language_id)
);

create table public.doctor_insurances (
  doctor_id            uuid not null references public.doctors(id) on delete cascade,
  insurance_company_id smallint not null references public.insurance_companies(id) on delete restrict,
  primary key (doctor_id, insurance_company_id)
);

-- Hospitales / clínicas / laboratorios donde el médico tiene actividad.
create table public.doctor_facilities (
  doctor_id   uuid not null references public.doctors(id) on delete cascade,
  facility_id uuid not null references public.facilities(id) on delete cascade,
  role        text,   -- 'Médico adscrito', 'Jefe de servicio', ...
  primary key (doctor_id, facility_id)
);

create index doctor_specialties_specialty_idx on public.doctor_specialties (specialty_id);
create index doctor_languages_language_idx    on public.doctor_languages (language_id);
create index doctor_insurances_insurance_idx  on public.doctor_insurances (insurance_company_id);
create index doctor_facilities_facility_idx   on public.doctor_facilities (facility_id);

-- -----------------------------------------------------------------------------
-- Tablas 1:N del perfil
-- -----------------------------------------------------------------------------
create table public.doctor_services (
  id              uuid primary key default gen_random_uuid(),
  doctor_id       uuid not null references public.doctors(id) on delete cascade,
  name            text not null,
  description     text,
  price_cents     integer,
  duration_minutes smallint,
  display_order   smallint not null default 100,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

comment on table public.doctor_services is 'Servicios y tratamientos ofrecidos. Filtrable en el buscador (Fase 5).';

create table public.doctor_certifications (
  id              uuid primary key default gen_random_uuid(),
  doctor_id       uuid not null references public.doctors(id) on delete cascade,
  title           text not null,
  issuing_body    text,
  issued_year     smallint,
  document_url    text,
  display_order   smallint not null default 100
);

create table public.doctor_awards (
  id            uuid primary key default gen_random_uuid(),
  doctor_id     uuid not null references public.doctors(id) on delete cascade,
  title         text not null,
  awarded_by    text,
  awarded_year  smallint,
  display_order smallint not null default 100
);

create type public.media_type as enum ('image', 'video');

create table public.doctor_media (
  id            uuid primary key default gen_random_uuid(),
  doctor_id     uuid not null references public.doctors(id) on delete cascade,
  media_type    public.media_type not null,
  url           text not null,
  thumbnail_url text,
  caption       text,
  display_order smallint not null default 100,
  created_at    timestamptz not null default now()
);

create table public.doctor_faqs (
  id            uuid primary key default gen_random_uuid(),
  doctor_id     uuid not null references public.doctors(id) on delete cascade,
  question      text not null,
  answer        text not null,
  display_order smallint not null default 100
);

create index doctor_services_doctor_idx       on public.doctor_services (doctor_id) where is_active;
create index doctor_certifications_doctor_idx on public.doctor_certifications (doctor_id);
create index doctor_awards_doctor_idx         on public.doctor_awards (doctor_id);
create index doctor_media_doctor_idx          on public.doctor_media (doctor_id);
create index doctor_faqs_doctor_idx           on public.doctor_faqs (doctor_id);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.doctors               enable row level security;
alter table public.doctor_profiles       enable row level security;
alter table public.doctor_specialties    enable row level security;
alter table public.doctor_subspecialties enable row level security;
alter table public.doctor_languages      enable row level security;
alter table public.doctor_insurances     enable row level security;
alter table public.doctor_facilities     enable row level security;
alter table public.doctor_services       enable row level security;
alter table public.doctor_certifications enable row level security;
alter table public.doctor_awards         enable row level security;
alter table public.doctor_media          enable row level security;
alter table public.doctor_faqs           enable row level security;

-- doctors: el público solo ve perfiles verificados y con suscripción.
create policy "doctors_select_public"
  on public.doctors for select
  to anon, authenticated
  using (public.doctor_is_public(doctors));

create policy "doctors_select_own"
  on public.doctors for select
  to authenticated
  using (user_id = auth.uid());

create policy "doctors_insert_own"
  on public.doctors for insert
  to authenticated
  with check (user_id = auth.uid());

-- El médico edita lo suyo, pero NO puede auto-verificarse ni auto-activarse.
-- Esas columnas quedan bajo control del trigger de abajo.
create policy "doctors_update_own"
  on public.doctors for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "doctors_all_admin"
  on public.doctors for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Blindaje de columnas privilegiadas: un médico no puede escalar su estado.
create or replace function public.protect_doctor_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Escritura originada por un trigger del sistema (recálculo de rating,
  -- sincronización de suscripción, contador de citas): se deja pasar.
  if public.is_internal_write() or public.is_admin() then
    return new;
  end if;

  -- Un médico puede pasar de draft a pending_verification (enviar a revisión)
  -- pero nada más.
  if new.status is distinct from old.status then
    if not (old.status in ('draft', 'rejected') and new.status = 'pending_verification') then
      raise exception 'No autorizado: el estado del médico solo puede cambiarlo un administrador.'
        using errcode = '42501';
    end if;
  end if;

  if new.has_active_subscription is distinct from old.has_active_subscription
     or new.verified_at     is distinct from old.verified_at
     or new.verified_by     is distinct from old.verified_by
     or new.rating_average  is distinct from old.rating_average
     or new.reviews_count   is distinct from old.reviews_count
     or new.license_number  is distinct from old.license_number then
    raise exception 'No autorizado: campo protegido del perfil médico.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger doctors_protect_privileged
  before update on public.doctors
  for each row execute function public.protect_doctor_privileged_columns();

-- doctor_profiles y satélites: lectura pública si el médico es público;
-- escritura solo del propio médico o de un admin.
create policy "doctor_profiles_select_public"
  on public.doctor_profiles for select
  to anon, authenticated
  using (exists (
    select 1 from public.doctors d
    where d.id = doctor_id and public.doctor_is_public(d)
  ));

create policy "doctor_profiles_manage_own"
  on public.doctor_profiles for all
  to authenticated
  using (doctor_id = public.current_doctor_id() or public.is_admin())
  with check (doctor_id = public.current_doctor_id() or public.is_admin());

-- Las tablas satélite comparten exactamente el mismo par de reglas. Se generan
-- en bucle para no repetir 20 policies idénticas a mano.
do $$
declare
  t text;
  satellite_tables text[] := array[
    'doctor_specialties', 'doctor_subspecialties', 'doctor_languages',
    'doctor_insurances', 'doctor_facilities', 'doctor_services',
    'doctor_certifications', 'doctor_awards', 'doctor_media', 'doctor_faqs'
  ];
begin
  foreach t in array satellite_tables loop
    execute format($f$
      create policy %I on public.%I for select to anon, authenticated
        using (exists (
          select 1 from public.doctors d
          where d.id = %I.doctor_id and public.doctor_is_public(d)
        ));
    $f$, t || '_select_public', t, t);

    execute format($f$
      create policy %I on public.%I for all to authenticated
        using (doctor_id = public.current_doctor_id() or public.is_admin())
        with check (doctor_id = public.current_doctor_id() or public.is_admin());
    $f$, t || '_manage_own', t);
  end loop;
end;
$$;
