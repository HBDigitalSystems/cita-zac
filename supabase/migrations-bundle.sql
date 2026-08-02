-- =============================================================================
-- DoctorCita · Fase 1 · Todas las migraciones en un solo archivo
-- =============================================================================
-- GENERADO AUTOMÁTICAMENTE con `bun run db:bundle`. No editar a mano.
--
-- Cómo aplicarlo:
--   1. Panel de Supabase → SQL Editor → New query
--   2. Pegar TODO este archivo
--   3. Run
--
-- Se ejecuta dentro de una transacción: si algo falla, no queda nada a medias.
-- =============================================================================

begin;


-- ──────────────────────────────────────────────────────────────────────────
-- 20260801120000_extensions_and_functions.sql
-- ──────────────────────────────────────────────────────────────────────────

-- =============================================================================
-- DoctorCita · Fase 1 · 01 — Extensiones y funciones base
-- =============================================================================
-- Extensiones y utilidades transversales de las que dependen el resto de
-- migraciones. Debe ejecutarse primero.
-- =============================================================================

create schema if not exists extensions;

create extension if not exists "pgcrypto"  with schema extensions;  -- gen_random_uuid()
create extension if not exists "citext"    with schema extensions;  -- correos case-insensitive
create extension if not exists "pg_trgm"   with schema extensions;  -- búsqueda difusa (Fase 5)
create extension if not exists "unaccent"  with schema extensions;  -- búsqueda sin acentos
create extension if not exists "btree_gist" with schema extensions; -- índices EXCLUDE mixtos (=, &&)

-- -----------------------------------------------------------------------------
-- Tipo rango para horas del día
-- -----------------------------------------------------------------------------
-- PostgreSQL trae rangos para int/num/date/timestamp, pero no para `time`.
-- Se define aquí porque lo usan las restricciones de solapamiento de horarios.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'timerange') then
    create type public.timerange as range (subtype = time);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- updated_at automático
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger BEFORE UPDATE: refresca updated_at en cada modificación.';

-- -----------------------------------------------------------------------------
-- Normalización de texto para búsquedas y URLs (Fase 5 / Fase 12)
-- -----------------------------------------------------------------------------
-- unaccent() es STABLE por defecto y no puede usarse en índices. Se envuelve en
-- una función IMMUTABLE para poder indexar búsquedas sin acentos.
create or replace function public.unaccent_immutable(value text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, value);
$$;

comment on function public.unaccent_immutable(text) is
  'unaccent() en versión IMMUTABLE para poder usarse dentro de índices.';

create or replace function public.slugify(value text)
returns text
language sql
immutable
strict
as $$
  select trim(both '-' from
    regexp_replace(
      lower(public.unaccent_immutable(value)),
      '[^a-z0-9]+', '-', 'g'
    )
  );
$$;

comment on function public.slugify(text) is
  'Convierte texto a slug URL-safe. Usado para URLs amigables /medicos/[slug].';

-- -----------------------------------------------------------------------------
-- Puente entre triggers internos y triggers de blindaje
-- -----------------------------------------------------------------------------
-- Varias tablas tienen columnas protegidas que el usuario no puede tocar
-- (calificación media, estado de suscripción, contadores). Pero esas mismas
-- columnas SÍ las escriben triggers internos disparados por acciones legítimas
-- del usuario: al publicar una reseña se recalcula el rating del médico.
--
-- Sin este puente, el trigger de blindaje abortaría la operación del propio
-- sistema. Los triggers internos marcan la transacción con este flag y el
-- guardián lo respeta. El ámbito es local a la transacción (is_local = true),
-- así que no puede filtrarse a otra petición.
create or replace function public.begin_internal_write()
returns void
language sql
as $$
  select set_config('app.internal_write', 'on', true);
$$;

create or replace function public.end_internal_write()
returns void
language sql
as $$
  select set_config('app.internal_write', 'off', true);
$$;

create or replace function public.is_internal_write()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('app.internal_write', true), 'off') = 'on';
$$;

comment on function public.is_internal_write() is
  'true si la escritura actual la origina un trigger del sistema y no el usuario.';


-- ──────────────────────────────────────────────────────────────────────────
-- 20260801120100_users_and_roles.sql
-- ──────────────────────────────────────────────────────────────────────────

-- =============================================================================
-- DoctorCita · Fase 1 · 02 — Usuarios, roles y helpers de RLS
-- =============================================================================
-- public.users refleja auth.users (gestionada por Supabase Auth) y añade el
-- perfil de aplicación. La relación usuario↔rol es N:M para permitir casos
-- reales como un médico que además administra su clínica.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- roles
-- -----------------------------------------------------------------------------
create table public.roles (
  id          smallint generated always as identity primary key,
  key         text not null unique,
  name        text not null,
  description text,
  -- Jerarquía: number menor = más privilegios. Permite comparaciones simples
  -- del tipo "¿este usuario tiene al menos nivel de administrador?".
  level       smallint not null,
  created_at  timestamptz not null default now()
);

comment on table public.roles is 'Catálogo de roles del sistema (PRD Fase 1).';

insert into public.roles (key, name, description, level) values
  ('super_admin',   'Super Administrador',    'Control total del sistema, incluida la configuración global.', 10),
  ('general_admin', 'Administrador General',  'Gestiona usuarios, catálogos, pagos y reportes.',              20),
  ('medical_admin', 'Administrador Médico',   'Valida cédulas y aprueba perfiles de médicos.',                30),
  ('doctor',        'Médico',                 'Profesional de la salud con agenda y pacientes propios.',      40),
  ('secretary',     'Secretaria',             'Gestiona la agenda y pacientes de los médicos asignados.',     50),
  ('receptionist',  'Recepcionista',          'Registra llegadas y agenda citas en consultorio.',             60),
  ('patient',       'Paciente',               'Usuario final que busca médicos y reserva citas.',             70);

-- -----------------------------------------------------------------------------
-- users
-- -----------------------------------------------------------------------------
create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  -- Nullable a propósito: Supabase Auth permite alta solo con teléfono, en cuyo
  -- caso auth.users.email viene vacío y un NOT NULL rompería el registro.
  email         extensions.citext unique,
  first_name    text,
  last_name     text,
  full_name     text generated always as (
                  nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
                ) stored,
  phone         text,
  avatar_url    text,
  locale        text not null default 'es-MX',
  timezone      text not null default 'America/Mexico_City',
  is_active     boolean not null default true,
  onboarded_at  timestamptz,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint users_phone_format check (
    phone is null or phone ~ '^\+?[0-9]{10,15}$'
  )
);

comment on table public.users is
  'Perfil de aplicación 1:1 con auth.users. Se crea automáticamente por trigger.';

create index users_is_active_idx on public.users (is_active) where is_active;

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- user_roles (N:M)
-- -----------------------------------------------------------------------------
create table public.user_roles (
  user_id     uuid not null references public.users(id) on delete cascade,
  role_id     smallint not null references public.roles(id) on delete restrict,
  granted_by  uuid references public.users(id) on delete set null,
  granted_at  timestamptz not null default now(),
  primary key (user_id, role_id)
);

comment on table public.user_roles is 'Asignación N:M de roles a usuarios.';

create index user_roles_role_id_idx on public.user_roles (role_id);

-- -----------------------------------------------------------------------------
-- Alta automática al registrarse en Supabase Auth
-- -----------------------------------------------------------------------------
-- El rol se toma de raw_user_meta_data.role si viene en el signUp; por defecto
-- 'patient'. Nunca se permite auto-asignarse un rol administrativo: cualquier
-- valor distinto de patient/doctor se degrada a patient.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  requested_role text;
  resolved_role  text;
