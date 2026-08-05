-- =============================================================================
-- Reseñas de demostración  ·  SOLO PARA DESARROLLO
-- =============================================================================
-- Crea consultas ya atendidas para el paciente de prueba y les añade opinión,
-- para poder ver funcionando la Fase 8: el desglose por criterios, el nombre
-- reducido del autor, la respuesta del médico y el aviso que llega a su panel.
--
-- NO EJECUTAR EN PRODUCCIÓN CON PACIENTES REALES: inventa consultas que nunca
-- ocurrieron y opiniones que nadie escribió. Publicar esto en un sitio médico
-- de verdad sería exactamente el contenido fabricado que retiramos de la
-- portada y de la ficha del médico.
--
-- Se borra con supabase/scripts/borrar-medicos-demo.sql, que arrastra todo lo
-- que cuelga de las cuentas @doctorcita.test.
--
--   bun run supabase/run-sql.js scripts/sembrar-resenas-demo.sql
-- =============================================================================

begin;

-- Los triggers que protegen columnas privilegiadas rechazan escrituras sin
-- sesión (en el editor SQL auth.uid() es nulo, así que is_admin() da falso).
-- Esta llamada marca la transacción como escritura del sistema.
select public.begin_internal_write();

-- Consultas ya atendidas, una por médico de demostración, repartidas hacia
-- atrás en el tiempo para que las fechas no salgan todas iguales.
with paciente as (
  select p.id
    from public.patients p
    join auth.users u on u.id = p.user_id
   where u.email = 'paciente@doctorcita.test'
),
medicos as (
  select d.id,
         d.slug,
         row_number() over (order by d.slug) as n
    from public.doctors d
    join auth.users u on u.id = d.user_id
   where u.email like '%@doctorcita.test'
     and d.status = 'verified'
)
insert into public.appointments
  (patient_id, doctor_id, consulting_room_id, starts_at, ends_at, status, modality, reason,
   completed_at, price_cents)
select
  (select id from paciente),
  m.id,
  (select cr.id from public.consulting_rooms cr where cr.doctor_id = m.id order by cr.is_primary desc limit 1),
  -- `::date + time` produce un timestamp SIN zona, y al guardarlo en una
  -- columna con zona PostgreSQL lo toma por UTC: las 10:00 acababan siendo las
  -- 04:00 en Zacatecas, una hora a la que ningún consultorio abre. El
  -- `at time zone` fija que esas 10:00 son hora local.
  ((now() - (m.n * 9 || ' days')::interval)::date + time '10:00') at time zone 'America/Mexico_City',
  ((now() - (m.n * 9 || ' days')::interval)::date + time '10:30') at time zone 'America/Mexico_City',
  'completed',
  'in_person',
  'Consulta de control',
  now() - (m.n * 9 || ' days')::interval,
  (select price_in_person_cents from public.doctor_profiles dp where dp.doctor_id = m.id)
from medicos m
where exists (select 1 from paciente)
  -- Idempotente: si el script ya se ejecutó, no duplica las consultas.
  and not exists (
    select 1 from public.appointments a
     where a.doctor_id = m.id
       and a.patient_id = (select id from paciente)
       and a.status = 'completed'
  );

commit;

-- -----------------------------------------------------------------------------
-- Las opiniones
-- -----------------------------------------------------------------------------
-- El trigger `reviews_require_completed_appointment` solo las acepta sobre las
-- citas de arriba, y `reviews_set_author_label` calcula el nombre reducido.
begin;
select public.begin_internal_write();

with candidatas as (
  select a.id as appointment_id,
         a.patient_id,
         a.doctor_id,
         row_number() over (order by a.starts_at) as n
    from public.appointments a
    join auth.users u on u.id = (select p.user_id from public.patients p where p.id = a.patient_id)
   where u.email = 'paciente@doctorcita.test'
     and a.status = 'completed'
     and not exists (select 1 from public.reviews r where r.appointment_id = a.id)
),
textos as (
  select * from (values
    (1, 5, 'Me explicó cada estudio con calma y sin prisa. Salí entendiendo qué tengo y qué sigue.', 5, 5, 4, false),
    (2, 4, 'Buena consulta y diagnóstico claro. La sala de espera estaba llena y entré con retraso.', 3, 5, 4, false),
    (3, 5, 'Trato excelente, resolvió todas mis dudas y me dio seguimiento por mensaje.',          5, 5, 5, true),
    (4, 4, 'Profesional y directo. Agradezco que no recetara de más.',                            4, 4, 4, false),
    (5, 5, 'Muy recomendable. Puntual y con explicaciones que se entienden.',                     5, 5, 5, false),
    (6, 3, 'La consulta fue correcta, pero sentí que faltó tiempo para revisar mis análisis.',    4, 3, 3, true)
  ) as t(n, rating, comentario, puntualidad, atencion, instalaciones, anonima)
)
insert into public.reviews
  (appointment_id, patient_id, doctor_id, rating, comment,
   rating_punctuality, rating_attention, rating_facilities, is_anonymous)
select c.appointment_id, c.patient_id, c.doctor_id,
       t.rating, t.comentario,
       t.puntualidad, t.atencion, t.instalaciones, t.anonima
  from candidatas c
  join textos t on t.n = c.n;

commit;

-- Una respuesta del médico, para ver cómo se pinta el hilo completo.
begin;
select public.begin_internal_write();

update public.reviews
   set doctor_reply = 'Gracias por tomarse el tiempo de escribir. Tomo nota de lo del retraso: estamos ajustando los tiempos entre consultas.'
 where id = (
   select r.id from public.reviews r
    where r.rating = 4 and r.doctor_reply is null
    order by r.created_at limit 1
 );

commit;

-- Comprobación.
select r.author_display_name as autor,
       r.rating,
       d.slug as medico,
       (r.doctor_reply is not null) as respondida,
       r.is_anonymous as anonima
  from public.reviews r
  join public.doctors d on d.id = r.doctor_id
 order by r.created_at;
