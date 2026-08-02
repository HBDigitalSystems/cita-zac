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