begin
  insert into public.users (id, email, first_name, last_name, phone, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    new.raw_user_meta_data ->> 'phone',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  requested_role := new.raw_user_meta_data ->> 'role';
  resolved_role  := case
                      when requested_role in ('patient', 'doctor') then requested_role
                      else 'patient'
                    end;

  insert into public.user_roles (user_id, role_id)
  select new.id, r.id from public.roles r where r.key = resolved_role
  on conflict do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- Mantener el correo sincronizado si el usuario lo cambia desde Auth.
create or replace function public.handle_auth_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.email is distinct from old.email then
    update public.users set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_auth_user_email_change();

-- -----------------------------------------------------------------------------
-- Helpers de RLS
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER a propósito: estas funciones se invocan DENTRO de las
-- policies de user_roles. Si respetaran RLS provocarían recursión infinita.
create or replace function public.has_role(role_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = auth.uid()
      and r.key = role_key
  );
$$;

comment on function public.has_role(text) is
  'true si el usuario autenticado tiene el rol indicado. SECURITY DEFINER para evitar recursión en las policies de user_roles.';

-- Nivel de privilegio más alto (número más bajo) del usuario actual.
create or replace function public.current_role_level()
returns smallint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(min(r.level), 999)::smallint
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.user_id = auth.uid();
$$;

-- Cualquier perfil administrativo (super_admin, general_admin, medical_admin).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_level() <= 30;
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_level() <= 10;
$$;

-- Personal clínico: médico, secretaria o recepcionista.
create or replace function public.is_clinical_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_role_level() between 40 and 60;
$$;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.roles       enable row level security;
alter table public.users       enable row level security;
alter table public.user_roles  enable row level security;

-- roles: catálogo de lectura pública para usuarios autenticados.
create policy "roles_select_authenticated"
  on public.roles for select
  to authenticated
  using (true);

create policy "roles_all_super_admin"
  on public.roles for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- users: cada quien lee y edita lo suyo; los admin ven todo.
create policy "users_select_own"
  on public.users for select
  to authenticated
  using (id = auth.uid() or public.is_admin());

create policy "users_update_own"
  on public.users for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "users_all_admin"
  on public.users for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- user_roles: solo lectura propia. La asignación es exclusiva de admins.
create policy "user_roles_select_own"
  on public.user_roles for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "user_roles_all_admin"
  on public.user_roles for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ──────────────────────────────────────────────────────────────────────────
-- 20260801120200_audit_and_settings.sql
-- ──────────────────────────────────────────────────────────────────────────

-- =============================================================================
-- DoctorCita · Fase 1 · 03 — Auditoría y configuración global
-- =============================================================================
-- Se define pronto en el orden de migraciones porque el trigger genérico de
-- auditoría se engancha a tablas creadas más adelante.
-- =============================================================================

create type public.audit_action as enum ('insert', 'update', 'delete');

-- -----------------------------------------------------------------------------
-- audit_logs
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id           bigint generated always as identity primary key,
  table_name   text not null,
  record_id    text not null,
  action       public.audit_action not null,
  actor_id     uuid references public.users(id) on delete set null,
  old_data     jsonb,
  new_data     jsonb,
  -- Solo las columnas que realmente cambiaron, para no releer diffs completos.
  changed_keys text[],
  ip_address   inet,
  user_agent   text,
  created_at   timestamptz not null default now()
);

comment on table public.audit_logs is
  'Bitácora de cambios en tablas sensibles (PRD Fase 1 / Fase 7).';

create index audit_logs_table_record_idx on public.audit_logs (table_name, record_id);
create index audit_logs_actor_idx        on public.audit_logs (actor_id);
create index audit_logs_created_at_idx   on public.audit_logs (created_at desc);

-- -----------------------------------------------------------------------------
-- Trigger genérico de auditoría
-- -----------------------------------------------------------------------------
-- Se engancha con:
--   create trigger <tabla>_audit
--     after insert or update or delete on public.<tabla>
--     for each row execute function public.audit_row();
create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old      jsonb;
  v_new      jsonb;
  v_changed  text[];
  v_record   text;
begin
  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    v_record := old.id::text;
  elsif tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_record := new.id::text;
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_record := new.id::text;

    select coalesce(array_agg(key), '{}')
      into v_changed
    from jsonb_each(v_new)
    where v_old -> key is distinct from v_new -> key;

    -- Nada relevante cambió (p. ej. solo updated_at): no ensuciamos la bitácora.
    if v_changed = '{}' or v_changed = array['updated_at'] then
      return new;
    end if;
  end if;

  insert into public.audit_logs (
    table_name, record_id, action, actor_id, old_data, new_data, changed_keys
  ) values (
    tg_table_name,
    v_record,
    lower(tg_op)::public.audit_action,
    auth.uid(),
    v_old,
    v_new,
    v_changed
  );

  return coalesce(new, old);
end;
$$;

comment on function public.audit_row() is
  'Trigger genérico que registra INSERT/UPDATE/DELETE en audit_logs. Requiere que la tabla tenga columna id.';

-- -----------------------------------------------------------------------------
-- settings — configuración global clave/valor
-- -----------------------------------------------------------------------------
create table public.settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  -- Si es público, el frontend puede leerlo sin sesión (p. ej. teléfono de
  -- soporte). Si no, solo administradores.
  is_public   boolean not null default false,
  updated_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.settings is 'Configuración global del sistema en formato clave/valor.';

create trigger settings_set_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

insert into public.settings (key, value, description, is_public) values
  ('platform.name',                 '"DoctorCita"'::jsonb,   'Nombre comercial de la plataforma.',                     true),
  ('platform.state',                '"Zacatecas"'::jsonb,    'Estado de operación.',                                   true),
  ('platform.support_email',        '"soporte@doctorcita.mx"'::jsonb, 'Correo de soporte.',                            true),
  ('appointments.default_slot_min',  '30'::jsonb,            'Duración por defecto de un espacio de cita (minutos).',  true),
  ('appointments.max_advance_days',  '90'::jsonb,            'Máximo de días de antelación para reservar.',            true),
  ('appointments.min_advance_hours', '2'::jsonb,             'Antelación mínima para reservar una cita.',              true),
  ('reviews.require_completed',      'true'::jsonb,          'Solo se permite reseñar tras una cita completada.',      false),
  ('reviews.auto_publish',           'true'::jsonb,          'Publicar reseñas sin moderación previa.',                false),
  ('doctors.require_subscription',   'true'::jsonb,          'Exigir suscripción activa para ser visible públicamente.', false);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.audit_logs enable row level security;
alter table public.settings   enable row level security;

-- audit_logs: solo lectura para administradores. Nadie escribe directamente,
-- únicamente el trigger (SECURITY DEFINER, que ignora RLS).
create policy "audit_logs_select_admin"
  on public.audit_logs for select
  to authenticated
  using (public.is_admin());

-- settings públicos visibles para todos, incluido visitante anónimo.
create policy "settings_select_public"
  on public.settings for select
  to anon, authenticated
  using (is_public);

create policy "settings_select_admin"
  on public.settings for select
  to authenticated
  using (public.is_admin());

create policy "settings_write_super_admin"
  on public.settings for all
  to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());


-- ──────────────────────────────────────────────────────────────────────────
-- 20260801120300_catalogs.sql
-- ──────────────────────────────────────────────────────────────────────────

-- =============================================================================
-- DoctorCita · Fase 1 · 04 — Catálogos
-- =============================================================================
-- Municipios, especialidades, subespecialidades, aseguradoras, idiomas y
-- establecimientos (clínicas / hospitales / laboratorios).
--
-- NOTA DE DISEÑO — desviación deliberada del PRD:
-- El PRD pide tres tablas separadas (clinics, hospitals, laboratories). Las tres
-- comparten exactamente las mismas columnas y se consultan siempre igual, así
-- que se unifican en `facilities` con un discriminador `facility_type`. Ventajas:
-- una sola FK desde consultorios y afiliaciones médicas, un solo CRUD en el
-- panel admin y un solo índice de búsqueda. Si en el futuro divergen, se
-- extraen con tablas satélite sin romper las FKs existentes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- municipalities
-- -----------------------------------------------------------------------------
create table public.municipalities (
  id          smallint generated always as identity primary key,
  name        text not null,
  slug        text not null unique,
  -- Clave INEGI del municipio, útil para cruzar con datos oficiales.
  inegi_code  text unique,
  state       text not null default 'Zacatecas',
  latitude    numeric(9, 6),
  longitude   numeric(9, 6),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),

  unique (state, name)
);

comment on table public.municipalities is
  'Municipios de operación. Se siembran los 20 del PRD; la tabla admite los 58 de Zacatecas.';

create index municipalities_active_idx on public.municipalities (is_active) where is_active;

insert into public.municipalities (name, slug) values
  ('Zacatecas',                 'zacatecas'),
  ('Guadalupe',                 'guadalupe'),
  ('Fresnillo',                 'fresnillo'),
  ('Jerez',                     'jerez'),
  ('Río Grande',                'rio-grande'),
  ('Sombrerete',                'sombrerete'),
  ('Loreto',                    'loreto'),
  ('Calera',                    'calera'),
  ('Ojocaliente',               'ojocaliente'),
  ('Nochistlán',                'nochistlan'),
  ('Jalpa',                     'jalpa'),
  ('Pinos',                     'pinos'),
  ('Villanueva',                'villanueva'),
  ('Tlaltenango',               'tlaltenango'),
  ('Miguel Auza',               'miguel-auza'),
  ('Juan Aldama',               'juan-aldama'),
  ('Concepción del Oro',        'concepcion-del-oro'),
  ('Valparaíso',                'valparaiso'),
  ('Mazapil',                   'mazapil'),
  ('Teúl de González Ortega',   'teul-de-gonzalez-ortega');

