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
