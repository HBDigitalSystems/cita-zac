-- =============================================================================
-- Cuentas de prueba con contraseña  ·  SOLO PARA DESARROLLO
-- =============================================================================
-- Crea dos cuentas con las que se puede iniciar sesión de verdad:
--
--   PACIENTE  paciente@doctorcita.test
--   MÉDICO    ana.ruiz@doctorcita.test
--
-- El paciente viene con su expediente completo, así que puede reservar sin
-- pasar por el formulario de alta. El médico es una de las fichas de
-- demostración, que ya tiene perfil, consultorio y horarios.
--
-- ANTES DE EJECUTAR: sustituye CAMBIA_ESTA_CONTRASENA por la que quieras usar.
-- El marcador está ahí a propósito — este repositorio es público, y una
-- contraseña escrita aquí sería una llave que funciona sobre la base de datos
-- real, al alcance de cualquiera que pase por GitHub.
--
-- NO EJECUTAR EN PRODUCCIÓN: son cuentas con contraseña compartida.
-- Se borran con supabase/scripts/borrar-medicos-demo.sql (las @doctorcita.test).
-- =============================================================================

begin;

-- --- Paciente de prueba ------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  -- Estos campos van a cadena vacía y NO a NULL a propósito: GoTrue falla al
  -- iniciar sesión con "Database error querying schema" si los encuentra nulos.
  -- Es un detalle conocido de las cuentas creadas por SQL en vez de por la API.
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'paciente@doctorcita.test',
  extensions.crypt('CAMBIA_ESTA_CONTRASENA', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"role":"patient","first_name":"Paciente","last_name":"De Prueba"}'::jsonb,
  now(),
  now(),
  '', '', '', ''
where not exists (
  select 1 from auth.users where email = 'paciente@doctorcita.test'
);

commit;

-- El trigger handle_new_auth_user() ya creó su fila en public.users con el rol
-- de paciente. Falta el expediente, para que pueda reservar sin rellenar nada.

insert into public.patients (
  user_id, birth_date, gender, municipality_id,
  allergies, chronic_conditions,
  emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  accepted_terms_at, accepted_privacy_at
)
select
  u.id,
  '1992-04-18',
  'prefer_not_to_say',
  (select id from public.municipalities where slug = 'zacatecas'),
  array['Penicilina'],
  array[]::text[],
  'Contacto De Prueba',
  '4921112233',
  'Hermana',
  now(),
  now()
from auth.users u
where u.email = 'paciente@doctorcita.test'
on conflict (user_id) do nothing;

-- --- Contraseña para el médico de demostración -------------------------------
-- Ana Ruiz ya tiene perfil, consultorio y horarios; solo le faltaba poder
-- iniciar sesión.
update auth.users
   set encrypted_password      = extensions.crypt('CAMBIA_ESTA_CONTRASENA', extensions.gen_salt('bf')),
       email_confirmed_at      = coalesce(email_confirmed_at, now()),
       confirmation_token      = coalesce(confirmation_token, ''),
       recovery_token          = coalesce(recovery_token, ''),
       email_change_token_new  = coalesce(email_change_token_new, ''),
       email_change            = coalesce(email_change, ''),
       updated_at              = now()
 where email = 'ana.ruiz@doctorcita.test';

-- Y el resto de médicos de demostración, por si quieres entrar con otro.
update auth.users
   set encrypted_password      = extensions.crypt('CAMBIA_ESTA_CONTRASENA', extensions.gen_salt('bf')),
       email_confirmed_at      = coalesce(email_confirmed_at, now()),
       confirmation_token      = coalesce(confirmation_token, ''),
       recovery_token          = coalesce(recovery_token, ''),
       email_change_token_new  = coalesce(email_change_token_new, ''),
       email_change            = coalesce(email_change, ''),
       updated_at              = now()
 where email like '%@doctorcita.test'
   and encrypted_password is null;

-- Comprobación.
select u.email,
       r.key as rol,
       (u.encrypted_password is not null) as puede_iniciar_sesion,
       (u.email_confirmed_at is not null) as correo_confirmado,
       exists (select 1 from public.patients p where p.user_id = u.id) as tiene_expediente,
       exists (select 1 from public.doctors d where d.user_id = u.id) as tiene_ficha_medica
  from auth.users u
  left join public.user_roles ur on ur.user_id = u.id
  left join public.roles r on r.id = ur.role_id
 where u.email like '%@doctorcita.test'
 order by u.email;