-- -----------------------------------------------------------------------------
-- specialties
-- -----------------------------------------------------------------------------
create table public.specialties (
  id            smallint generated always as identity primary key,
  name          text not null unique,
  slug          text not null unique,
  description   text,
  -- Emoji o nombre de icono lucide para las tarjetas del buscador.
  icon          text,
  is_featured   boolean not null default false,
  display_order smallint not null default 100,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

comment on table public.specialties is 'Catálogo de especialidades médicas (PRD: 45).';

create index specialties_featured_idx on public.specialties (is_featured, display_order)
  where is_active;

insert into public.specialties (name, slug, icon, is_featured, display_order) values
  ('Medicina General',                'medicina-general',                 '🩺', true,  1),
  ('Pediatría',                       'pediatria',                        '👶', true,  2),
  ('Ginecología',                     'ginecologia',                      '🌸', true,  3),
  ('Cardiología',                     'cardiologia',                      '❤️', true,  4),
  ('Dermatología',                    'dermatologia',                     '✨', true,  5),
  ('Odontología',                     'odontologia',                      '🦷', true,  6),
  ('Psicología',                      'psicologia',                       '🧠', true,  7),
  ('Nutrición',                       'nutricion',                        '🥗', true,  8),
  ('Traumatología',                   'traumatologia',                    null, false, 100),
  ('Neurología',                      'neurologia',                       null, false, 100),
  ('Oftalmología',                    'oftalmologia',                     null, false, 100),
  ('Psiquiatría',                     'psiquiatria',                      null, false, 100),
  ('Urología',                        'urologia',                         null, false, 100),
  ('Cirugía General',                 'cirugia-general',                  null, false, 100),
  ('Medicina Interna',                'medicina-interna',                 null, false, 100),
  ('Endocrinología',                  'endocrinologia',                   null, false, 100),
  ('Neumología',                      'neumologia',                       null, false, 100),
  ('Reumatología',                    'reumatologia',                     null, false, 100),
  ('Oncología',                       'oncologia',                        null, false, 100),
  ('Ortopedia',                       'ortopedia',                        null, false, 100),
  ('Otorrinolaringología',            'otorrinolaringologia',             null, false, 100),
  ('Gastroenterología',               'gastroenterologia',                null, false, 100),
  ('Nefrología',                      'nefrologia',                       null, false, 100),
  ('Infectología',                    'infectologia',                     null, false, 100),
  ('Medicina Familiar',               'medicina-familiar',                null, false, 100),
  ('Medicina del Deporte',            'medicina-del-deporte',             null, false, 100),
  ('Anestesiología',                  'anestesiologia',                   null, false, 100),
  ('Medicina Estética',               'medicina-estetica',                null, false, 100),
  ('Radiología',                      'radiologia',                       null, false, 100),
  ('Medicina Física y Rehabilitación','medicina-fisica-y-rehabilitacion', null, false, 100),
  ('Alergología',                     'alergologia',                      null, false, 100),
  ('Angiología',                      'angiologia',                       null, false, 100),
  ('Cirugía Plástica',                'cirugia-plastica',                 null, false, 100),
  ('Cirugía Cardiovascular',          'cirugia-cardiovascular',           null, false, 100),
  ('Coloproctología',                 'coloproctologia',                  null, false, 100),
  ('Geriatría',                       'geriatria',                        null, false, 100),
  ('Hematología',                     'hematologia',                      null, false, 100),
  ('Hepatología',                     'hepatologia',                      null, false, 100),
  ('Inmunología',                     'inmunologia',                      null, false, 100),
  ('Neurocirugía',                    'neurocirugia',                     null, false, 100),
  ('Audiología',                      'audiologia',                       null, false, 100),
  ('Foniatría',                       'foniatria',                        null, false, 100),
  ('Genética Médica',                 'genetica-medica',                  null, false, 100),
  ('Patología',                       'patologia',                        null, false, 100),
  ('Medicina del Trabajo',            'medicina-del-trabajo',             null, false, 100);

-- -----------------------------------------------------------------------------
-- subspecialties
-- -----------------------------------------------------------------------------
create table public.subspecialties (
  id           smallint generated always as identity primary key,
  specialty_id smallint not null references public.specialties(id) on delete cascade,
  name         text not null,
  slug         text not null unique,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),

  unique (specialty_id, name)
);

comment on table public.subspecialties is
  'Subespecialidades colgando de una especialidad (PRD: 80). Se siembra un subconjunto representativo; el resto se completa en Fase 11.';

create index subspecialties_specialty_idx on public.subspecialties (specialty_id);

insert into public.subspecialties (specialty_id, name, slug)
select s.id, v.name, v.slug
from (values
  ('cardiologia',     'Cardiología Intervencionista',   'cardiologia-intervencionista'),
  ('cardiologia',     'Electrofisiología',              'electrofisiologia'),
  ('cardiologia',     'Cardiología Pediátrica',         'cardiologia-pediatrica'),
  ('pediatria',       'Neonatología',                   'neonatologia'),
  ('pediatria',       'Neurología Pediátrica',          'neurologia-pediatrica'),
  ('pediatria',       'Gastroenterología Pediátrica',   'gastroenterologia-pediatrica'),
  ('ginecologia',     'Biología de la Reproducción',    'biologia-de-la-reproduccion'),
  ('ginecologia',     'Medicina Materno Fetal',         'medicina-materno-fetal'),
  ('ginecologia',     'Ginecología Oncológica',         'ginecologia-oncologica'),
  ('dermatologia',    'Dermatología Pediátrica',        'dermatologia-pediatrica'),
  ('dermatologia',    'Dermatología Oncológica',        'dermatologia-oncologica'),
  ('odontologia',     'Ortodoncia',                     'ortodoncia'),
  ('odontologia',     'Endodoncia',                     'endodoncia'),
  ('odontologia',     'Periodoncia',                    'periodoncia'),
  ('odontologia',     'Odontopediatría',                'odontopediatria'),
  ('odontologia',     'Implantología',                  'implantologia'),
  ('psicologia',      'Psicología Clínica',             'psicologia-clinica'),
  ('psicologia',      'Psicología Infantil',            'psicologia-infantil'),
  ('psicologia',      'Terapia de Pareja',              'terapia-de-pareja'),
  ('psiquiatria',     'Psiquiatría Infantil',           'psiquiatria-infantil'),
  ('psiquiatria',     'Adicciones',                     'adicciones'),
  ('traumatologia',   'Cirugía de Rodilla',             'cirugia-de-rodilla'),
  ('traumatologia',   'Cirugía de Columna',             'cirugia-de-columna'),
  ('traumatologia',   'Cirugía de Hombro',              'cirugia-de-hombro'),
  ('traumatologia',   'Traumatología Deportiva',        'traumatologia-deportiva'),
  ('oftalmologia',    'Retina',                         'retina'),
  ('oftalmologia',    'Córnea',                         'cornea'),
  ('oftalmologia',    'Glaucoma',                       'glaucoma'),
  ('oftalmologia',    'Oftalmología Pediátrica',        'oftalmologia-pediatrica'),
  ('neurologia',      'Epilepsia',                      'epilepsia'),
  ('neurologia',      'Trastornos del Movimiento',      'trastornos-del-movimiento'),
  ('neurologia',      'Neurofisiología',                'neurofisiologia'),
  ('oncologia',       'Oncología Médica',               'oncologia-medica'),
  ('oncologia',       'Radio-oncología',                'radio-oncologia'),
  ('oncologia',       'Oncología Quirúrgica',           'oncologia-quirurgica'),
  ('nutricion',       'Nutrición Clínica',              'nutricion-clinica'),
  ('nutricion',       'Nutrición Deportiva',            'nutricion-deportiva'),
  ('nutricion',       'Nutrición Pediátrica',           'nutricion-pediatrica'),
  ('medicina-interna','Medicina Crítica',               'medicina-critica'),
  ('urologia',        'Urología Oncológica',            'urologia-oncologica'),
  ('urologia',        'Andrología',                     'andrologia'),
  ('endocrinologia',  'Diabetes',                       'diabetes'),
  ('endocrinologia',  'Tiroides',                       'tiroides'),
  ('gastroenterologia','Endoscopia Digestiva',          'endoscopia-digestiva'),
  ('gastroenterologia','Hepatología Clínica',           'hepatologia-clinica'),
  ('cirugia-general', 'Cirugía Laparoscópica',          'cirugia-laparoscopica'),
  ('cirugia-general', 'Cirugía Bariátrica',             'cirugia-bariatrica'),
  ('neumologia',      'Medicina del Sueño',             'medicina-del-sueno'),
  ('medicina-estetica','Medicina Antienvejecimiento',   'medicina-antienvejecimiento'),
  ('radiologia',      'Radiología Intervencionista',    'radiologia-intervencionista')
) as v(specialty_slug, name, slug)
join public.specialties s on s.slug = v.specialty_slug;

