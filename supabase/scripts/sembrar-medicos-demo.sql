-- =============================================================================
-- Médicos de demostración  ·  SOLO PARA DESARROLLO
-- =============================================================================
-- Crea seis perfiles COMPLETOS y publicados para poder probar el buscador, el
-- perfil público y la reserva de citas sin esperar a que se registren médicos
-- reales.
--
-- Todo es ficticio y está marcado como tal:
--   · los correos terminan en @doctorcita.test, un dominio reservado que no
--     existe y al que nunca se podrá enviar nada;
--   · las cédulas profesionales son inventadas y empiezan por 90, un rango que
--     no corresponde a emisiones reales;
--   · las cuentas no tienen contraseña, así que nadie puede iniciar sesión con
--     ellas. Son fichas de escaparate, no usuarios.
--
-- NO EJECUTAR EN PRODUCCIÓN. Publicaría profesionales que no existen.
-- Para deshacerlo: supabase/scripts/borrar-medicos-demo.sql
-- =============================================================================

begin;

with nuevos_usuarios as (
  insert into auth.users (
    instance_id, id, aud, role, email,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  select
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    d.email,
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('role', 'doctor', 'first_name', d.nombre, 'last_name', d.apellidos),
    now(),
    now()
  from (values
    ('ana.ruiz@doctorcita.test',        'Ana Sofía',  'Ruiz Delgado',      'female'),
    ('carlos.banuelos@doctorcita.test', 'Carlos',     'Bañuelos Ortiz',    'male'),
    ('regina.femat@doctorcita.test',    'Regina',     'Femat Escobedo',    'female'),
    ('javier.muro@doctorcita.test',     'Javier',     'Muro Salcedo',      'male'),
    ('lucia.robles@doctorcita.test',    'Lucía',      'Robles Castañeda',  'female'),
    ('emiliano.jerez@doctorcita.test',  'Emiliano',   'Jerez Villanueva',  'male')
  ) as d(email, nombre, apellidos, sexo)
  returning id, email
)
select count(*) as usuarios_creados from nuevos_usuarios;

commit;

-- El trigger handle_new_auth_user() ya creó su fila en public.users y les
-- asignó el rol de médico. Ahora se rellena la parte profesional.

begin;

insert into public.doctors (
  user_id, license_number, specialty_license_number, primary_specialty_id,
  university, graduation_year, years_of_experience, gender, status, verified_at
)
select
  u.id,
  d.cedula,
  d.cedula_esp,
  (select id from public.specialties where slug = d.especialidad),
  d.universidad,
  d.anio,
  extract(year from current_date)::int - d.anio - 4,
  d.sexo::public.gender,
  'verified',
  now()
from (values
  ('ana.ruiz@doctorcita.test',        '9010011', '9010012', 'cardiologia',      'Universidad Autónoma de Zacatecas', 2009, 'female'),
  ('carlos.banuelos@doctorcita.test', '9010021', '9010022', 'medicina-general', 'UNAM — Facultad de Medicina',       2013, 'male'),
  ('regina.femat@doctorcita.test',    '9010031', '9010032', 'pediatria',        'Universidad de Guadalajara',        2011, 'female'),
  ('javier.muro@doctorcita.test',     '9010041', '9010042', 'odontologia',      'Universidad Autónoma de Zacatecas', 2015, 'male'),
  ('lucia.robles@doctorcita.test',    '9010051', '9010052', 'ginecologia',      'Tecnológico de Monterrey',          2007, 'female'),
  ('emiliano.jerez@doctorcita.test',  '9010061', '9010062', 'nutricion',        'Universidad La Salle',              2017, 'male')
) as d(email, cedula, cedula_esp, especialidad, universidad, anio, sexo)
join auth.users u on u.email = d.email
on conflict (user_id) do nothing;

insert into public.doctor_profiles (
  doctor_id, headline, biography, photo_url,
  price_in_person_cents, price_video_cents, price_follow_up_cents,
  accepts_new_patients, offers_telemedicine, offers_emergency,
  cancellation_policy, cancellation_hours, average_response_minutes
)
select
  dd.id,
  p.titular,
  p.bio,
  'https://api.dicebear.com/9.x/avataaars/svg?seed=' || p.avatar ||
    '&backgroundColor=b6e3f4,c0aede,d1d4f9',
  p.precio * 100,
  case when p.video then (p.precio * 80) else null end,
  (p.precio * 60),
  true,
  p.video,
  p.urgencias,
  'Cancelación sin costo hasta 24 horas antes de la cita.',
  24,
  p.respuesta
from (values
  ('ana.ruiz@doctorcita.test',        'Cardióloga clínica en Zacatecas',
   'Acompaño a pacientes con hipertensión y riesgo cardiovascular desde la prevención. Consultas sin prisa, con tiempo para explicar cada estudio y resolver dudas.',
   'sofia', 1200, true, true, 60),
  ('carlos.banuelos@doctorcita.test', 'Médico general y familiar',
   'Atiendo a familias completas: control del niño sano, adultos con enfermedades crónicas y chequeos preventivos. Doy seguimiento por mensaje entre consultas.',
   'carlos', 600, true, false, 45),
  ('regina.femat@doctorcita.test',    'Pediatra con enfoque en desarrollo infantil',
   'Control del niño sano, vacunación y acompañamiento a madres y padres primerizos. Explico sin tecnicismos y contesto las dudas que surgen en casa.',
   'regina', 800, true, true, 120),
  ('javier.muro@doctorcita.test',     'Odontólogo · Ortodoncia y estética dental',
   'Limpieza, blanqueamiento, ortodoncia y rehabilitación. Trabajo con planes de tratamiento por etapas para que el costo sea manejable.',
   'javier', 500, false, false, 240),
  ('lucia.robles@doctorcita.test',    'Ginecóloga y obstetra',
   'Control prenatal, salud reproductiva y climaterio. Consulta con ultrasonido en el consultorio y acompañamiento durante todo el embarazo.',
   'lucia', 1000, true, true, 60),
  ('emiliano.jerez@doctorcita.test',  'Nutriólogo clínico y deportivo',
   'Planes alimenticios realistas, sin dietas imposibles. Trabajo con composición corporal y ajustes cada dos semanas según cómo respondas.',
   'emiliano', 450, true, false, 480)
) as p(email, titular, bio, avatar, precio, video, urgencias, respuesta)
join auth.users u on u.email = p.email
join public.doctors dd on dd.user_id = u.id
on conflict (doctor_id) do nothing;

-- Especialidad principal también en la tabla N:M.
insert into public.doctor_specialties (doctor_id, specialty_id)
select d.id, d.primary_specialty_id
from public.doctors d
join auth.users u on u.id = d.user_id
where u.email like '%@doctorcita.test'
  and d.primary_specialty_id is not null
on conflict do nothing;

-- Idiomas: todos español, algunos también inglés.
insert into public.doctor_languages (doctor_id, language_id)
select d.id, l.id
from public.doctors d
join auth.users u on u.id = d.user_id
cross join public.languages l
where u.email like '%@doctorcita.test'
  and (l.code = 'es'
       or (l.code = 'en' and u.email in ('ana.ruiz@doctorcita.test',
                                         'lucia.robles@doctorcita.test')))
on conflict do nothing;

-- Aseguradoras aceptadas.
insert into public.doctor_insurances (doctor_id, insurance_company_id)
select d.id, i.id
from public.doctors d
join auth.users u on u.id = d.user_id
join public.insurance_companies i
  on i.slug in ('gnp-seguros', 'axa', 'metlife')
where u.email like '%@doctorcita.test'
on conflict do nothing;

-- Un consultorio por médico, repartidos por el estado.
insert into public.consulting_rooms (
  doctor_id, name, municipality_id, address, address_details, phone,
  postal_code, slot_duration_minutes, has_parking, is_accessible, is_primary
)
select
  dd.id,
  c.nombre,
  (select id from public.municipalities where slug = c.municipio),
  c.direccion,
  c.interior,
  c.telefono,
  c.cp,
  c.duracion,
  c.estacionamiento,
  c.accesible,
  true
from (values
  ('ana.ruiz@doctorcita.test',        'Consultorio Centro Médico Zacatecas', 'zacatecas',  'Av. Hidalgo 412, Col. Centro',        'Piso 3, consultorio 305', '4929221010', '98000', 30, true,  true),
  ('carlos.banuelos@doctorcita.test', 'Clínica Familiar Guadalupe',          'guadalupe',  'Blvd. López Mateos 88',              'Local 4',                 '4929221020', '98600', 20, true,  true),
  ('regina.femat@doctorcita.test',    'Consultorio Pediátrico Fresnillo',    'fresnillo',  'Calle Juárez 210, Col. Centro',      'Consultorio 12',          '4939221030', '99000', 30, false, true),
  ('javier.muro@doctorcita.test',     'Dental Jerez',                        'jerez',      'Av. González Ortega 55',             null,                      '4949221040', '99300', 45, true,  false),
  ('lucia.robles@doctorcita.test',    'Consultorio de la Mujer',             'zacatecas',  'Av. Universidad 1201',               'Torre B, piso 2',         '4929221050', '98060', 30, true,  true),
  ('emiliano.jerez@doctorcita.test',  'Nutrición Calera',                    'calera',     'Calle Insurgentes 34, Col. Centro',  null,                      '4789221060', '98500', 45, false, true)
) as c(email, nombre, municipio, direccion, interior, telefono, cp, duracion, estacionamiento, accesible)
join auth.users u on u.email = c.email
join public.doctors dd on dd.user_id = u.id
where not exists (
  select 1 from public.consulting_rooms cr where cr.doctor_id = dd.id
);

-- Horarios: de lunes a viernes por la mañana, y tres de ellos también por la
-- tarde. Uno atiende sábados. Así el buscador muestra disponibilidad variada.
insert into public.working_hours (consulting_room_id, weekday, start_time, end_time, allows_video)
select cr.id, wd.weekday, '09:00'::time, '14:00'::time, dp.offers_telemedicine
from public.consulting_rooms cr
join public.doctors dd on dd.id = cr.doctor_id
join public.doctor_profiles dp on dp.doctor_id = dd.id
join auth.users u on u.id = dd.user_id
cross join (values (1),(2),(3),(4),(5)) as wd(weekday)
where u.email like '%@doctorcita.test'
on conflict do nothing;

insert into public.working_hours (consulting_room_id, weekday, start_time, end_time, allows_video)
select cr.id, wd.weekday, '16:00'::time, '20:00'::time, dp.offers_telemedicine
from public.consulting_rooms cr
join public.doctors dd on dd.id = cr.doctor_id
join public.doctor_profiles dp on dp.doctor_id = dd.id
join auth.users u on u.id = dd.user_id
cross join (values (1),(3),(5)) as wd(weekday)
where u.email in ('ana.ruiz@doctorcita.test',
                  'carlos.banuelos@doctorcita.test',
                  'lucia.robles@doctorcita.test')
on conflict do nothing;

insert into public.working_hours (consulting_room_id, weekday, start_time, end_time, allows_video)
select cr.id, 6, '09:00'::time, '13:00'::time, false
from public.consulting_rooms cr
join public.doctors dd on dd.id = cr.doctor_id
join auth.users u on u.id = dd.user_id
where u.email = 'carlos.banuelos@doctorcita.test'
on conflict do nothing;

-- Servicios ofrecidos.
insert into public.doctor_services (doctor_id, name, price_cents, duration_minutes)
select dd.id, s.servicio, null, 30
from public.doctors dd
join auth.users u on u.id = dd.user_id
join public.specialties esp on esp.id = dd.primary_specialty_id
join (values
  ('cardiologia',      'Electrocardiograma'),
  ('cardiologia',      'Ecocardiograma'),
  ('cardiologia',      'Prueba de esfuerzo'),
  ('medicina-general', 'Consulta de primera vez'),
  ('medicina-general', 'Chequeo preventivo anual'),
  ('medicina-general', 'Control de enfermedades crónicas'),
  ('pediatria',        'Control del niño sano'),
  ('pediatria',        'Vacunación'),
  ('pediatria',        'Asesoría de lactancia'),
  ('odontologia',      'Limpieza dental'),
  ('odontologia',      'Blanqueamiento'),
  ('odontologia',      'Ortodoncia'),
  ('ginecologia',      'Papanicolaou'),
  ('ginecologia',      'Control prenatal'),
  ('ginecologia',      'Ultrasonido obstétrico'),
  ('nutricion',        'Plan alimenticio personalizado'),
  ('nutricion',        'Composición corporal'),
  ('nutricion',        'Nutrición deportiva')
) as s(especialidad, servicio) on s.especialidad = esp.slug
where u.email like '%@doctorcita.test'
  and not exists (
    select 1 from public.doctor_services ds
    where ds.doctor_id = dd.id and ds.name = s.servicio
  );

-- Suscripción activa. El trigger sync_doctor_subscription_flag pone
-- has_active_subscription en true, y con eso los perfiles pasan a ser públicos.
insert into public.subscriptions (doctor_id, plan_id, status, current_period_end)
select dd.id, p.id, 'active', now() + interval '1 year'
from public.doctors dd
join auth.users u on u.id = dd.user_id
cross join public.plans p
where u.email like '%@doctorcita.test'
  and p.key = 'professional'
  and not exists (
    select 1 from public.subscriptions s
    where s.doctor_id = dd.id and s.status in ('trialing', 'active', 'past_due')
  );

commit;

-- Comprobación: seis filas, todas con publico = true.
select d.slug,
       u.email,
       esp.name as especialidad,
       d.status,
       d.has_active_subscription,
       public.doctor_is_public(d) as publico,
       (select count(*) from public.working_hours wh
         join public.consulting_rooms cr on cr.id = wh.consulting_room_id
        where cr.doctor_id = d.id) as bloques_horario
  from public.doctors d
  join auth.users u on u.id = d.user_id
  left join public.specialties esp on esp.id = d.primary_specialty_id
 where u.email like '%@doctorcita.test'
 order by u.email;
