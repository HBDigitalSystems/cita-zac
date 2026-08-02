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