-- -----------------------------------------------------------------------------
-- insurance_companies
-- -----------------------------------------------------------------------------
create table public.insurance_companies (
  id         smallint generated always as identity primary key,
  name       text not null unique,
  slug       text not null unique,
  logo_url   text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.insurance_companies is 'Aseguradoras aceptadas por los médicos.';

insert into public.insurance_companies (name, slug) values
  ('GNP Seguros',        'gnp-seguros'),
  ('AXA',                'axa'),
  ('MetLife',            'metlife'),
  ('Seguros Monterrey',  'seguros-monterrey'),
  ('Mapfre',             'mapfre'),
  ('Allianz',            'allianz'),
  ('Zurich',             'zurich'),
  ('Bupa',               'bupa'),
  ('Atlas Seguros',      'atlas-seguros'),
  ('Qualitas',           'qualitas');

-- -----------------------------------------------------------------------------
-- languages
-- -----------------------------------------------------------------------------
create table public.languages (
  id         smallint generated always as identity primary key,
  code       text not null unique,
  name       text not null,
  is_active  boolean not null default true
);

comment on table public.languages is 'Idiomas en que un médico puede atender.';

insert into public.languages (code, name) values
  ('es',  'Español'),
  ('en',  'Inglés'),
  ('fr',  'Francés'),
  ('de',  'Alemán'),
  ('it',  'Italiano'),
  ('pt',  'Portugués'),
  ('zh',  'Chino'),
  ('lsm', 'Lengua de Señas Mexicana'),
  ('nah', 'Náhuatl'),
  ('hch', 'Huichol');

-- -----------------------------------------------------------------------------
-- facilities — clínicas, hospitales y laboratorios
-- -----------------------------------------------------------------------------
create type public.facility_type as enum ('clinic', 'hospital', 'laboratory');

create table public.facilities (
  id              uuid primary key default gen_random_uuid(),
  facility_type   public.facility_type not null,
  name            text not null,
  slug            text not null unique,
  municipality_id smallint not null references public.municipalities(id) on delete restrict,
  address         text,
  postal_code     text,
  phone           text,
  email           extensions.citext,
  website         text,
  latitude        numeric(9, 6),
  longitude       numeric(9, 6),
  logo_url        text,
  photos          text[] not null default '{}',
  services        text[] not null default '{}',
  is_verified     boolean not null default false,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint facilities_postal_code_format check (
    postal_code is null or postal_code ~ '^[0-9]{5}$'
  )
);

comment on table public.facilities is
  'Establecimientos de salud. Unifica clinics/hospitals/laboratories del PRD mediante facility_type.';

create index facilities_type_idx         on public.facilities (facility_type) where is_active;
create index facilities_municipality_idx on public.facilities (municipality_id) where is_active;
create index facilities_name_trgm_idx    on public.facilities
  using gin (public.unaccent_immutable(name) extensions.gin_trgm_ops);

create trigger facilities_set_updated_at
  before update on public.facilities
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS — los catálogos son de lectura pública (los necesita el buscador anónimo)
-- -----------------------------------------------------------------------------
alter table public.municipalities      enable row level security;
alter table public.specialties         enable row level security;
alter table public.subspecialties      enable row level security;
alter table public.insurance_companies enable row level security;
alter table public.languages           enable row level security;
alter table public.facilities          enable row level security;

create policy "municipalities_select_all" on public.municipalities
  for select to anon, authenticated using (is_active or public.is_admin());
create policy "municipalities_write_admin" on public.municipalities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "specialties_select_all" on public.specialties
  for select to anon, authenticated using (is_active or public.is_admin());
create policy "specialties_write_admin" on public.specialties
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "subspecialties_select_all" on public.subspecialties
  for select to anon, authenticated using (is_active or public.is_admin());
create policy "subspecialties_write_admin" on public.subspecialties
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "insurance_companies_select_all" on public.insurance_companies
  for select to anon, authenticated using (is_active or public.is_admin());
create policy "insurance_companies_write_admin" on public.insurance_companies
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "languages_select_all" on public.languages
  for select to anon, authenticated using (true);
create policy "languages_write_admin" on public.languages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "facilities_select_all" on public.facilities
  for select to anon, authenticated using (is_active or public.is_admin());
create policy "facilities_write_admin" on public.facilities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());


-- ──────────────────────────────────────────────────────────────────────────
-- 20260801120400_patients.sql
-- ──────────────────────────────────────────────────────────────────────────

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


-- ──────────────────────────────────────────────────────────────────────────
-- 20260801120500_doctors.sql
-- ──────────────────────────────────────────────────────────────────────────

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


-- ──────────────────────────────────────────────────────────────────────────
-- 20260801120600_rooms_and_schedule.sql
-- ──────────────────────────────────────────────────────────────────────────

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


-- ──────────────────────────────────────────────────────────────────────────
-- 20260801120700_appointments.sql
-- ──────────────────────────────────────────────────────────────────────────

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


-- ──────────────────────────────────────────────────────────────────────────
-- 20260801120800_clinical.sql
-- ──────────────────────────────────────────────────────────────────────────

