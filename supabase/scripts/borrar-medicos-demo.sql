-- =============================================================================
-- Borrar los médicos de demostración
-- =============================================================================
-- Deshace por completo sembrar-medicos-demo.sql. Basta con eliminar el usuario
-- de auth: todo lo demás cuelga de él con ON DELETE CASCADE — perfil,
-- consultorios, horarios, servicios, suscripción y la fila de public.users.
--
-- Solo toca cuentas @doctorcita.test, así que no puede llevarse por delante a
-- un médico real ni a tu propia cuenta.
--
-- Si algún médico de demostración ya tuviera citas reservadas, el borrado
-- fallará: appointments referencia a doctors con ON DELETE RESTRICT, a
-- propósito, para que un expediente clínico no desaparezca por accidente.
-- En ese caso hay que borrar antes esas citas de prueba.
-- =============================================================================

begin;

-- Citas de prueba contra médicos de demostración, si las hubiera.
delete from public.appointments a
 where a.doctor_id in (
   select d.id from public.doctors d
   join auth.users u on u.id = d.user_id
   where u.email like '%@doctorcita.test'
 );

delete from auth.users
 where email like '%@doctorcita.test';

commit;

-- Debe devolver 0.
select count(*) as medicos_demo_restantes
  from public.doctors d
  join auth.users u on u.id = d.user_id
 where u.email like '%@doctorcita.test';
