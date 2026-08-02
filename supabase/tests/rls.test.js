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
