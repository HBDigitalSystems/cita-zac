-- =============================================================================
-- Conceder el rol de administrador
-- =============================================================================
-- Da acceso al panel de administración: validar cédulas, publicar médicos y
-- suspender perfiles.
--
-- Es una concesión real de privilegios, no un ajuste de desarrollo. Un
-- administrador puede publicar a un profesional sin verificar su cédula, así
-- que conviene que la lista sea corta y sepas quién está en ella.
--
-- Los roles son N:M: esto SUMA el rol, no reemplaza el que ya se tenga. Alguien
-- puede ser médico y administrador a la vez, que es el caso de la persona que
-- gestiona la plataforma.
--
-- Cambia el correo antes de ejecutar.
-- =============================================================================

insert into public.user_roles (user_id, role_id)
select u.id, r.id
  from auth.users u
  cross join public.roles r
 where u.email = 'TU_CORREO@ejemplo.com'
   and r.key = 'general_admin'
on conflict do nothing;

-- Comprobación: debe aparecer general_admin entre sus roles.
select u.email,
       string_agg(r.name, ', ' order by r.level) as roles
  from auth.users u
  join public.user_roles ur on ur.user_id = u.id
  join public.roles r on r.id = ur.role_id
 where u.email = 'TU_CORREO@ejemplo.com'
 group by u.email;
