// Pruebas de comportamiento del RLS y de las reglas de negocio de DoctorCita.
// Cada caso ejecuta una operación real bajo la identidad de un usuario concreto
// y comprueba que el resultado es el esperado. Aquí se verifica lo que el
// chequeo de DDL no puede: que las policies dejen pasar y bloqueen a quien toca.

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { citext } from '@electric-sql/pglite/contrib/citext'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { unaccent } from '@electric-sql/pglite/contrib/unaccent'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = process.argv[2] ?? join(HERE, '..', 'migrations')

const STUBS = `
  create role anon; create role authenticated; create role service_role;
  create schema if not exists auth;
  create schema if not exists storage;
  create schema if not exists extensions;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text, phone text,
    raw_user_meta_data jsonb default '{}'::jsonb,
    created_at timestamptz default now()
  );
  create or replace function auth.uid() returns uuid language sql stable as $fn$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $fn$;
  create table storage.buckets (
    id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id), name text, owner uuid
  );
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $fn$ select string_to_array(name, '/'); $fn$;
  create publication supabase_realtime;
`

const db = await PGlite.create({
  extensions: { pg_trgm, citext, btree_gist, pgcrypto, unaccent },
})

await db.exec(STUBS)

// Supabase concede estos permisos por defecto; PGlite no.
//
// Van ANTES de las migraciones y como privilegios por defecto, no como un
// `grant on all` posterior. La diferencia importa: los privilegios por defecto
// se aplican en el momento de crear cada objeto, así que un `revoke` escrito
// dentro de una migración sobrevive. Un `grant on all` al final volvería a
// conceder lo revocado y dejaría pasar pruebas de permisos que en Supabase
// fallarían — o peor, ocultaría que una función SECURITY DEFINER quedó
// expuesta como endpoint RPC.
await db.exec(`
  grant usage on schema public, extensions to anon, authenticated;
  -- Supabase concede esto también. Hacía falta en cuanto una función
  -- SECURITY INVOKER llama a auth.uid() por su cuenta: dentro de una SECURITY
  -- DEFINER no se notaba, porque esa corre como propietario.
  grant usage on schema auth to anon, authenticated;
  alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
  alter default privileges in schema public grant usage, select on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`)

for (const f of (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(await readFile(join(MIGRATIONS, f), 'utf8'))
}

// ---------------------------------------------------------------- utilidades
let pass = 0, fail = 0
const failures = []

async function check(name, fn) {
  try {
    await fn()
    pass++
    console.log(`  PASA    ${name}`)
  } catch (e) {
    fail++
    failures.push({ name, message: e.message })
    console.log(`  FALLA   ${name}`)
    console.log(`          ${e.message.split('\n')[0]}`)
  }
}

// Ejecuta como un usuario autenticado concreto.
async function as(userId, sql, params = []) {
  await db.exec(`set role authenticated;`)
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId])
  try {
    return await db.query(sql, params)
  } finally {
    await db.exec(`reset role;`)
  }
}

// Ejecuta como visitante anónimo.
async function asAnon(sql, params = []) {
  await db.exec(`set role anon;`)
  await db.query(`select set_config('request.jwt.claim.sub', '', false)`)
  try {
    return await db.query(sql, params)
  } finally {
    await db.exec(`reset role;`)
  }
}

// Como superusuario, saltándose el RLS (equivale a service_role).
const sys = (sql, params = []) => db.query(sql, params)

function assert(cond, msg) { if (!cond) throw new Error(msg) }

async function expectRejected(promise, fragment) {
  let threw = false
  try { await promise } catch (e) {
    threw = true
    assert(
      !fragment || e.message.toLowerCase().includes(fragment.toLowerCase()),
      `Rechazado, pero por otro motivo: ${e.message.split('\n')[0]}`
    )
  }
  assert(threw, 'Se esperaba un rechazo y la operación fue aceptada')
}

// ------------------------------------------------------------------- montaje
console.log('\nMontando escenario de prueba...\n')

const [pacienteA, pacienteB, medico1, medico2, admin] = await Promise.all(
  ['ana@test.mx', 'beto@test.mx', 'dra.ruiz@test.mx', 'dr.solis@test.mx', 'admin@test.mx'].map(
    async (email, i) => {
      const role = i < 2 ? 'patient' : i < 4 ? 'doctor' : 'patient'
      const r = await sys(
        `insert into auth.users (email, raw_user_meta_data)
         values ($1, jsonb_build_object('role', $2::text, 'first_name', $3::text, 'last_name', 'Prueba'))
         returning id`,
        [email, role, email.split('@')[0]]
      )
      return r.rows[0].id
    }
  )
)

// Al admin se le asigna su rol a mano: nadie puede auto-asignárselo.
await sys(
  `insert into public.user_roles (user_id, role_id)
   select $1, id from public.roles where key = 'general_admin'`, [admin]
)

const pA = (await sys(
  `insert into public.patients (user_id, birth_date, gender)
   values ($1, '1990-05-12', 'female') returning id`, [pacienteA])).rows[0].id
const pB = (await sys(
  `insert into public.patients (user_id, birth_date, gender)
   values ($1, '1985-03-20', 'male') returning id`, [pacienteB])).rows[0].id

const d1 = (await sys(
  `insert into public.doctors (user_id, license_number, primary_specialty_id, status)
   values ($1, 'AB123456', (select id from public.specialties where slug='cardiologia'), 'verified')
   returning id`, [medico1])).rows[0].id
const d2 = (await sys(
  `insert into public.doctors (user_id, license_number, primary_specialty_id, status)
   values ($1, 'CD789012', (select id from public.specialties where slug='pediatria'), 'draft')
   returning id`, [medico2])).rows[0].id

await sys(`insert into public.doctor_profiles (doctor_id, biography) values ($1, 'Cardióloga.')`, [d1])

