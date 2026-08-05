-- =============================================================================
-- Pacientes y citas de demostración para la Dra. Ana Sofía  ·  SOLO DESARROLLO
-- =============================================================================
-- Con un solo paciente no se puede juzgar si la interfaz aguanta. Esto siembra
-- seis, deliberadamente distintos entre sí, y una agenda con citas en todos los
-- estados posibles.
--
-- La variedad es el objetivo, no el adorno. Hay un paciente sin contacto de
-- emergencia, otro sin alergias registradas y otro sin tipo de sangre, porque
-- lo que hay que comprobar no es que la pantalla se vea bien con los datos
-- completos —eso siempre pasa— sino qué hace cuando faltan.
--
-- NO EJECUTAR EN PRODUCCIÓN CON PACIENTES REALES: inventa personas y consultas
-- que nunca ocurrieron.
--
-- Las cuentas comparten la contraseña de las demás de prueba. Sustituye
-- CAMBIA_ESTA_CONTRASENA antes de ejecutar: este repositorio es público, y una
-- contraseña escrita aquí sería una llave que funciona sobre la base real.
--
-- Se borra con supabase/scripts/borrar-medicos-demo.sql (arrastra @doctorcita.test).
--
--   bun run supabase/run-sql.js scripts/sembrar-pacientes-demo.sql
-- =============================================================================

begin;

