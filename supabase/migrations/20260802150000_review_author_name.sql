-- =============================================================================
-- DoctorCita · Fase 8 · Nombre público del autor de una reseña
-- =============================================================================
-- Las reseñas publicadas las lee cualquiera, incluido `anon`. El nombre de
-- quien las escribe, en cambio, vive en `public.users`, cerrado por RLS a la
-- propia fila: un visitante sin sesión leería la reseña con el autor en nulo.
--
-- El atajo evidente sería abrir `public.users` a lectura pública. Sería un
-- error grave, y no solo por el correo y el teléfono que hay en esa tabla:
-- una reseña dice a qué médico fue esa persona. Publicar el nombre completo
-- junto a la reseña de un cardiólogo, un psiquiatra o un oncólogo equivale a
-- publicar su diagnóstico. Es dato de salud, y no es nuestro.
--
-- Se guarda por tanto un nombre ya reducido en el momento de escribir:
--
--   Ana Sofía Ruiz Delgado  ->  "Ana R."
--   (marcada como anónima)  ->  "Paciente verificado"
--
-- Suficiente para que la reseña se lea como escrita por una persona real, sin
-- que sirva para identificarla. Es una instantánea a propósito: si la paciente
-- cambia su nombre después, la reseña antigua no debe cambiar sola.
-- =============================================================================

alter table public.reviews
  add column author_display_name text;

comment on column public.reviews.author_display_name is
  'Nombre reducido del autor (Ana R.), calculado al escribir. Evita exponer public.users a anon.';

-- -----------------------------------------------------------------------------
-- Cálculo del nombre reducido
-- -----------------------------------------------------------------------------
create or replace function public.review_author_label(p_patient_id uuid, p_anonymous boolean)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_first text;
  v_last  text;
begin
  if p_anonymous then
    return 'Paciente verificado';
  end if;

  select u.first_name, u.last_name
    into v_first, v_last
  from public.patients p
  join public.users u on u.id = p.user_id
  where p.id = p_patient_id;

  -- Sin nombre de pila no hay nada que reducir; la etiqueta neutra ya dice lo
  -- único que importa al lector: que detrás hubo una cita real.
  if coalesce(trim(v_first), '') = '' then
    return 'Paciente verificado';
  end if;

  -- La inicial se toma con `left(...)` sobre el texto ya recortado. En un
  -- apellido acentuado (Álvarez) `left` devuelve el carácter completo porque
  -- PostgreSQL cuenta caracteres, no bytes.
  if coalesce(trim(v_last), '') = '' then
    return trim(v_first);
  end if;

  return trim(v_first) || ' ' || left(trim(v_last), 1) || '.';
end;
$$;

-- PostgREST publica como endpoint RPC toda función del esquema `public`. Esta
-- es SECURITY DEFINER y recibe un patient_id, así que tal cual quedaría un
-- servicio para consultar el nombre de cualquier paciente por su id. Solo la
-- necesitan los triggers, que corren como propietario y no pasan por estos
-- permisos.
revoke execute on function public.review_author_label(uuid, boolean) from public, anon, authenticated;

create or replace function public.set_review_author_label()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.author_display_name := public.review_author_label(new.patient_id, new.is_anonymous);
  return new;
end;
$$;

-- Se recalcula también al actualizar: la paciente puede marcar como anónima una
-- reseña que ya publicó con su nombre, y ese cambio tiene que surtir efecto.
create trigger reviews_set_author_label
  before insert or update of is_anonymous, patient_id on public.reviews
  for each row execute function public.set_review_author_label();

-- Reseñas ya existentes (ninguna a día de hoy, pero la migración debe ser
-- correcta si se aplica sobre una base con datos).
update public.reviews
   set author_display_name = public.review_author_label(patient_id, is_anonymous)
 where author_display_name is null;

-- -----------------------------------------------------------------------------
-- El nombre reducido es un campo calculado, no un campo de usuario
-- -----------------------------------------------------------------------------
-- Sin esto, cualquiera podría firmar su reseña como "Dr. Sánchez" mediante un
-- UPDATE directo a PostgREST. El trigger de arriba lo sobrescribe en cada
-- escritura, así que basta con no dejar hueco entre ambos.
create or replace function public.protect_review_author_label()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if new.author_display_name is distinct from old.author_display_name
     and new.is_anonymous is not distinct from old.is_anonymous then
    raise exception 'El nombre mostrado se calcula solo.' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger reviews_protect_author_label
  before update on public.reviews
  for each row execute function public.protect_review_author_label();