const room1 = (await sys(
  `insert into public.consulting_rooms (doctor_id, name, municipality_id, address, is_primary)
   values ($1, 'Consultorio Centro', (select id from public.municipalities where slug='zacatecas'),
           'Av. Hidalgo 100', true) returning id`, [d1])).rows[0].id

console.log('Escenario listo. Ejecutando pruebas.\n')

// ============================================================ VISIBILIDAD ===
console.log('Visibilidad pública del médico')

await check('El médico verificado SIN suscripción no es visible para un anónimo', async () => {
  const r = await asAnon(`select id from public.doctors where id = $1`, [d1])
  assert(r.rows.length === 0, `Se filtró un médico sin suscripción activa`)
})

await check('Una suscripción activa lo hace visible automáticamente', async () => {
  await sys(
    `insert into public.subscriptions (doctor_id, plan_id, status, current_period_end)
     values ($1, (select id from public.plans where key='professional'), 'active', now() + interval '30 days')`,
    [d1]
  )
  const flag = await sys(`select has_active_subscription from public.doctors where id = $1`, [d1])
  assert(flag.rows[0].has_active_subscription === true,
    'El trigger no activó has_active_subscription')

  const r = await asAnon(`select id from public.doctors where id = $1`, [d1])
  assert(r.rows.length === 1, 'El médico con suscripción activa sigue oculto')
})

await check('Un anónimo puede leer el NOMBRE del médico publicado', async () => {
  // Regresión de un fallo real: el nombre vivía solo en public.users, que tiene
  // RLS de "cada quien ve lo suyo". El directorio salía vacío para los
  // visitantes, y sin error: simplemente sin médicos. Ahora el nombre público
  // está en doctor_profiles.display_name.
  const r = await asAnon(
    `select dp.display_name
       from public.doctor_profiles dp
       join public.doctors d on d.id = dp.doctor_id
      where d.id = $1`,
    [d1],
  )
  assert(r.rows.length === 1, 'El perfil público del médico no es visible')
  assert(
    Boolean(r.rows[0].display_name),
    'display_name llega vacío: el buscador mostraría este médico sin nombre',
  )
})

await check('Pero NO puede leer el correo ni el teléfono de su cuenta', async () => {
  // La contrapartida del caso anterior: el nombre es público, los datos de
  // contacto de la cuenta no. Si esto fallara, cualquiera podría cosechar los
  // correos de todos los médicos del directorio.
  const r = await asAnon(`select email, phone from public.users where id = $1`, [medico1])
  assert(r.rows.length === 0, 'FUGA: se leyeron datos de contacto de un usuario')
})

await check('El médico en borrador nunca es visible, aunque pague', async () => {
  await sys(
    `insert into public.subscriptions (doctor_id, plan_id, status, current_period_end)
     values ($1, (select id from public.plans where key='basic'), 'active', now() + interval '30 days')`,
    [d2]
  )
  const r = await asAnon(`select id from public.doctors where id = $1`, [d2])
  assert(r.rows.length === 0, 'Un médico sin verificar se filtró al público')
})

await check('Cancelar la suscripción lo oculta de nuevo', async () => {
  await sys(`update public.subscriptions set status = 'cancelled' where doctor_id = $1`, [d1])
  const r = await asAnon(`select id from public.doctors where id = $1`, [d1])
  assert(r.rows.length === 0, 'Sigue visible tras cancelar la suscripción')
  // Se restaura para el resto de pruebas.
  await sys(`update public.subscriptions set status = 'active' where doctor_id = $1`, [d1])
})

// ============================================================== BLINDAJE ====
console.log('\nBlindaje de columnas privilegiadas')

await check('Un médico NO puede auto-verificarse', async () => {
  await expectRejected(
    as(medico2, `update public.doctors set status = 'verified' where id = $1`, [d2]),
    'administrador'
  )
})

await check('Un médico SÍ puede enviarse a revisión (draft → pending)', async () => {
  await as(medico2, `update public.doctors set status = 'pending_verification' where id = $1`, [d2])
  const r = await sys(`select status from public.doctors where id = $1`, [d2])
  assert(r.rows[0].status === 'pending_verification', 'No se aplicó el cambio legítimo')
})

await check('Un médico NO puede inflar su propia calificación', async () => {
  await expectRejected(
    as(medico1, `update public.doctors set rating_average = 5 where id = $1`, [d1]),
    'protegido'
  )
})

await check('Un médico NO puede activarse la suscripción a mano', async () => {
  // Se parte de un estado real de impago: sin esto el UPDATE no cambia nada y
  // el guardián no tendría por qué saltar.
  await sys(`update public.subscriptions set status = 'expired' where doctor_id = $1`, [d2])
  const antes = await sys(`select has_active_subscription from public.doctors where id = $1`, [d2])
  assert(antes.rows[0].has_active_subscription === false,
    'Montaje inválido: el médico ya figuraba como suscrito')

  await expectRejected(
    as(medico2, `update public.doctors set has_active_subscription = true where id = $1`, [d2]),
    'protegido'
  )

  const despues = await sys(`select has_active_subscription from public.doctors where id = $1`, [d2])
  assert(despues.rows[0].has_active_subscription === false, 'FUGA: el médico se activó solo')
})

// ========================================================= DOBLE RESERVA ====
console.log('\nIntegridad de la agenda')

const cita1 = (await sys(
  `insert into public.appointments
     (patient_id, doctor_id, consulting_room_id, starts_at, ends_at, status, reason)
   values ($1, $2, $3, '2026-09-01 10:00+00', '2026-09-01 10:30+00', 'confirmed', 'Chequeo')
   returning id`, [pA, d1, room1])).rows[0].id