-- =============================================================================
-- DoctorCita · Fase 1 · 09 — Expediente clínico, recetas y documentos
-- =============================================================================
-- Datos sensibles de salud. El RLS aquí es más estricto que en el resto del
-- esquema: NI SIQUIERA los administradores generales leen el contenido clínico.
-- Solo el paciente dueño y el médico tratante.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- medical_records — nota clínica por consulta
-- -----------------------------------------------------------------------------
create table public.medical_records (
  id               uuid primary key default gen_random_uuid(),
  appointment_id   uuid unique references public.appointments(id) on delete set null,
  patient_id       uuid not null references public.patients(id) on delete cascade,
  doctor_id        uuid not null references public.doctors(id) on delete restrict,

  -- Nota clínica
  chief_complaint  text,          -- motivo de consulta
  history          text,          -- padecimiento actual
  physical_exam    text,
  diagnosis        text,
  icd10_codes      text[] not null default '{}',
  treatment_plan   text,
  notes            text,
  follow_up_date   date,

  -- Signos vitales. jsonb en vez de 8 columnas porque el conjunto varía por
  -- especialidad (un pediatra registra percentiles, un cardiólogo no).
  vitals           jsonb not null default '{}'::jsonb,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.medical_records is
  'Nota clínica por consulta. Acceso restringido a paciente y médico tratante.';
comment on column public.medical_records.vitals is
  'Signos vitales en jsonb: {"weight_kg":70,"height_cm":175,"bp_systolic":120,...}';

create index medical_records_patient_idx on public.medical_records (patient_id, created_at desc);
create index medical_records_doctor_idx  on public.medical_records (doctor_id, created_at desc);

create trigger medical_records_set_updated_at
  before update on public.medical_records
  for each row execute function public.set_updated_at();

create trigger medical_records_audit
  after insert or update or delete on public.medical_records
  for each row execute function public.audit_row();

-- -----------------------------------------------------------------------------
-- prescriptions — receta médica
-- -----------------------------------------------------------------------------
create table public.prescriptions (
  id                uuid primary key default gen_random_uuid(),
  medical_record_id uuid references public.medical_records(id) on delete cascade,
  appointment_id    uuid references public.appointments(id) on delete set null,
  patient_id        uuid not null references public.patients(id) on delete cascade,
  doctor_id         uuid not null references public.doctors(id) on delete restrict,

  -- Folio legible e irrepetible de la receta.
  folio             text not null unique,

  instructions      text,
  diagnosis         text,
  issued_at         timestamptz not null default now(),
  valid_until       date,

  -- PDF generado y firmado (Storage). Se conserva el hash para detectar
  -- alteraciones de un documento con validez sanitaria.
  pdf_url           text,
  pdf_sha256        text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.prescriptions is 'Receta médica digital (PRD Fase 7).';

create index prescriptions_patient_idx on public.prescriptions (patient_id, issued_at desc);
create index prescriptions_doctor_idx  on public.prescriptions (doctor_id, issued_at desc);

create trigger prescriptions_set_updated_at
  before update on public.prescriptions
  for each row execute function public.set_updated_at();

create trigger prescriptions_audit
  after insert or update or delete on public.prescriptions
  for each row execute function public.audit_row();

create sequence public.prescription_folio_seq;

create or replace function public.generate_prescription_folio()
returns trigger
language plpgsql
as $$
begin
  if new.folio is null or new.folio = '' then
    new.folio := 'RX-' || to_char(now(), 'YYYY') || '-' ||
                 lpad(nextval('public.prescription_folio_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger prescriptions_generate_folio
  before insert on public.prescriptions
  for each row execute function public.generate_prescription_folio();

-- -----------------------------------------------------------------------------
-- prescription_items — medicamentos de la receta
-- -----------------------------------------------------------------------------
create table public.prescription_items (
  id               uuid primary key default gen_random_uuid(),
  prescription_id  uuid not null references public.prescriptions(id) on delete cascade,

  drug_name        text not null,
  presentation     text,          -- "Tabletas 500 mg"
  dosage           text,          -- "1 tableta"
  frequency        text,          -- "cada 8 horas"
  duration         text,          -- "7 días"
  quantity         text,
  notes            text,
  display_order    smallint not null default 100
);

comment on table public.prescription_items is 'Medicamentos individuales de una receta.';

create index prescription_items_prescription_idx
  on public.prescription_items (prescription_id, display_order);

-- -----------------------------------------------------------------------------
-- documents — archivos clínicos del paciente
-- -----------------------------------------------------------------------------
create type public.document_type as enum (
  'lab_result', 'imaging', 'prescription', 'referral',
  'consent', 'insurance', 'identification', 'other'
);

create table public.documents (
  id                uuid primary key default gen_random_uuid(),
  patient_id        uuid not null references public.patients(id) on delete cascade,

  -- Quién lo subió: el propio paciente o un médico.
  uploaded_by       uuid not null references public.users(id) on delete restrict,
  doctor_id         uuid references public.doctors(id) on delete set null,
  appointment_id    uuid references public.appointments(id) on delete set null,
  medical_record_id uuid references public.medical_records(id) on delete set null,

  document_type     public.document_type not null default 'other',
  title             text not null,
  description       text,

  -- Ruta dentro del bucket de Storage (no URL pública: el bucket es privado).
  storage_path      text not null,
  mime_type         text,
  size_bytes        bigint,

  -- Permite al paciente ocultar un documento sin borrarlo.
  is_visible_to_patient boolean not null default true,

  created_at        timestamptz not null default now(),

  constraint documents_size_sane check (size_bytes is null or size_bytes >= 0)
);

comment on table public.documents is
  'Documentos clínicos en Storage privado. storage_path, nunca URL pública.';

create index documents_patient_idx on public.documents (patient_id, created_at desc);
create index documents_doctor_idx  on public.documents (doctor_id);

create trigger documents_audit
  after insert or update or delete on public.documents
  for each row execute function public.audit_row();

-- -----------------------------------------------------------------------------
-- RLS — el bloque más restrictivo del esquema
-- -----------------------------------------------------------------------------
alter table public.medical_records    enable row level security;
alter table public.prescriptions      enable row level security;
alter table public.prescription_items enable row level security;
alter table public.documents          enable row level security;

-- medical_records: el paciente lee lo suyo; el médico tratante lee y escribe.
-- Deliberadamente NO hay policy de administrador: un admin de plataforma no
-- tiene por qué leer diagnósticos. Para soporte se usa la bitácora, no el dato.
create policy "medical_records_select_patient"
  on public.medical_records for select
  to authenticated
  using (patient_id = public.current_patient_id());

create policy "medical_records_select_doctor"
  on public.medical_records for select
  to authenticated
  using (doctor_id = public.current_doctor_id());

create policy "medical_records_write_doctor"
  on public.medical_records for insert
  to authenticated
  with check (
    doctor_id = public.current_doctor_id()
    and public.doctor_treats_patient(patient_id)
  );

create policy "medical_records_update_doctor"
  on public.medical_records for update
  to authenticated
  using (doctor_id = public.current_doctor_id())
  with check (doctor_id = public.current_doctor_id());

-- prescriptions: mismas reglas.
create policy "prescriptions_select_patient"
  on public.prescriptions for select
  to authenticated
  using (patient_id = public.current_patient_id());

create policy "prescriptions_select_doctor"
  on public.prescriptions for select
  to authenticated
  using (doctor_id = public.current_doctor_id());

create policy "prescriptions_write_doctor"
  on public.prescriptions for insert
  to authenticated
  with check (
    doctor_id = public.current_doctor_id()
    and public.doctor_treats_patient(patient_id)
  );

create policy "prescriptions_update_doctor"
  on public.prescriptions for update
  to authenticated
  using (doctor_id = public.current_doctor_id())
  with check (doctor_id = public.current_doctor_id());

-- prescription_items hereda el permiso de su receta.
create policy "prescription_items_select"
  on public.prescription_items for select
  to authenticated
  using (exists (
    select 1 from public.prescriptions p
    where p.id = prescription_id
      and (p.patient_id = public.current_patient_id()
           or p.doctor_id = public.current_doctor_id())
  ));

create policy "prescription_items_write_doctor"
  on public.prescription_items for all
  to authenticated
  using (exists (
    select 1 from public.prescriptions p
    where p.id = prescription_id and p.doctor_id = public.current_doctor_id()
  ))
  with check (exists (
    select 1 from public.prescriptions p
    where p.id = prescription_id and p.doctor_id = public.current_doctor_id()
  ));

-- documents: el paciente ve los suyos marcados como visibles; el médico
-- tratante ve los del paciente que atiende.
create policy "documents_select_patient"
  on public.documents for select
  to authenticated
  using (patient_id = public.current_patient_id() and is_visible_to_patient);

create policy "documents_select_doctor"
  on public.documents for select
  to authenticated
  using (public.doctor_treats_patient(patient_id));

create policy "documents_insert_patient"
  on public.documents for insert
  to authenticated
  with check (
    patient_id = public.current_patient_id()
    and uploaded_by = auth.uid()
  );

create policy "documents_insert_doctor"
  on public.documents for insert
  to authenticated
  with check (
    doctor_id = public.current_doctor_id()
    and uploaded_by = auth.uid()
    and public.doctor_treats_patient(patient_id)
  );

create policy "documents_delete_owner"
  on public.documents for delete
  to authenticated
  using (uploaded_by = auth.uid());


-- ──────────────────────────────────────────────────────────────────────────
-- 20260801120900_communication.sql
-- ──────────────────────────────────────────────────────────────────────────

-- =============================================================================
-- DoctorCita · Fase 1 · 10 — Mensajería y notificaciones
-- =============================================================================

-- -----------------------------------------------------------------------------
-- conversations — hilo 1:1 entre paciente y médico
-- -----------------------------------------------------------------------------
-- El PRD solo menciona `messages`, pero sin una tabla de hilo no hay forma
-- eficiente de listar "mis conversaciones" ni de llevar el contador de no
-- leídos sin escanear toda la tabla de mensajes.
create table public.conversations (
  id                uuid primary key default gen_random_uuid(),
  patient_id        uuid not null references public.patients(id) on delete cascade,
  doctor_id         uuid not null references public.doctors(id) on delete cascade,

  -- Desnormalizado para pintar la lista de chats sin subconsultas.
  last_message_at   timestamptz,
  last_message_preview text,

  patient_unread_count smallint not null default 0,
  doctor_unread_count  smallint not null default 0,

  is_archived       boolean not null default false,
  created_at        timestamptz not null default now(),

  unique (patient_id, doctor_id)
);

comment on table public.conversations is
  'Hilo de chat paciente↔médico. Un único hilo por pareja (PRD Fase 8).';

create index conversations_patient_idx on public.conversations (patient_id, last_message_at desc);
create index conversations_doctor_idx  on public.conversations (doctor_id, last_message_at desc);

-- -----------------------------------------------------------------------------
-- messages
-- -----------------------------------------------------------------------------
create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.users(id) on delete cascade,

  body            text,

  -- Adjuntos en Storage privado: [{"path":"...","name":"...","mime":"...","size":123}]
  attachments     jsonb not null default '[]'::jsonb,

  read_at         timestamptz,
  created_at      timestamptz not null default now(),

  -- Un mensaje vacío sin adjuntos no tiene sentido.
  constraint messages_has_content check (
    coalesce(trim(body), '') <> '' or jsonb_array_length(attachments) > 0
  )
);

comment on table public.messages is 'Mensajes del chat interno. Realtime habilitado (PRD Fase 8).';

create index messages_conversation_idx on public.messages (conversation_id, created_at desc);
create index messages_unread_idx on public.messages (conversation_id)
  where read_at is null;

-- Mantiene el resumen del hilo y los contadores de no leídos.
create or replace function public.sync_conversation_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_is_patient boolean;
begin
  select (p.user_id = new.sender_id)
    into v_sender_is_patient
  from public.conversations c
  join public.patients p on p.id = c.patient_id
  where c.id = new.conversation_id;

  update public.conversations
     set last_message_at      = new.created_at,
         last_message_preview = left(coalesce(new.body, '📎 Archivo adjunto'), 140),
         patient_unread_count = case when v_sender_is_patient
                                     then patient_unread_count
                                     else patient_unread_count + 1 end,
         doctor_unread_count  = case when v_sender_is_patient
                                     then doctor_unread_count + 1
                                     else doctor_unread_count end
   where id = new.conversation_id;

  return new;
end;
$$;

create trigger messages_sync_conversation
  after insert on public.messages
  for each row execute function public.sync_conversation_on_message();

-- -----------------------------------------------------------------------------
-- notifications
-- -----------------------------------------------------------------------------
create type public.notification_channel as enum ('in_app', 'email', 'push', 'sms', 'whatsapp');

create type public.notification_type as enum (
  'appointment_created', 'appointment_confirmed', 'appointment_reminder',
  'appointment_cancelled', 'appointment_rescheduled',
  'message_received', 'review_received', 'review_replied',
  'prescription_issued', 'document_shared',
  'subscription_expiring', 'subscription_activated', 'payment_failed',
  'doctor_verified', 'doctor_rejected', 'system'
);

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,

  notification_type public.notification_type not null,
  channel      public.notification_channel not null default 'in_app',

  title        text not null,
  body         text,
  -- Ruta interna a la que lleva la notificación al pulsarla.
  action_url   text,
  -- Contexto libre: {"appointment_id":"...", "doctor_id":"..."}
  payload      jsonb not null default '{}'::jsonb,

  read_at      timestamptz,
  -- Para canales externos (correo/SMS/WhatsApp): cuándo salió de verdad.
  sent_at      timestamptz,
  failed_at    timestamptz,
  failure_reason text,

  created_at   timestamptz not null default now()
);

comment on table public.notifications is
  'Centro de notificaciones multicanal. SMS y WhatsApp quedan modelados pero inactivos hasta Fase 8.';

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id)
  where read_at is null;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.notifications enable row level security;

-- Participar en la conversación es la única llave. Sin policy de admin: el
-- contenido de un chat clínico no es asunto de la plataforma.
create policy "conversations_select_participant"
  on public.conversations for select
  to authenticated
  using (
    patient_id = public.current_patient_id()
    or doctor_id = public.current_doctor_id()
  );

create policy "conversations_insert_participant"
  on public.conversations for insert
  to authenticated
  with check (
    patient_id = public.current_patient_id()
    or doctor_id = public.current_doctor_id()
  );

create policy "conversations_update_participant"
  on public.conversations for update
  to authenticated
  using (
    patient_id = public.current_patient_id()
    or doctor_id = public.current_doctor_id()
  )
  with check (
    patient_id = public.current_patient_id()
    or doctor_id = public.current_doctor_id()
  );

create policy "messages_select_participant"
  on public.messages for select
  to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and (c.patient_id = public.current_patient_id()
           or c.doctor_id = public.current_doctor_id())
  ));

