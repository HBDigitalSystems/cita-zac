-- =============================================================================
-- Publicar un médico a mano  ·  SOLO PARA PRUEBAS
-- =============================================================================
-- Salta dos fases que todavía no existen:
--   · Fase 7 — el panel donde un administrador valida la cédula profesional
--   · Fase 9 — la contratación del plan de suscripción
--
-- ATENCIÓN: esto marca una cédula como verificada SIN haberla comprobado.
-- Es aceptable en un proyecto de desarrollo con datos propios; en producción
-- publicaría a un profesional sin validar su registro sanitario.
--
-- Sustituye el correo en los tres lugares donde aparece y ejecuta el bloque
-- entero en el SQL Editor de Supabase.
-- =============================================================================

begin;

-- El trigger `doctors_protect_privileged` impide que nadie que no sea
-- administrador toque `status`, y en el editor SQL no hay sesión: auth.uid() es
-- nulo, así que is_admin() da falso y el UPDATE sería rechazado. Esta llamada
-- marca la transacción como escritura del sistema, que es justo el caso.
select public.begin_internal_write();

update public.doctors
   set status = 'verified',
       verified_at = now()
 where user_id = (select id from auth.users where email = 'TU_CORREO@ejemplo.com');

commit;

-- La suscripción se inserta aparte: el trigger sync_doctor_subscription_flag
-- pone has_active_subscription a true por su cuenta, y con eso el médico pasa
-- a ser público.
insert into public.subscriptions (doctor_id, plan_id, status, current_period_end)
select d.id, p.id, 'active', now() + interval '1 year'
  from public.doctors d
  cross join public.plans p
 where d.user_id = (select id from auth.users where email = 'TU_CORREO@ejemplo.com')
   and p.key = 'professional'
on conflict do nothing;

-- Comprobación: debe devolver una fila con publico = true.
select d.slug,
       d.status,
       d.has_active_subscription,
       public.doctor_is_public(d) as publico
  from public.doctors d
 where d.user_id = (select id from auth.users where email = 'TU_CORREO@ejemplo.com');