await check('Dos citas solapadas del mismo médico son rechazadas por la BD', async () => {
  await expectRejected(
    sys(`insert into public.appointments
           (patient_id, doctor_id, consulting_room_id, starts_at, ends_at, status)
         values ($1, $2, $3, '2026-09-01 10:15+00', '2026-09-01 10:45+00', 'pending')`,
      [pB, d1, room1]),
    'appointments_no_double_booking'
  )
})

await check('Una cita contigua (sin solape) sí se acepta', async () => {
  await sys(`insert into public.appointments
               (patient_id, doctor_id, consulting_room_id, starts_at, ends_at, status)
             values ($1, $2, $3, '2026-09-01 10:30+00', '2026-09-01 11:00+00', 'pending')`,
    [pB, d1, room1])
})

await check('Cancelar libera el hueco para otro paciente', async () => {
  await sys(`update public.appointments set status = 'cancelled_by_patient'
             where starts_at = '2026-09-01 10:30+00'`)
  await sys(`insert into public.appointments
               (patient_id, doctor_id, consulting_room_id, starts_at, ends_at, status)
             values ($1, $2, $3, '2026-09-01 10:30+00', '2026-09-01 11:00+00', 'confirmed')`,
    [pA, d1, room1])
})

await check('Bloques de horario solapados en el mismo consultorio se rechazan', async () => {
  await sys(`insert into public.working_hours (consulting_room_id, weekday, start_time, end_time)
             values ($1, 1, '09:00', '14:00')`, [room1])
  await expectRejected(
    sys(`insert into public.working_hours (consulting_room_id, weekday, start_time, end_time)
         values ($1, 1, '13:00', '18:00')`, [room1]),
    'working_hours_no_overlap'
  )
})

await check('El folio de la cita se genera solo', async () => {
  const r = await sys(`select reference from public.appointments where id = $1`, [cita1])
  assert(/^DC-\d{4}-\d{6}$/.test(r.rows[0].reference),
    `Folio con formato inesperado: ${r.rows[0].reference}`)
})

// ========================================================= CONFIDENCIAL =====
console.log('\nConfidencialidad del expediente clínico')

await sys(
  `insert into public.medical_records (appointment_id, patient_id, doctor_id, diagnosis)
   values ($1, $2, $3, 'Hipertensión leve')`, [cita1, pA, d1]
)

await check('El paciente lee su propio expediente', async () => {
  const r = await as(pacienteA, `select diagnosis from public.medical_records`)
  assert(r.rows.length === 1, 'El paciente no ve su propio expediente')
})

await check('Un paciente NO puede leer el expediente de otro', async () => {
  const r = await as(pacienteB, `select diagnosis from public.medical_records`)
  assert(r.rows.length === 0, 'FUGA: se leyó el expediente de otro paciente')
})

await check('El médico tratante lee el expediente de su paciente', async () => {
  const r = await as(medico1, `select diagnosis from public.medical_records`)
  assert(r.rows.length === 1, 'El médico tratante no ve el expediente')
})

await check('Un médico ajeno NO puede leer el expediente', async () => {
  const r = await as(medico2, `select diagnosis from public.medical_records`)
  assert(r.rows.length === 0, 'FUGA: un médico sin relación leyó el expediente')
})

await check('Ni siquiera un administrador puede leer diagnósticos', async () => {
  const r = await as(admin, `select diagnosis from public.medical_records`)
  assert(r.rows.length === 0, 'FUGA: un administrador leyó datos clínicos')
})

await check('El médico tratante sí ve la ficha del paciente', async () => {
  const r = await as(medico1, `select id from public.patients where id = $1`, [pA])
  assert(r.rows.length === 1, 'El médico tratante no ve la ficha de su paciente')
})

await check('El médico tratante ve el nombre y contacto de su paciente', async () => {
  // Sin esto la agenda del médico mostraría citas sin nombre. El alcance es
  // estrecho: solo pacientes con los que tiene cita.
  const r = await as(medico1, `select full_name, email from public.users where id = $1`, [
    pacienteA,
  ])
  assert(r.rows.length === 1, 'El médico tratante no ve los datos de su paciente')
  assert(Boolean(r.rows[0].full_name), 'El nombre llega vacío')
})

await check('Un médico ajeno NO ve los datos de contacto de ese paciente', async () => {
  const r = await as(medico2, `select full_name, email from public.users where id = $1`, [
    pacienteA,
  ])
  assert(r.rows.length === 0, 'FUGA: un médico sin relación leyó datos del paciente')
})

await check('Un paciente NO ve los datos de otro paciente', async () => {
  const r = await as(pacienteB, `select email from public.users where id = $1`, [pacienteA])
  assert(r.rows.length === 0, 'FUGA: un paciente leyó el correo de otro')
})

await check('Un médico ajeno NO ve la ficha del paciente', async () => {
  const r = await as(medico2, `select id from public.patients where id = $1`, [pA])
  assert(r.rows.length === 0, 'FUGA: médico sin relación vio la ficha del paciente')
})

// ============================================================== RESEÑAS =====
console.log('\nReglas de las reseñas')

await check('No se puede reseñar una cita que no está completada', async () => {
  await expectRejected(
    sys(`insert into public.reviews (appointment_id, patient_id, doctor_id, rating, comment)
         values ($1, $2, $3, 5, 'Excelente')`, [cita1, pA, d1]),
    'completada'
  )
})

await check('Tras completar la cita, la reseña se acepta y actualiza el rating', async () => {
  await sys(`update public.appointments set status = 'completed' where id = $1`, [cita1])
  await sys(`insert into public.reviews (appointment_id, patient_id, doctor_id, rating, comment)
             values ($1, $2, $3, 4, 'Muy atenta')`, [cita1, pA, d1])

  const r = await sys(`select rating_average, reviews_count, appointments_count
                       from public.doctors where id = $1`, [d1])
  assert(Number(r.rows[0].rating_average) === 4, `rating_average = ${r.rows[0].rating_average}, se esperaba 4`)
  assert(r.rows[0].reviews_count === 1, `reviews_count = ${r.rows[0].reviews_count}`)
  assert(r.rows[0].appointments_count === 1, `appointments_count = ${r.rows[0].appointments_count}`)
})

