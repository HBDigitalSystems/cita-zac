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