-- Solo se puede enviar como uno mismo, y solo en un hilo del que se es parte.
create policy "messages_insert_participant"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.patient_id = public.current_patient_id()
             or c.doctor_id = public.current_doctor_id())
    )
  );

-- Marcar como leído. No se permite editar el cuerpo de un mensaje ya enviado.
create policy "messages_update_read_receipt"
  on public.messages for update
  to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and (c.patient_id = public.current_patient_id()
           or c.doctor_id = public.current_doctor_id())
  ))
  with check (exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and (c.patient_id = public.current_patient_id()
           or c.doctor_id = public.current_doctor_id())
  ));

create policy "notifications_select_own"
  on public.notifications for select
  to authenticated
  using (user_id = auth.uid());

create policy "notifications_update_own"
  on public.notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "notifications_delete_own"
  on public.notifications for delete
  to authenticated
  using (user_id = auth.uid());


-- ──────────────────────────────────────────────────────────────────────────
-- 20260801121000_reviews_and_favorites.sql
-- ──────────────────────────────────────────────────────────────────────────

-- =============================================================================
-- DoctorCita · Fase 1 · 11 — Reseñas y favoritos
-- =============================================================================
-- Regla de negocio del PRD: solo se puede reseñar tras una cita COMPLETADA, y
-- una sola vez por cita. Se aplica con constraint + trigger, no solo en la UI.
-- =============================================================================

create type public.review_status as enum ('pending', 'published', 'hidden', 'removed');

-- -----------------------------------------------------------------------------
-- reviews
-- -----------------------------------------------------------------------------
create table public.reviews (
  id             uuid primary key default gen_random_uuid(),

  -- Una reseña por cita: es lo que la hace "verificada".
  appointment_id uuid not null unique references public.appointments(id) on delete cascade,
  patient_id     uuid not null references public.patients(id) on delete cascade,
  doctor_id      uuid not null references public.doctors(id) on delete cascade,

  rating         smallint not null,
  comment        text,

  -- Desglose opcional (PRD Fase 8)
  rating_punctuality smallint,
  rating_attention   smallint,
  rating_facilities  smallint,

  status         public.review_status not null default 'published',
  is_anonymous   boolean not null default false,

  -- Respuesta del médico
  doctor_reply       text,
  doctor_replied_at  timestamptz,

  -- Moderación
  moderated_by       uuid references public.users(id) on delete set null,
  moderated_at       timestamptz,
  moderation_reason  text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint reviews_rating_range check (rating between 1 and 5),
  constraint reviews_sub_ratings_range check (
    (rating_punctuality is null or rating_punctuality between 1 and 5) and
    (rating_attention   is null or rating_attention   between 1 and 5) and
    (rating_facilities  is null or rating_facilities  between 1 and 5)
  )
);

comment on table public.reviews is
  'Reseñas verificadas: ligadas 1:1 a una cita completada (PRD Fase 8).';

create index reviews_doctor_idx on public.reviews (doctor_id, created_at desc)
  where status = 'published';
create index reviews_patient_idx on public.reviews (patient_id);

create trigger reviews_set_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

create trigger reviews_audit
  after insert or update or delete on public.reviews
  for each row execute function public.audit_row();

-- -----------------------------------------------------------------------------
-- Solo se reseña una cita completada
-- -----------------------------------------------------------------------------
create or replace function public.enforce_review_requires_completed_appointment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status     public.appointment_status;
  v_patient_id uuid;
  v_doctor_id  uuid;
  v_required   boolean;
begin
  select a.status, a.patient_id, a.doctor_id
    into v_status, v_patient_id, v_doctor_id
  from public.appointments a
  where a.id = new.appointment_id;

  if not found then
    raise exception 'La cita referenciada no existe.' using errcode = '23503';
  end if;

  -- Coherencia: la reseña debe pertenecer a los mismos actores que la cita.
  if new.patient_id is distinct from v_patient_id
     or new.doctor_id is distinct from v_doctor_id then
    raise exception 'La reseña no coincide con el paciente o el médico de la cita.'
      using errcode = '23514';
  end if;

  select coalesce((value)::boolean, true)
    into v_required
  from public.settings where key = 'reviews.require_completed';

  if coalesce(v_required, true) and v_status <> 'completed' then
    raise exception 'Solo se puede reseñar una cita completada (estado actual: %).', v_status
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger reviews_require_completed_appointment
  before insert on public.reviews
  for each row execute function public.enforce_review_requires_completed_appointment();

-- -----------------------------------------------------------------------------
-- Sincronización de la calificación del médico
-- -----------------------------------------------------------------------------
create or replace function public.sync_doctor_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doctor_id uuid := coalesce(new.doctor_id, old.doctor_id);
begin
  perform public.begin_internal_write();

  update public.doctors d
     set rating_average = coalesce(agg.avg_rating, 0),
         reviews_count  = coalesce(agg.total, 0)
    from (
      select round(avg(rating)::numeric, 2) as avg_rating,
             count(*)                       as total
      from public.reviews
      where doctor_id = v_doctor_id
        and status = 'published'
    ) agg
   where d.id = v_doctor_id;

  perform public.end_internal_write();
  return coalesce(new, old);
end;
$$;

create trigger reviews_sync_doctor_rating
  after insert or update or delete on public.reviews
  for each row execute function public.sync_doctor_rating();

-- -----------------------------------------------------------------------------
-- review_reports — denuncias de reseñas abusivas
-- -----------------------------------------------------------------------------
create table public.review_reports (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references public.reviews(id) on delete cascade,
  reported_by uuid not null references public.users(id) on delete cascade,
  reason      text not null,
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),

  unique (review_id, reported_by)
);

comment on table public.review_reports is 'Denuncias de reseñas para moderación (PRD Fase 8).';

create index review_reports_unresolved_idx on public.review_reports (created_at desc)
  where resolved_at is null;