await check('Una segunda reseña sobre la misma cita se rechaza', async () => {
  await expectRejected(
    sys(`insert into public.reviews (appointment_id, patient_id, doctor_id, rating)
         values ($1, $2, $3, 1)`, [cita1, pA, d1]),
    'unique'
  )
})

await check('El médico NO puede alterar la calificación recibida', async () => {
  await expectRejected(
    as(medico1, `update public.reviews set rating = 5 where doctor_id = $1`, [d1]),
    'responder'
  )
})

await check('El médico SÍ puede responder, y se sella la fecha', async () => {
  await as(medico1, `update public.reviews set doctor_reply = 'Gracias por su confianza.'
                     where doctor_id = $1`, [d1])
  const r = await sys(`select doctor_reply, doctor_replied_at from public.reviews where doctor_id = $1`, [d1])
  assert(r.rows[0].doctor_reply !== null, 'No se guardó la respuesta')
  assert(r.rows[0].doctor_replied_at !== null, 'No se selló doctor_replied_at')
})

await check('Las reseñas publicadas son visibles para un anónimo', async () => {
  const r = await asAnon(`select rating from public.reviews`)
  assert(r.rows.length === 1, 'Un visitante no puede ver las reseñas publicadas')
})

// ===================================================== AUTORÍA DE RESEÑAS ===
console.log('\nAutoría pública de las reseñas')

await check('El anónimo lee la reseña CON el nombre reducido de quien la escribió', async () => {
  const r = await asAnon(`select author_display_name from public.reviews`)
  // El escenario crea a la paciente como first_name 'ana', last_name 'Prueba'.
  assert(
    r.rows[0].author_display_name === 'ana P.',
    `Se esperaba "ana P." y llegó ${JSON.stringify(r.rows[0].author_display_name)}`
  )
})

await check('El nombre reducido NO permite reconstruir el apellido completo', async () => {
  const r = await asAnon(`select author_display_name from public.reviews`)
  assert(
    !r.rows[0].author_display_name.includes('Prueba'),
    'El apellido completo viajó dentro del nombre mostrado'
  )
})

await check('Marcar la reseña como anónima borra el nombre de la vista pública', async () => {
  await as(pacienteA, `update public.reviews set is_anonymous = true where patient_id = $1`, [pA])
  const r = await asAnon(`select author_display_name from public.reviews`)
  assert(
    r.rows[0].author_display_name === 'Paciente verificado',
    `Quedó ${JSON.stringify(r.rows[0].author_display_name)}`
  )
  await as(pacienteA, `update public.reviews set is_anonymous = false where patient_id = $1`, [pA])
})

await check('El paciente NO puede firmar su reseña con un nombre inventado', async () => {
  await expectRejected(
    as(pacienteA, `update public.reviews set author_display_name = 'Dr. Sánchez' where patient_id = $1`, [pA]),
    'calcula'
  )
})

await check('El nombre de un paciente NO se puede consultar por RPC', async () => {
  // `review_author_label` es SECURITY DEFINER y recibe un patient_id: si
  // PostgREST la publicara, sería un buscador de nombres por identificador.
  await expectRejected(
    asAnon(`select public.review_author_label($1, false)`, [pB]),
    'permission denied'
  )
})

// ========================================================= NOTIFICACIONES ===
console.log('\nNotificaciones')

// 15:00 UTC son las 09:00 en America/Mexico_City, la zona de la plataforma.
const cita2 = (await sys(
  `insert into public.appointments
     (patient_id, doctor_id, consulting_room_id, starts_at, ends_at, status, reason)
   values ($1, $2, $3, '2026-09-10 15:00+00', '2026-09-10 15:30+00', 'pending', 'Control')
   returning id`, [pA, d1, room1])).rows[0].id

await check('Al agendar, el médico recibe el aviso', async () => {
  const r = await as(medico1,
    `select title, notification_type from public.notifications
      where payload->>'appointment_id' = $1`, [cita2])
  assert(r.rows.length === 1, `Se esperaba 1 aviso y hay ${r.rows.length}`)
  assert(r.rows[0].notification_type === 'appointment_created', r.rows[0].notification_type)
})

await check('La hora del aviso es la local, no la UTC', async () => {
  // Este es el error que ya se coló tres veces en la agenda: PostgREST corre
  // con TimeZone = UTC, así que una cita de las 09:00 se anuncia a las 15:00
  // salvo que se lea la zona de la plataforma explícitamente.
  const r = await as(medico1,
    `select body from public.notifications where payload->>'appointment_id' = $1`, [cita2])
  const body = r.rows[0].body
  assert(body.includes('09:00'), `El aviso dice: "${body}"`)
  assert(!body.includes('15:00'), `El aviso usó la hora UTC: "${body}"`)
  assert(body.includes('jueves 10 de septiembre'), `Fecha mal formada: "${body}"`)
})

await check('El paciente NO recibe el aviso dirigido al médico', async () => {
  const r = await as(pacienteA,
    `select id from public.notifications where payload->>'appointment_id' = $1`, [cita2])
  assert(r.rows.length === 0, 'El paciente ve un aviso que no era suyo')
})

await check('Al confirmar, el aviso va al paciente', async () => {
  await sys(`update public.appointments set status = 'confirmed' where id = $1`, [cita2])
  const r = await as(pacienteA,
    `select notification_type from public.notifications
      where payload->>'appointment_id' = $1`, [cita2])
  assert(r.rows.length === 1, `Se esperaba 1 aviso y hay ${r.rows.length}`)
  assert(r.rows[0].notification_type === 'appointment_confirmed', r.rows[0].notification_type)
})