-- --- Las cuentas ------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  -- Cadena vacía y NO nulo: GoTrue falla al iniciar sesión con "Database error
  -- querying schema" si encuentra nulos aquí. Es un detalle conocido de las
  -- cuentas creadas por SQL en vez de por la API.
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated', 'authenticated',
  p.email,
  extensions.crypt('CAMBIA_ESTA_CONTRASENA', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('role', 'patient', 'first_name', p.nombre, 'last_name', p.apellido),
  now(), now(),
  '', '', '', ''
from (values
  ('maria.gonzalez@doctorcita.test',  'María Fernanda', 'González Ríos'),
  ('jose.hernandez@doctorcita.test',  'José Antonio',   'Hernández Luna'),
  ('guadalupe.torres@doctorcita.test','Guadalupe',      'Torres Medina'),
  ('roberto.aguilar@doctorcita.test', 'Roberto',        'Aguilar Sandoval'),
  ('sofia.mendoza@doctorcita.test',   'Sofía',          'Mendoza Carrillo'),
  ('miguel.castro@doctorcita.test',   'Miguel Ángel',   'Castro Delgado')
) as p(email, nombre, apellido)
where not exists (select 1 from auth.users u where u.email = p.email);

commit;

-- El trigger handle_new_auth_user() ya creó su fila en public.users con el rol
-- de paciente. Falta el teléfono y el expediente.

begin;

update public.users u
   set phone = p.telefono
  from (values
    ('maria.gonzalez@doctorcita.test',  '4921234567'),
    ('jose.hernandez@doctorcita.test',  '4929876543'),
    ('guadalupe.torres@doctorcita.test','4925551234'),
    ('roberto.aguilar@doctorcita.test', '4924445566'),
    ('sofia.mendoza@doctorcita.test',   '4923332211'),
    ('miguel.castro@doctorcita.test',   '4927778899')
  ) as p(email, telefono)
 where u.email = p.email and u.phone is null;

-- --- Los expedientes --------------------------------------------------------
-- Cada uno con un hueco distinto a propósito, para ver cómo responde la ficha.
insert into public.patients (
  user_id, birth_date, gender, municipality_id, blood_type,
  allergies, chronic_conditions,
  emergency_contact_name, emergency_contact_phone, emergency_contact_relationship,
  accepted_terms_at, accepted_privacy_at
)
select
  u.id, p.nacimiento, p.genero::public.gender,
  (select id from public.municipalities where slug = p.municipio),
  -- El cast es explícito porque una de las filas trae NULL, y en un VALUES
  -- PostgreSQL deduce `text` para toda la columna si no se le dice el tipo.
  p.sangre::public.blood_type,
  p.alergias, p.cronicos,
  p.contacto, p.tel_emergencia, p.parentesco,
  now(), now()
from (values
  -- Completo: el caso ideal, con todo relleno.
  ('maria.gonzalez@doctorcita.test', '1988-03-14'::date, 'female', 'zacatecas', 'O+',
   array['Penicilina','Mariscos'], array['Hipertensión arterial'],
   'Carlos González', '4921112233', 'Hermano'),

  -- Mayor, con varios padecimientos: la ficha tiene que caber igual.
  ('jose.hernandez@doctorcita.test', '1954-11-02'::date, 'male', 'guadalupe', 'A+',
   array['Sulfas'], array['Diabetes tipo 2','Hipertensión arterial','Dislipidemia'],
   'Rosa Luna', '4922223344', 'Esposa'),

  -- SIN contacto de emergencia: el aviso de urgencias debe desaparecer, no
  -- quedarse pintado con huecos vacíos.
  ('guadalupe.torres@doctorcita.test', '1996-07-21'::date, 'female', 'fresnillo', 'B+',
   array['Ibuprofeno'], array[]::text[],
   null, null, null),

  -- SIN alergias ni crónicos: el bloque de antecedentes no debe aparecer.
  ('roberto.aguilar@doctorcita.test', '1979-01-30'::date, 'male', 'zacatecas', 'O-',
   array[]::text[], array[]::text[],
   'Elena Sandoval', '4924445577', 'Esposa'),

  -- SIN tipo de sangre: la línea del encabezado no debe mostrar " · null".
  ('sofia.mendoza@doctorcita.test', '2001-09-05'::date, 'female', 'jerez', null,
   array['Látex'], array['Asma'],
   'Patricia Carrillo', '4923331100', 'Madre'),

  -- Prefiere no decir su género, con alergia grave.
  ('miguel.castro@doctorcita.test', '1967-05-18'::date, 'prefer_not_to_say', 'zacatecas', 'AB+',
   array['Penicilina','Aspirina','Yodo'], array['Insuficiencia cardíaca'],
   'Laura Castro', '4927770011', 'Hija')
) as p(email, nacimiento, genero, municipio, sangre, alergias, cronicos,
       contacto, tel_emergencia, parentesco)
join auth.users u on u.email = p.email
on conflict (user_id) do nothing;

commit;

-- --- La agenda --------------------------------------------------------------
-- Las horas se escriben en hora local y se convierten con `at time zone`. Si se
-- pusiera el desfase a mano (15:00 para las 09:00) el script quedaría atado a
-- UTC-6 y se rompería el día que cambie la regla horaria.
begin;
select public.begin_internal_write();

insert into public.appointments
  (patient_id, doctor_id, consulting_room_id, starts_at, ends_at,
   status, modality, reason, price_cents, completed_at, confirmed_at,
   cancelled_at, cancellation_reason, is_first_visit)
select
  pac.id, doc.id, sala.id,
  (c.dia || ' ' || c.hora)::timestamp at time zone 'America/Mexico_City',
  (c.dia || ' ' || c.hora)::timestamp at time zone 'America/Mexico_City' + interval '30 minutes',
  c.estado::public.appointment_status,
  c.modalidad::public.appointment_modality,
  c.motivo,
  120000,
  case when c.estado = 'completed'
       then (c.dia || ' ' || c.hora)::timestamp at time zone 'America/Mexico_City' + interval '30 minutes'
       end,
  case when c.estado in ('completed','confirmed') then now() - interval '2 days' end,
  case when c.estado like 'cancelled%' then now() - interval '1 day' end,
  case when c.estado like 'cancelled%' then 'El paciente reprogramó por motivos de trabajo' end,
  c.primera
from (values
  -- Atendidas: alimentan el historial y habilitan las reseñas.
  ('maria.gonzalez@doctorcita.test',  '2026-07-08', '10:00', 'completed', 'in_person', 'Control de presión arterial', false),
  ('jose.hernandez@doctorcita.test',  '2026-07-15', '11:00', 'completed', 'in_person', 'Revisión de tratamiento para diabetes', false),
  ('miguel.castro@doctorcita.test',   '2026-07-22', '09:30', 'completed', 'in_person', 'Seguimiento de insuficiencia cardíaca', false),
  ('sofia.mendoza@doctorcita.test',   '2026-07-29', '17:00', 'completed', 'video',     'Valoración de dolor torácico', true),

  -- Confirmadas y pendientes: la agenda que verá al entrar.
  ('maria.gonzalez@doctorcita.test',  '2026-08-05', '09:00', 'confirmed', 'in_person', 'Revisión de resultados de laboratorio', false),
  ('roberto.aguilar@doctorcita.test', '2026-08-05', '10:30', 'confirmed', 'in_person', 'Chequeo cardiovascular preventivo', true),
  ('guadalupe.torres@doctorcita.test','2026-08-06', '12:00', 'pending',   'in_person', 'Palpitaciones ocasionales', true),
  ('jose.hernandez@doctorcita.test',  '2026-08-07', '16:30', 'confirmed', 'video',     'Ajuste de medicamento', false),
  ('sofia.mendoza@doctorcita.test',   '2026-08-10', '09:30', 'pending',   'in_person', 'Resultado de electrocardiograma', false),

  -- Cancelada: comprueba que el hueco vuelve a ofrecerse y que el estado se
  -- pinta distinto.
  ('miguel.castro@doctorcita.test',   '2026-08-11', '18:00', 'cancelled_by_patient', 'in_person', 'Consulta de seguimiento', false)
) as c(email, dia, hora, estado, modalidad, motivo, primera)
join auth.users u   on u.email = c.email
join public.patients pac on pac.user_id = u.id
cross join lateral (
  select d.id from public.doctors d
  join auth.users du on du.id = d.user_id
  where du.email = 'ana.ruiz@doctorcita.test'
) doc
cross join lateral (
  select cr.id from public.consulting_rooms cr
  where cr.doctor_id = doc.id order by cr.is_primary desc limit 1
) sala
where not exists (
  select 1 from public.appointments a
   where a.patient_id = pac.id
     and a.doctor_id = doc.id
     and a.starts_at = (c.dia || ' ' || c.hora)::timestamp at time zone 'America/Mexico_City'
);

commit;

-- --- Notas clínicas de las consultas ya atendidas ---------------------------
begin;
select public.begin_internal_write();

insert into public.medical_records
  (appointment_id, patient_id, doctor_id, chief_complaint, diagnosis, treatment_plan, notes, vitals)
select
  a.id, a.patient_id, a.doctor_id,
  n.motivo, n.diagnostico, n.plan, n.nota, n.signos::jsonb
from (values
  ('maria.gonzalez@doctorcita.test',
   'Cifras de presión elevadas en tomas domiciliarias',
   'Hipertensión arterial esencial, controlada',
   'Continuar losartán 50 mg cada 24 h. Dieta baja en sodio. Control en 3 meses.',
   'Buena adherencia al tratamiento. Refiere caminar 30 minutos diarios.',
   '{"bp_systolic":128,"bp_diastolic":82,"heart_rate":72,"weight_kg":68}'),

  ('jose.hernandez@doctorcita.test',
   'Revisión de control glucémico y riesgo cardiovascular',
   'Diabetes tipo 2 con control subóptimo. Dislipidemia mixta.',
   'Ajuste de metformina a 850 mg cada 12 h. Se agrega atorvastatina 20 mg. Laboratorios en 6 semanas.',
   'Se insiste en la importancia del apego a la dieta. Vive solo entre semana.',
   '{"bp_systolic":142,"bp_diastolic":88,"heart_rate":78,"weight_kg":84,"glucose_mg_dl":168}'),

  ('miguel.castro@doctorcita.test',
   'Disnea de medianos esfuerzos y edema en miembros inferiores',
   'Insuficiencia cardíaca con fracción de eyección reducida, clase funcional II',
   'Mantener furosemida y enalapril. Restricción de líquidos a 1.5 L/día. Ecocardiograma de control.',
   'ALERGIA A PENICILINA, ASPIRINA Y YODO: verificar antes de cualquier estudio con contraste.',
   '{"bp_systolic":118,"bp_diastolic":70,"heart_rate":88,"weight_kg":79,"o2_saturation":94}'),

  ('sofia.mendoza@doctorcita.test',
   'Dolor torácico opresivo de aparición reciente',
   'Dolor torácico de origen musculoesquelético. Se descarta origen cardíaco.',
   'Analgésico a demanda. Se solicita electrocardiograma de control por antecedente de asma.',
   'Primera consulta. Paciente ansiosa por antecedentes familiares; se explica el resultado con detalle.',
   '{"bp_systolic":110,"bp_diastolic":68,"heart_rate":84,"weight_kg":57}')
) as n(email, motivo, diagnostico, plan, nota, signos)
join auth.users u        on u.email = n.email
join public.patients pac on pac.user_id = u.id
join public.appointments a on a.patient_id = pac.id and a.status = 'completed'
join public.doctors d      on d.id = a.doctor_id
join auth.users du         on du.id = d.user_id and du.email = 'ana.ruiz@doctorcita.test'
where not exists (
  select 1 from public.medical_records mr where mr.appointment_id = a.id
);

commit;

-- Comprobación.
select u.email,
       coalesce(pu.full_name, '—')                         as paciente,
       a.status                                            as estado,
       to_char(a.starts_at at time zone 'America/Mexico_City', 'DD Mon HH24:MI') as cuando,
       a.reference                                         as folio,
       (mr.id is not null)                                 as con_nota
  from public.appointments a
  join public.patients p  on p.id = a.patient_id
  join public.users pu    on pu.id = p.user_id
  join auth.users u       on u.id = p.user_id
  join public.doctors d   on d.id = a.doctor_id
  join auth.users du      on du.id = d.user_id
  left join public.medical_records mr on mr.appointment_id = a.id
 where du.email = 'ana.ruiz@doctorcita.test'
 order by a.starts_at;