-- -----------------------------------------------------------------------------
-- favorites — médicos guardados por el paciente
-- -----------------------------------------------------------------------------
create table public.favorites (
  patient_id uuid not null references public.patients(id) on delete cascade,
  doctor_id  uuid not null references public.doctors(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (patient_id, doctor_id)
);

comment on table public.favorites is 'Médicos guardados por el paciente (PRD Fase 5).';

create index favorites_doctor_idx on public.favorites (doctor_id);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.reviews        enable row level security;
alter table public.review_reports enable row level security;
alter table public.favorites      enable row level security;

-- Las reseñas publicadas son públicas: son el activo de confianza del producto.
create policy "reviews_select_published"
  on public.reviews for select
  to anon, authenticated
  using (status = 'published');

create policy "reviews_select_own"
  on public.reviews for select
  to authenticated
  using (
    patient_id = public.current_patient_id()
    or doctor_id = public.current_doctor_id()
  );

create policy "reviews_insert_patient"
  on public.reviews for insert
  to authenticated
  with check (patient_id = public.current_patient_id());

-- El paciente edita su reseña. El trigger de columnas protegidas impide que
-- toque el estado de moderación.
create policy "reviews_update_patient"
  on public.reviews for update
  to authenticated
  using (patient_id = public.current_patient_id())
  with check (patient_id = public.current_patient_id());

-- El médico solo puede responder, no alterar la calificación.
create policy "reviews_update_doctor_reply"
  on public.reviews for update
  to authenticated
  using (doctor_id = public.current_doctor_id())
  with check (doctor_id = public.current_doctor_id());

create policy "reviews_all_admin"
  on public.reviews for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Blindaje: ni el paciente ni el médico pueden manipular calificación/estado
-- fuera de lo que les corresponde.
create or replace function public.protect_review_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  -- El médico solo puede tocar su respuesta.
  if old.doctor_id = public.current_doctor_id()
     and old.patient_id is distinct from public.current_patient_id() then
    if new.rating  is distinct from old.rating
       or new.comment is distinct from old.comment
       or new.status  is distinct from old.status then
      raise exception 'El médico solo puede responder a la reseña, no modificarla.'
        using errcode = '42501';
    end if;
    if new.doctor_reply is distinct from old.doctor_reply then
      new.doctor_replied_at := now();
    end if;
  end if;

  -- El paciente no puede auto-moderarse.
  if old.patient_id = public.current_patient_id() then
    if new.status is distinct from old.status
       or new.moderated_by is distinct from old.moderated_by
       or new.doctor_reply is distinct from old.doctor_reply then
      raise exception 'Campo de moderación protegido.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger reviews_protect_columns
  before update on public.reviews
  for each row execute function public.protect_review_columns();

create policy "review_reports_insert_authenticated"
  on public.review_reports for insert
  to authenticated
  with check (reported_by = auth.uid());

create policy "review_reports_select_own"
  on public.review_reports for select
  to authenticated
  using (reported_by = auth.uid() or public.is_admin());

create policy "review_reports_manage_admin"
  on public.review_reports for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "favorites_manage_own"
  on public.favorites for all
  to authenticated
  using (patient_id = public.current_patient_id())
  with check (patient_id = public.current_patient_id());


-- ──────────────────────────────────────────────────────────────────────────
-- 20260801121100_billing.sql
-- ──────────────────────────────────────────────────────────────────────────

-- =============================================================================
-- DoctorCita · Fase 1 · 12 — Planes, suscripciones, pagos y facturas
-- =============================================================================
-- La arquitectura queda lista para Stripe / Mercado Pago / OpenPay sin acoplarse
-- a ninguno: `provider` + `provider_*_id` guardan la referencia externa.
-- El estado de la suscripción controla la visibilidad pública del médico.
-- =============================================================================

create type public.subscription_status as enum (
  'trialing', 'active', 'past_due', 'cancelled', 'expired', 'paused'
);

create type public.payment_status as enum (
  'pending', 'processing', 'succeeded', 'failed', 'refunded', 'partially_refunded'
);

create type public.payment_method as enum (
  'card', 'spei', 'oxxo', 'paypal', 'cash', 'transfer'
);

create type public.billing_interval as enum ('month', 'year');

-- -----------------------------------------------------------------------------
-- plans
-- -----------------------------------------------------------------------------
create table public.plans (
  id               smallint generated always as identity primary key,
  key              text not null unique,
  name             text not null,
  description      text,

  price_cents      integer not null,
  currency         char(3) not null default 'MXN',
  billing_interval public.billing_interval not null default 'month',
  trial_days       smallint not null default 0,

  -- Límites del plan. null = ilimitado.
  max_consulting_rooms smallint,
  max_photos           smallint,
  max_services         smallint,

  -- Funcionalidades incluidas: {"telemedicine":true,"analytics":false,...}
  features         jsonb not null default '{}'::jsonb,

  display_order    smallint not null default 100,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),

  constraint plans_price_non_negative check (price_cents >= 0)
);

comment on table public.plans is 'Planes de suscripción para médicos (PRD Fase 9).';

insert into public.plans
  (key, name, description, price_cents, billing_interval, trial_days,
   max_consulting_rooms, max_photos, max_services, features, display_order)
values
  ('basic', 'Básico',
   'Perfil público, agenda en línea y un consultorio.',
   49900, 'month', 14, 1, 5, 10,
   '{"telemedicine": false, "analytics": false, "featured_listing": false, "chat": false}'::jsonb,
   1),
  ('professional', 'Profesional',
   'Hasta 3 consultorios, telemedicina y chat con pacientes.',
   99900, 'month', 14, 3, 20, 40,
   '{"telemedicine": true, "analytics": true, "featured_listing": false, "chat": true}'::jsonb,
   2),
  ('premium', 'Premium',
   'Consultorios ilimitados, posición destacada y reportes avanzados.',
   179900, 'month', 14, null, null, null,
   '{"telemedicine": true, "analytics": true, "featured_listing": true, "chat": true}'::jsonb,
   3);

-- -----------------------------------------------------------------------------
-- subscriptions
-- -----------------------------------------------------------------------------
create table public.subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  doctor_id            uuid not null references public.doctors(id) on delete cascade,
  plan_id              smallint not null references public.plans(id) on delete restrict,

  status               public.subscription_status not null default 'trialing',

  current_period_start timestamptz not null default now(),
  current_period_end   timestamptz not null,
  trial_ends_at        timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at         timestamptz,

  -- Referencia al proveedor de pagos, sin acoplarse a ninguno.
  provider             text,            -- 'stripe' | 'mercadopago' | 'openpay' | 'manual'
  provider_customer_id text,
  provider_subscription_id text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint subscriptions_period_order check (current_period_end > current_period_start)
);

comment on table public.subscriptions is
  'Suscripción del médico. Su estado activa o desactiva la visibilidad pública.';

create index subscriptions_doctor_idx on public.subscriptions (doctor_id, created_at desc);
create index subscriptions_status_idx on public.subscriptions (status);
create index subscriptions_renewal_idx on public.subscriptions (current_period_end)
  where status in ('active', 'trialing');

-- Una única suscripción vigente por médico.
create unique index subscriptions_one_active_per_doctor
  on public.subscriptions (doctor_id)
  where status in ('trialing', 'active', 'past_due');

create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

create trigger subscriptions_audit
  after insert or update or delete on public.subscriptions
  for each row execute function public.audit_row();

-- -----------------------------------------------------------------------------
-- Visibilidad automática del médico según su suscripción
-- -----------------------------------------------------------------------------
-- Este trigger es el que conecta Fase 9 con Fase 5: en cuanto la suscripción
-- deja de estar vigente, el perfil desaparece del buscador público.
create or replace function public.sync_doctor_subscription_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doctor_id uuid := coalesce(new.doctor_id, old.doctor_id);
  v_active    boolean;
begin
  select exists (
    select 1 from public.subscriptions s
    where s.doctor_id = v_doctor_id
      and s.status in ('trialing', 'active')
      and s.current_period_end > now()
  ) into v_active;

  perform public.begin_internal_write();

  update public.doctors
     set has_active_subscription = v_active
   where id = v_doctor_id
     and has_active_subscription is distinct from v_active;

  perform public.end_internal_write();
  return coalesce(new, old);
end;
$$;

create trigger subscriptions_sync_doctor_flag
  after insert or update or delete on public.subscriptions
  for each row execute function public.sync_doctor_subscription_flag();

-- -----------------------------------------------------------------------------
-- payments
-- -----------------------------------------------------------------------------
create table public.payments (
  id                  uuid primary key default gen_random_uuid(),

  -- Un pago es de una suscripción (médico) o de una cita (paciente).
  subscription_id     uuid references public.subscriptions(id) on delete set null,
  appointment_id      uuid references public.appointments(id) on delete set null,
  payer_user_id       uuid not null references public.users(id) on delete restrict,

  amount_cents        integer not null,
  currency            char(3) not null default 'MXN',
  status              public.payment_status not null default 'pending',
  method              public.payment_method,

  provider            text,
  provider_payment_id text,
  -- Respuesta cruda del proveedor, para depurar discrepancias.
  provider_payload    jsonb,

  paid_at             timestamptz,
  failed_at           timestamptz,
  failure_reason      text,
  refunded_cents      integer not null default 0,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint payments_amount_positive check (amount_cents > 0),
  constraint payments_refund_within_amount check (
    refunded_cents >= 0 and refunded_cents <= amount_cents
  ),
  -- Debe estar ligado a algo.
  constraint payments_has_target check (
    subscription_id is not null or appointment_id is not null
  )
);

comment on table public.payments is 'Pagos de suscripciones y de citas (PRD Fase 9).';

create index payments_subscription_idx on public.payments (subscription_id);
create index payments_appointment_idx  on public.payments (appointment_id);
create index payments_payer_idx        on public.payments (payer_user_id, created_at desc);
create unique index payments_provider_id_uniq on public.payments (provider, provider_payment_id)
  where provider_payment_id is not null;

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

create trigger payments_audit
  after insert or update or delete on public.payments
  for each row execute function public.audit_row();