await check('Si cancela el médico, se avisa al paciente y no a quien canceló', async () => {
  await sys(`update public.appointments set status = 'cancelled_by_doctor',
             cancellation_reason = 'Urgencia hospitalaria' where id = $1`, [cita2])

  const paciente = await as(pacienteA,
    `select body from public.notifications
      where payload->>'appointment_id' = $1 and notification_type = 'appointment_cancelled'`, [cita2])
  assert(paciente.rows.length === 1, 'El paciente no fue avisado de la cancelación')
  assert(paciente.rows[0].body.includes('Urgencia hospitalaria'), 'No se le dijo el motivo')

  const medico = await as(medico1,
    `select id from public.notifications
      where payload->>'appointment_id' = $1 and notification_type = 'appointment_cancelled'`, [cita2])
  assert(medico.rows.length === 0, 'Se avisó de la cancelación a quien la hizo')
})

await check('El aviso de un mensaje NO copia el contenido del mensaje', async () => {
  const conv = (await sys(
    `insert into public.conversations (patient_id, doctor_id) values ($1, $2) returning id`,
    [pA, d1])).rows[0].id
  await as(pacienteA,
    `insert into public.messages (conversation_id, sender_id, body)
     values ($1, $2, 'Sigo con dolor en el pecho por las noches')`, [conv, pacienteA])

  const r = await as(medico1,
    `select body from public.notifications where notification_type = 'message_received'`)
  assert(r.rows.length === 1, 'El médico no fue avisado del mensaje')
  assert(
    !r.rows[0].body.includes('dolor'),
    'El síntoma viajó a la notificación, fuera del perímetro que protege el RLS de messages'
  )
})

await check('La reseña avisa al médico', async () => {
  const r = await as(medico1,
    `select notification_type from public.notifications where notification_type = 'review_received'`)
  assert(r.rows.length === 1, 'El médico no fue avisado de la reseña')
})

await check('Nadie puede fabricar una notificación para otra persona', async () => {
  await expectRejected(
    as(pacienteB,
      `insert into public.notifications (user_id, notification_type, title)
       values ($1, 'system', 'Su médico canceló la cita')`, [pacienteA]),
    'row-level security'
  )
})

await check('Marcar todas como leídas solo afecta a las propias', async () => {
  const antes = await as(medico1,
    `select count(*)::int as n from public.notifications where read_at is null`)
  await as(pacienteA, `select public.mark_all_notifications_read()`)

  const despues = await as(medico1,
    `select count(*)::int as n from public.notifications where read_at is null`)
  assert(
    despues.rows[0].n === antes.rows[0].n,
    `Se marcaron avisos ajenos: ${antes.rows[0].n} -> ${despues.rows[0].n}`
  )

  const propias = await as(pacienteA,
    `select count(*)::int as n from public.notifications where read_at is null`)
  assert(propias.rows[0].n === 0, `Quedaron ${propias.rows[0].n} sin leer`)
})

// ============================================================== MENSAJERÍA ==
console.log('\nIntegridad del chat')

const conv2 = (await sys(
  `insert into public.conversations (patient_id, doctor_id) values ($1, $2) returning id`,
  [pB, d1])).rows[0].id

const msgMedico = (await as(medico1,
  `insert into public.messages (conversation_id, sender_id, body)
   values ($1, $2, 'Suspenda el medicamento y nos vemos el martes.') returning id`,
  [conv2, medico1])).rows[0].id

await check('El paciente NO puede reescribir lo que dijo el médico', async () => {
  await expectRejected(
    as(pacienteB,
      `update public.messages set body = 'Siga tomando el medicamento.' where id = $1`,
      [msgMedico]),
    'no se puede modificar'
  )
})

await check('Ni siquiera el autor puede editar su mensaje ya enviado', async () => {
  await expectRejected(
    as(medico1, `update public.messages set body = 'Otra cosa' where id = $1`, [msgMedico]),
    'no se puede modificar'
  )
})

await check('El remitente NO puede sellar su propio mensaje como leído', async () => {
  await expectRejected(
    as(medico1, `update public.messages set read_at = now() where id = $1`, [msgMedico]),
    'quien recibe'
  )
})

await check('Quien recibe SÍ marca el mensaje como leído', async () => {
  await as(pacienteB, `select public.mark_conversation_read($1)`, [conv2])
  const r = await sys(`select read_at from public.messages where id = $1`, [msgMedico])
  assert(r.rows[0].read_at !== null, 'No se selló el acuse de lectura')
})

await check('Al abrir el hilo se pone a cero el propio contador, no el ajeno', async () => {
  const r = await sys(
    `select patient_unread_count, doctor_unread_count from public.conversations where id = $1`,
    [conv2])
  assert(r.rows[0].patient_unread_count === 0, 'El paciente sigue con no leídos')
  // El médico escribió, así que su propio contador nunca subió; lo que importa
  // es que la lectura del paciente no lo haya tocado.
  assert(r.rows[0].doctor_unread_count === 0, 'Se alteró el contador del médico')
})

await check('Un participante NO puede ocultar sus mensajes bajando los no leídos del otro', async () => {
  await as(pacienteB,
    `insert into public.messages (conversation_id, sender_id, body)
     values ($1, $2, 'De acuerdo, doctora.')`, [conv2, pacienteB])

  await expectRejected(
    as(pacienteB, `update public.conversations set doctor_unread_count = 0 where id = $1`, [conv2]),
    'la otra persona'
  )

  const r = await sys(`select doctor_unread_count from public.conversations where id = $1`, [conv2])
  assert(r.rows[0].doctor_unread_count === 1, `El médico ve ${r.rows[0].doctor_unread_count} sin leer`)
})

await check('Nadie puede falsear la vista previa del último mensaje', async () => {
  await expectRejected(
    as(pacienteB,
      `update public.conversations set last_message_preview = 'Le autorizo el alta' where id = $1`,
      [conv2]),
    'lo mantiene la base de datos'
  )
})

await check('Un tercero NO ve la conversación ajena', async () => {
  const r = await as(pacienteA, `select id from public.conversations where id = $1`, [conv2])
  assert(r.rows.length === 0, 'Una paciente ajena lee el hilo')
  const m = await as(pacienteA, `select id from public.messages where conversation_id = $1`, [conv2])
  assert(m.rows.length === 0, 'Una paciente ajena lee los mensajes')
})

await check('open_conversation devuelve el hilo existente en vez de duplicarlo', async () => {
  const primera = await as(pacienteB, `select public.open_conversation($1) as id`, [d1])
  assert(primera.rows[0].id === conv2, 'Creó un hilo nuevo teniendo uno abierto')

  const segunda = await as(pacienteB, `select public.open_conversation($1) as id`, [d1])
  assert(segunda.rows[0].id === conv2, 'La segunda llamada no fue idempotente')
})

// ================================================================= GASTOS ===
console.log('\nControl de gastos')

const catRenta = (await sys(
  `select id from public.expense_categories where slug = 'renta'`)).rows[0]?.id

await check('Los conceptos iniciales se sembraron con su slug', async () => {
  const r = await sys(`select count(*)::int as n from public.expense_categories where slug is not null`)
  assert(r.rows[0].n >= 10, `Solo hay ${r.rows[0].n} conceptos con slug`)
  assert(catRenta, 'No se generó el slug "renta"')
})

await check('El slug se calcula del nombre y no colisiona', async () => {
  await sys(`insert into public.expense_categories (name) values ('Insumos médicos X')`)
  await sys(`insert into public.expense_categories (name) values ('Insumos medicos X')`)
  const r = await sys(
    `select slug from public.expense_categories where name like 'Insumos m%dicos X' order by slug`)
  assert(r.rows.length === 2, `Se esperaban 2 filas y hay ${r.rows.length}`)
  assert(r.rows[0].slug !== r.rows[1].slug, 'Los dos conceptos comparten slug')
})

await sys(
  `insert into public.expenses (category_id, doctor_id, concept, amount_cents, incurred_on)
   values ($1, $2, 'Material de curación', 150000, '2026-08-01'),
          ($1, null, 'Renta del local', 2500000, '2026-08-01')`, [catRenta, d1])

await check('Un gasto sin médico es de la clínica, no un dato faltante', async () => {
  const r = await sys(
    `select doctor_nombre, total_cents from public.expense_summary(null, null)
      where doctor_id is null`)
  assert(r.rows.length === 1, 'No aparece el gasto general')
  assert(
    r.rows[0].doctor_nombre.includes('clínica'),
    `Se etiquetó como ${JSON.stringify(r.rows[0].doctor_nombre)}`
  )
})

await check('El resumen agrupa por médico y suma en centavos', async () => {
  const r = await sys(`select doctor_id, total_cents from public.expense_summary(null, null)`)
  const delMedico = r.rows.find((x) => x.doctor_id === d1)
  assert(delMedico, 'No aparece el gasto del médico')
  assert(Number(delMedico.total_cents) === 150000, `total = ${delMedico.total_cents}`)
})

await check('El filtro por fechas descarta lo que queda fuera', async () => {
  const r = await sys(`select count(*)::int as n from public.expense_summary('2026-09-01', null)`)
  assert(r.rows[0].n === 0, `Devolvió ${r.rows[0].n} grupos fuera del rango`)
})

await check('Un médico NO ve los gastos de la clínica', async () => {
  const r = await as(medico1, `select id from public.expenses`)
  assert(r.rows.length === 0, `Un médico lee ${r.rows.length} gastos`)
})

await check('Un médico NO ve ni los gastos que llevan su nombre', async () => {
  // Es información laboral: cuánto le cuesta a la clínica. Si algún día debe
  // verlos, será una policy nueva y una decisión de negocio.
  const r = await as(medico1, `select id from public.expenses where doctor_id = $1`, [d1])
  assert(r.rows.length === 0, 'El médico ve lo que la clínica gasta en él')
})

await check('Un paciente NO puede registrar gastos', async () => {
  await expectRejected(
    as(pacienteA,
      `insert into public.expenses (concept, amount_cents) values ('Inventado', 100)`),
    'row-level security'
  )
})

await check('El resumen no filtra a quien no puede leer la tabla', async () => {
  // La función es SECURITY INVOKER: si fuera DEFINER se convertiría en una
  // puerta trasera que devuelve justo lo que la policy niega.
  const r = await as(medico1, `select count(*)::int as n from public.expense_summary(null, null)`)
  assert(r.rows[0].n === 0, `Devolvió ${r.rows[0].n} grupos a un médico`)
})

await check('El administrador sí gestiona los gastos', async () => {
  const lectura = await as(admin, `select id from public.expenses`)
  assert(lectura.rows.length === 2, `El admin lee ${lectura.rows.length} gastos`)

  await as(admin,
    `insert into public.expenses (concept, amount_cents, doctor_id) values ('Luz', 90000, $1)`,
    [d1])
  const resumen = await as(admin,
    `select total_cents from public.expense_summary(null, null) where doctor_id = $1`, [d1])
  assert(Number(resumen.rows[0].total_cents) === 240000, `total = ${resumen.rows[0].total_cents}`)
})

await check('Un importe negativo se rechaza', async () => {
  await expectRejected(
    sys(`insert into public.expenses (concept, amount_cents) values ('Error', -500)`),
    'amount_non_negative'
  )
})

// ==================================================== DOCUMENTOS CLÍNICOS ===
console.log('\nReparto de documentos clínicos')

const docRuta = `${medico1}/estudio-sangre.pdf`
await sys(
  `insert into public.documents (patient_id, uploaded_by, doctor_id, title, storage_path, document_type)
   values ($1, $2, $3, 'Biometría hemática', $4, 'lab_result')`,
  [pA, medico1, d1, docRuta])