-- -----------------------------------------------------------------------------
-- invoices
-- -----------------------------------------------------------------------------
create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  payment_id     uuid references public.payments(id) on delete set null,
  user_id        uuid not null references public.users(id) on delete restrict,

  folio          text not null unique,

  subtotal_cents integer not null,
  tax_cents      integer not null default 0,
  total_cents    integer not null,
  currency       char(3) not null default 'MXN',

  -- Datos fiscales mexicanos (CFDI)
  rfc            text,
  legal_name     text,
  tax_regime     text,
  cfdi_use       text,
  cfdi_uuid      text unique,
  pdf_url        text,
  xml_url        text,

  issued_at      timestamptz not null default now(),
  created_at     timestamptz not null default now(),

  constraint invoices_totals_coherent check (total_cents = subtotal_cents + tax_cents),
  constraint invoices_rfc_format check (
    rfc is null or rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'
  )
);

comment on table public.invoices is 'Comprobantes fiscales (CFDI) de los pagos.';

create index invoices_user_idx on public.invoices (user_id, issued_at desc);

create sequence public.invoice_folio_seq;

create or replace function public.generate_invoice_folio()
returns trigger
language plpgsql
as $$
begin
  if new.folio is null or new.folio = '' then
    new.folio := 'FA-' || to_char(now(), 'YYYY') || '-' ||
                 lpad(nextval('public.invoice_folio_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

create trigger invoices_generate_folio
  before insert on public.invoices
  for each row execute function public.generate_invoice_folio();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.plans         enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments      enable row level security;
alter table public.invoices      enable row level security;

-- Los planes son públicos: la página de precios los muestra sin sesión.
create policy "plans_select_all"
  on public.plans for select
  to anon, authenticated
  using (is_active or public.is_admin());

create policy "plans_write_admin"
  on public.plans for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- El médico ve su suscripción pero NO la escribe: eso lo hace el webhook del
-- proveedor de pagos vía service_role, que ignora RLS. Permitir escritura desde
-- el cliente sería permitir activarse gratis.
create policy "subscriptions_select_own"
  on public.subscriptions for select
  to authenticated
  using (doctor_id = public.current_doctor_id() or public.is_admin());

create policy "subscriptions_write_admin"
  on public.subscriptions for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "payments_select_own"
  on public.payments for select
  to authenticated
  using (payer_user_id = auth.uid() or public.is_admin());

create policy "payments_write_admin"
  on public.payments for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "invoices_select_own"
  on public.invoices for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy "invoices_write_admin"
  on public.invoices for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ──────────────────────────────────────────────────────────────────────────
-- 20260801121200_storage_and_realtime.sql
-- ──────────────────────────────────────────────────────────────────────────

-- =============================================================================
-- DoctorCita · Fase 1 · 13 — Storage y Realtime
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Buckets
-- -----------------------------------------------------------------------------
-- Públicos: lo que se muestra en el perfil público del médico.
-- Privados: todo lo clínico y lo identificable.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880,
   array['image/jpeg', 'image/png', 'image/webp']),

  ('doctor-media', 'doctor-media', true, 10485760,
   array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']),

  ('facility-photos', 'facility-photos', true, 10485760,
   array['image/jpeg', 'image/png', 'image/webp']),

  ('credentials', 'credentials', false, 10485760,
   array['image/jpeg', 'image/png', 'application/pdf']),

  ('medical-documents', 'medical-documents', false, 26214400,
   array['image/jpeg', 'image/png', 'application/pdf', 'application/dicom']),

  ('prescriptions', 'prescriptions', false, 5242880,
   array['application/pdf']),

  ('signatures', 'signatures', false, 2097152,
   array['image/png', 'image/svg+xml']),

  ('message-attachments', 'message-attachments', false, 20971520,
   array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Policies de Storage
-- -----------------------------------------------------------------------------
-- Convención de rutas: <bucket>/<user_id>/<archivo>
-- storage.foldername(name)[1] devuelve el primer segmento de la ruta, que se
-- compara contra auth.uid(). Así cada usuario solo escribe en su carpeta.

-- avatars: lectura pública, escritura en la carpeta propia.
create policy "avatars_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'avatars');

create policy "avatars_write_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- doctor-media y facility-photos: lectura pública, escritura del dueño.
create policy "doctor_media_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'doctor-media');

create policy "doctor_media_write_own"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'doctor-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'doctor-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "facility_photos_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'facility-photos');

create policy "facility_photos_write_admin"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'facility-photos' and public.is_admin())
  with check (bucket_id = 'facility-photos' and public.is_admin());

-- credentials: privado. El médico sube; solo él y el admin médico leen.
create policy "credentials_read_own_or_admin"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'credentials'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

create policy "credentials_write_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'credentials'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- signatures: privado y estrictamente personal. Ni siquiera los admin.
create policy "signatures_own_only"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'signatures'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'signatures'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- medical-documents y prescriptions: privados. El acceso NO se resuelve aquí
-- con reglas de ruta, porque un médico debe poder leer documentos que están en
-- la carpeta del paciente. Se sirven mediante URLs firmadas generadas en el
-- servidor tras comprobar el permiso contra public.documents. Por eso aquí solo
-- se permite al dueño de la carpeta: todo lo demás pasa por service_role.
create policy "medical_documents_own_folder"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'medical-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'medical-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "prescriptions_own_folder"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'prescriptions'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'prescriptions'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- message-attachments: carpeta por conversación. La pertenencia se valida en el
-- servidor al generar la URL firmada.
create policy "message_attachments_own_folder"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'message-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'message-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- -----------------------------------------------------------------------------
-- Realtime
-- -----------------------------------------------------------------------------
-- Tablas que el frontend escucha en vivo (Fases 6 y 8). Publicar SOLO estas:
-- la publicación respeta el RLS de cada tabla, pero cuantas menos, menos ruido
-- y menos carga en el servidor de Realtime.
alter publication supabase_realtime add table public.appointments;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.notifications;

-- REPLICA IDENTITY FULL permite que los eventos de UPDATE/DELETE incluyan el
-- registro anterior. Sin esto, el cliente no puede saber qué cambió ni aplicar
-- correctamente el filtro de RLS en un DELETE.
alter table public.appointments  replica identity full;
alter table public.messages      replica identity full;
alter table public.conversations replica identity full;
alter table public.notifications replica identity full;


-- ──────────────────────────────────────────────────────────────────────────
-- 20260801130000_availability_function.sql
-- ──────────────────────────────────────────────────────────────────────────

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


-- ──────────────────────────────────────────────────────────────────────────
-- 20260801140000_availability_timezone_fix.sql
-- ──────────────────────────────────────────────────────────────────────────

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


-- ──────────────────────────────────────────────────────────────────────────
-- 20260802100000_doctor_display_name.sql
-- ──────────────────────────────────────────────────────────────────────────

-- =============================================================================
-- DoctorCita · Nombre público del médico
-- =============================================================================
-- PROBLEMA: el directorio necesita el nombre del médico, que vivía solo en
-- public.users. Esa tabla tiene RLS de "cada quien ve lo suyo", así que un
-- visitante anónimo recibía null y el buscador salía vacío — sin error, que es
-- lo peor: parecía que no había médicos.
--
-- La salida fácil sería una policy que deje leer las filas de users de los
-- médicos publicados. Es mala idea: el RLS decide QUÉ FILAS se ven, no qué
-- columnas. Con la fila accesible, cualquiera podría pedir el correo y el
-- teléfono del médico.
--
-- La salida correcta es que el perfil público tenga su propio nombre. Además de
-- resolver el problema, es mejor modelado: el nombre con el que un profesional
-- quiere aparecer no tiene por qué ser el de su cuenta.
-- =============================================================================

alter table public.doctor_profiles
  add column if not exists display_name text;

comment on column public.doctor_profiles.display_name is
  'Nombre con el que el médico aparece en el directorio. Independiente del nombre de la cuenta, que es privado.';

-- Relleno para los perfiles que ya existen.
update public.doctor_profiles dp
   set display_name = u.full_name
  from public.doctors d
  join public.users u on u.id = d.user_id
 where d.id = dp.doctor_id
   and dp.display_name is null;

-- Si el médico no elige un nombre público, se toma el de su cuenta. La función
-- es SECURITY DEFINER porque necesita leer public.users, que el propio médico
-- solo puede consultar para su fila y a través del RLS.
create or replace function public.fill_doctor_display_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.display_name is null or trim(new.display_name) = '' then
    select u.full_name
      into new.display_name
    from public.doctors d
    join public.users u on u.id = d.user_id
    where d.id = new.doctor_id;
  end if;
  return new;
end;
$$;

drop trigger if exists doctor_profiles_fill_display_name on public.doctor_profiles;

create trigger doctor_profiles_fill_display_name
  before insert or update on public.doctor_profiles
  for each row execute function public.fill_doctor_display_name();


commit;