await check('El paciente ve el estudio que le subió su médico', async () => {
  const r = await as(pacienteA, `select title from public.documents where storage_path = $1`, [docRuta])
  assert(r.rows.length === 1, 'El paciente no ve su propio estudio')
})

await check('Un paciente ajeno NO ve el estudio', async () => {
  const r = await as(pacienteB, `select id from public.documents where storage_path = $1`, [docRuta])
  assert(r.rows.length === 0, 'Un paciente ajeno lee el estudio')
})

await check('Un médico sin cita con el paciente NO ve el estudio', async () => {
  const r = await as(medico2, `select id from public.documents where storage_path = $1`, [docRuta])
  assert(r.rows.length === 0, 'Un médico sin relación lee el estudio')
})

await check('Al ocultarlo, el paciente deja de verlo', async () => {
  await sys(`update public.documents set is_visible_to_patient = false where storage_path = $1`, [docRuta])
  const r = await as(pacienteA, `select id from public.documents where storage_path = $1`, [docRuta])
  assert(r.rows.length === 0, 'Sigue visible tras ocultarlo')
  await sys(`update public.documents set is_visible_to_patient = true where storage_path = $1`, [docRuta])
})

await check('Un médico solo lee SUS notas, no las de otro médico', async () => {
  // Un cardiólogo no tiene por qué leer lo que escribió el psiquiatra, aunque
  // ambos atiendan a la misma persona.
  await sys(
    `insert into public.medical_records (patient_id, doctor_id, diagnosis)
     values ($1, $2, 'Nota del segundo médico')`, [pA, d2])
  const r = await as(medico1, `select diagnosis from public.medical_records where patient_id = $1`, [pA])
  assert(
    !r.rows.some((x) => x.diagnosis === 'Nota del segundo médico'),
    'Un médico lee la nota clínica de otro'
  )
})

// ================================================== SECRETARIA / RECEPCIÓN ==
console.log('\nSecretaria y recepcionista')

const secre = (await sys(
  `insert into auth.users (email, raw_user_meta_data)
   values ('secre@test.mx', jsonb_build_object('role','patient','first_name','Secre','last_name','Prueba'))
   returning id`)).rows[0].id

await sys(
  `insert into public.user_roles (user_id, role_id)
   select $1, id from public.roles where key = 'secretary'`, [secre])

await check('El rol por sí solo NO da acceso a nada', async () => {
  // Antes de asignarla a ningún médico. Es la comprobación que demuestra que
  // el permiso cuelga de la asignación y no del rol.
  const r = await as(secre, `select id from public.appointments`)
  assert(r.rows.length === 0, `Una secretaria sin asignar ve ${r.rows.length} citas`)
})

await check('Solo el médico o un admin pueden asignar personal', async () => {
  await expectRejected(
    as(secre,
      `insert into public.staff_assignments (staff_user_id, doctor_id) values ($1, $2)`,
      [secre, d1]),
    'row-level security'
  )
})

await sys(
  `insert into public.staff_assignments
     (staff_user_id, doctor_id, can_manage_agenda, can_message, can_register_expenses)
   values ($1, $2, true, true, true)`, [secre, d1])

await check('Ya asignada, ve la agenda de SU médico', async () => {
  const r = await as(secre, `select id from public.appointments where doctor_id = $1`, [d1])
  assert(r.rows.length > 0, 'No ve ninguna cita del médico al que está asignada')
})

await check('NO ve la agenda de otro médico', async () => {
  // Por videollamada: el médico 2 no tiene consultorio dado de alta, y una
  // cita presencial exige uno.
  const otra = await sys(
    `insert into public.appointments (patient_id, doctor_id, starts_at, ends_at, status, modality)
     values ($1, $2, '2026-10-01 16:00+00', '2026-10-01 16:30+00', 'confirmed', 'video')
     returning id`,
    [pB, d2])
  const r = await as(secre, `select id from public.appointments where id = $1`, [otra.rows[0].id])
  assert(r.rows.length === 0, 'Ve la agenda de un médico para el que no trabaja')
})

await check('NO puede leer el expediente clínico', async () => {
  const notas = await as(secre, `select id from public.medical_records`)
  assert(notas.rows.length === 0, `Lee ${notas.rows.length} notas clínicas`)

  const docs = await as(secre, `select id from public.documents`)
  assert(docs.rows.length === 0, `Lee ${docs.rows.length} documentos`)
})

await check('NO puede leer alergias ni padecimientos por la tabla de pacientes', async () => {
  // Este es el motivo de que la agenda del personal vaya por función: nombre y
  // teléfono viven en las mismas tablas que las alergias, y el RLS decide qué
  // filas se ven, no qué columnas.
  const r = await as(secre, `select allergies, chronic_conditions from public.patients`)
  assert(r.rows.length === 0, `Lee el expediente de ${r.rows.length} pacientes`)
})

await check('La función de agenda le da nombre y teléfono, y nada más', async () => {
  const r = await as(secre, `select * from public.staff_agenda($1, null, null)`, [d1])
  assert(r.rows.length > 0, 'La función no devuelve nada')

  const columnas = Object.keys(r.rows[0])
  const prohibidas = columnas.filter((c) =>
    /allerg|chronic|diagnos|blood|birth|notes/i.test(c))
  assert(prohibidas.length === 0, `Expone columnas clínicas: ${prohibidas.join(', ')}`)
  assert(columnas.includes('paciente_nombre'), 'Falta el nombre del paciente')
  assert(columnas.includes('paciente_telefono'), 'Falta el teléfono')
})

await check('La función NO devuelve la agenda de un médico ajeno', async () => {
  // Pasarle otro id no sirve: la comprobación está dentro de la función.
  const r = await as(secre, `select * from public.staff_agenda($1, null, null)`, [d2])
  assert(r.rows.length === 0, 'Devolvió la agenda de un médico ajeno')
})

await check('Puede confirmar una cita de su médico', async () => {
  const cita = await sys(
    `insert into public.appointments
       (patient_id, doctor_id, consulting_room_id, starts_at, ends_at, status)
     values ($1, $2, $3, '2026-10-05 17:00+00', '2026-10-05 17:30+00', 'pending') returning id`,
    [pA, d1, room1])
  await as(secre, `update public.appointments set status = 'confirmed' where id = $1`,
    [cita.rows[0].id])
  const r = await sys(`select status from public.appointments where id = $1`, [cita.rows[0].id])
  assert(r.rows[0].status === 'confirmed', `Quedó en ${r.rows[0].status}`)
})

await check('Puede capturar un gasto pero NO ver los totales', async () => {
  await as(secre,
    `insert into public.expenses (concept, amount_cents, doctor_id)
     values ('Papelería', 45000, $1)`, [d1])

  const lectura = await as(secre, `select id from public.expenses`)
  assert(lectura.rows.length === 0, `Lee ${lectura.rows.length} gastos`)

  const resumen = await as(secre, `select count(*)::int as n from public.expense_summary(null, null)`)
  assert(resumen.rows[0].n === 0, 'Ve el resumen de gastos por médico')
})

await check('Al desactivar la asignación pierde el acceso', async () => {
  await sys(`update public.staff_assignments set is_active = false where staff_user_id = $1`, [secre])
  const r = await as(secre, `select id from public.appointments where doctor_id = $1`, [d1])
  assert(r.rows.length === 0, 'Sigue viendo la agenda tras desactivarla')
  await sys(`update public.staff_assignments set is_active = true where staff_user_id = $1`, [secre])
})

await check('Sin permiso de gastos, no puede capturarlos', async () => {
  await sys(
    `update public.staff_assignments set can_register_expenses = false where staff_user_id = $1`,
    [secre])
  await expectRejected(
    as(secre,
      `insert into public.expenses (concept, amount_cents, doctor_id) values ('Otro', 100, $1)`,
      [d1]),
    'row-level security'
  )
})

// ============================================================= AUDITORÍA ====
console.log('\nAuditoría y catálogos')

await check('Los cambios sensibles quedan registrados en audit_logs', async () => {
  const r = await sys(`select table_name, action from public.audit_logs
                       where table_name = 'doctors' and action = 'update' limit 1`)
  assert(r.rows.length === 1, 'No se registró la actualización de doctors')
})

await check('audit_logs solo lo leen los administradores', async () => {
  const admins = await as(admin, `select count(*)::int as n from public.audit_logs`)
  assert(admins.rows[0].n > 0, 'El administrador no ve la bitácora')
  const paciente = await as(pacienteA, `select count(*)::int as n from public.audit_logs`)
  assert(paciente.rows[0].n === 0, 'FUGA: un paciente leyó la bitácora')
})

await check('Están los 58 municipios de Zacatecas', async () => {
  // La plataforma se anuncia como estatal: si falta un municipio, un médico de
  // ahí no puede terminar el alta de su consultorio.
  const r = await sys(`select count(*)::int as n from public.municipalities`)
  assert(r.rows[0].n === 58, `Hay ${r.rows[0].n} municipios y deberían ser 58`)
})

await check('Ningún municipio comparte slug ni nombre', async () => {
  const r = await sys(`
    select count(*)::int as n from (
      select slug from public.municipalities group by slug having count(*) > 1
      union all
      select lower(name) from public.municipalities group by lower(name) having count(*) > 1
    ) d`)
  assert(r.rows[0].n === 0, `${r.rows[0].n} municipios duplicados`)
})

await check('Un anónimo lee los catálogos públicos', async () => {
  const r = await asAnon(`select count(*)::int as n from public.specialties`)
  assert(r.rows[0].n === 45, `Especialidades visibles: ${r.rows[0].n}`)
})

await check('Un anónimo NO puede leer ajustes privados', async () => {
  const r = await asAnon(`select key from public.settings where key = 'reviews.auto_publish'`)
  assert(r.rows.length === 0, 'FUGA: se leyó un ajuste privado sin sesión')
})

await check('Nadie puede auto-asignarse un rol de administrador', async () => {
  await expectRejected(
    as(pacienteB, `insert into public.user_roles (user_id, role_id)
                   select $1, id from public.roles where key = 'super_admin'`, [pacienteB])
  )
})

await check('El registro por Auth crea usuario y rol automáticamente', async () => {
  const u = await sys(
    `insert into auth.users (email, raw_user_meta_data)
     values ('nuevo@test.mx', '{"role":"super_admin","first_name":"Intruso"}'::jsonb)
     returning id`)
  const roles = await sys(
    `select r.key from public.user_roles ur join public.roles r on r.id = ur.role_id
     where ur.user_id = $1`, [u.rows[0].id])
  assert(roles.rows.length === 1, 'No se asignó rol al registrarse')
  assert(roles.rows[0].key === 'patient',
    `Escalada de privilegios: se concedió el rol ${roles.rows[0].key}`)
})

await check('El slug del médico se genera solo y sin colisiones', async () => {
  const r = await sys(`select slug from public.doctors order by created_at`)
  const slugs = r.rows.map((x) => x.slug)
  assert(slugs.every(Boolean), 'Algún médico quedó sin slug')
  assert(new Set(slugs).size === slugs.length, `Slugs duplicados: ${slugs}`)
})

// ================================================================ RESUMEN ===
console.log(`\n${'─'.repeat(64)}`)
console.log(`${pass} pruebas superadas, ${fail} fallidas`)
if (fail) {
  console.log('\nFallos:')
  failures.forEach((f) => console.log(`  · ${f.name}\n    ${f.message.split('\n')[0]}`))
}
await db.close()
process.exit(fail ? 1 : 0)
