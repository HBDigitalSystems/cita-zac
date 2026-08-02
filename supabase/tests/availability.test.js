// Pruebas del cálculo de disponibilidad y de la reserva (PRD Fase 6).
//
// Lo que se comprueba aquí no se puede comprobar desde la interfaz: que la
// función devuelve huecos correctos, que descuenta lo ocupado sin filtrar datos
// ajenos, y que la base de datos rechaza una doble reserva aunque dos peticiones
// lleguen a la vez.

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = process.argv[2] ?? join(HERE, "..", "migrations");

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
`;

const db = await PGlite.create({
  extensions: { pg_trgm, citext, btree_gist, pgcrypto, unaccent },
});

await db.exec(STUBS);
for (const f of (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort()) {
  await db.exec(await readFile(join(MIGRATIONS, f), "utf8"));
}

let pass = 0,
  fail = 0;

async function check(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  PASA    ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FALLA   ${name}`);
    console.log(`          ${e.message.split("\n")[0]}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ------------------------------------------------------------------ montaje
console.log("\nMontando médico con agenda...\n");

const medicoUser = (
  await db.query(
    `insert into auth.users (email, raw_user_meta_data)
     values ('agenda@test.mx', '{"role":"doctor","first_name":"Ana","last_name":"Ruiz"}'::jsonb)
     returning id`,
  )
).rows[0].id;

const pacienteUser = (
  await db.query(
    `insert into auth.users (email, raw_user_meta_data)
     values ('paciente@test.mx', '{"role":"patient","first_name":"Luis","last_name":"Mora"}'::jsonb)
     returning id`,
  )
).rows[0].id;

const paciente = (
  await db.query(`insert into public.patients (user_id) values ($1) returning id`, [pacienteUser])
).rows[0].id;

const medico = (
  await db.query(
    `insert into public.doctors (user_id, license_number, primary_specialty_id, status)
     values ($1, 'AG123456', (select id from public.specialties where slug='cardiologia'), 'verified')
     returning id`,
    [medicoUser],
  )
).rows[0].id;

await db.query(`insert into public.doctor_profiles (doctor_id, biography) values ($1, 'Test')`, [
  medico,
]);

// Suscripción activa: sin ella el médico no es público y la función no devuelve nada.
await db.query(
  `insert into public.subscriptions (doctor_id, plan_id, status, current_period_end)
   values ($1, (select id from public.plans where key='basic'), 'active', now() + interval '30 days')`,
  [medico],
);

const consultorio = (
  await db.query(
    `insert into public.consulting_rooms
       (doctor_id, name, municipality_id, address, is_primary, slot_duration_minutes)
     values ($1, 'Principal', 1, 'Av. Hidalgo 1', true, 30)
     returning id`,
    [medico],
  )
).rows[0].id;

// Agenda: todos los días de la semana, de 09:00 a 12:00 → 6 huecos de 30 min.
for (let weekday = 0; weekday <= 6; weekday++) {
  await db.query(
    `insert into public.working_hours (consulting_room_id, weekday, start_time, end_time)
     values ($1, $2, '09:00', '12:00')`,
    [consultorio, weekday],
  );
}

// Se parte de mañana para esquivar la antelación mínima de 2 horas.
const manana = new Date();
manana.setDate(manana.getDate() + 1);
const desde = manana.toISOString().slice(0, 10);

console.log("Ejecutando pruebas.\n");

let primerHueco;

await check("Devuelve 6 huecos de 30 min para una jornada de 09:00 a 12:00", async () => {
  const r = await db.query(`select * from public.get_available_slots($1, $2, $3::date, 1)`, [
    medico,
    consultorio,
    desde,
  ]);
  assert(r.rows.length === 6, `Devolvió ${r.rows.length} huecos, se esperaban 6`);
  primerHueco = r.rows[0];
});

await check("Los huecos caen en el horario configurado, no desplazados por la zona", async () => {
  // Esta comprobación nace de un fallo real: la primera versión construía los
  // huecos con ::timestamptz, que interpreta la hora en la zona del SERVIDOR
  // (UTC en Supabase). Un consultorio de 09:00 a 12:00 en Zacatecas acababa
  // ofreciendo citas de 03:00 a 06:00. Contar huecos no lo detectaba: salían
  // seis igual. Hay que mirar la hora local.
  const r = await db.query(
    `select to_char(slot_start at time zone
              coalesce((select value #>> '{}' from public.settings where key='platform.timezone'),
                       'America/Mexico_City'), 'HH24:MI') as hora_local
       from public.get_available_slots($1, $2, $3::date, 1)
      order by slot_start`,
    [medico, consultorio, desde],
  );

  const horas = r.rows.map((x) => x.hora_local);
  assert(horas[0] === "09:00", `El primer hueco es a las ${horas[0]}, se esperaba 09:00`);
  assert(
    horas[horas.length - 1] === "11:30",
    `El último hueco es a las ${horas[horas.length - 1]}, se esperaba 11:30`,
  );
  assert(
    horas.every((h) => h >= "09:00" && h < "12:00"),
    `Hay huecos fuera del horario 09:00-12:00: ${horas.join(", ")}`,
  );
});

await check("Los huecos son consecutivos y de la duración configurada", async () => {
  const r = await db.query(`select * from public.get_available_slots($1, $2, $3::date, 1)`, [
    medico,
    consultorio,
    desde,
  ]);
  const dur = (new Date(r.rows[0].slot_end) - new Date(r.rows[0].slot_start)) / 60000;
  const gap = (new Date(r.rows[1].slot_start) - new Date(r.rows[0].slot_start)) / 60000;
  assert(dur === 30, `Duración ${dur} min, se esperaban 30`);
  assert(gap === 30, `Separación ${gap} min, se esperaban 30`);
});

await check("Al reservar un hueco, desaparece de la disponibilidad", async () => {
  await db.query(
    `insert into public.appointments (patient_id, doctor_id, consulting_room_id, starts_at, ends_at, status)
     values ($1, $2, $3, $4, $5, 'confirmed')`,
    [paciente, medico, consultorio, primerHueco.slot_start, primerHueco.slot_end],
  );

  const r = await db.query(`select * from public.get_available_slots($1, $2, $3::date, 1)`, [
    medico,
    consultorio,
    desde,
  ]);
  assert(r.rows.length === 5, `Quedan ${r.rows.length} huecos, se esperaban 5`);
  assert(
    !r.rows.some((row) => new Date(row.slot_start).getTime() === new Date(primerHueco.slot_start).getTime()),
    "El hueco reservado sigue ofreciéndose",
  );
});

await check("Cancelar la cita devuelve el hueco a la disponibilidad", async () => {
  await db.query(`update public.appointments set status = 'cancelled_by_patient'`);
  const r = await db.query(`select * from public.get_available_slots($1, $2, $3::date, 1)`, [
    medico,
    consultorio,
    desde,
  ]);
  assert(r.rows.length === 6, `Quedan ${r.rows.length}, se esperaban 6 tras cancelar`);
  // Se rehace la reserva para el resto de pruebas.
  await db.query(`delete from public.appointments`);
});

await check("Unas vacaciones vacían el día entero", async () => {
  await db.query(
    `insert into public.availability_exceptions (doctor_id, exception_type, starts_at, ends_at, reason)
     values ($1, 'vacation', $2::date, $2::date + interval '1 day', 'Congreso')`,
    [medico, desde],
  );
  const r = await db.query(`select * from public.get_available_slots($1, $2, $3::date, 1)`, [
    medico,
    consultorio,
    desde,
  ]);
  assert(r.rows.length === 0, `Devolvió ${r.rows.length} huecos durante unas vacaciones`);
  await db.query(`delete from public.availability_exceptions`);
});

await check("Un médico sin suscripción no expone su agenda", async () => {
  await db.query(`update public.subscriptions set status = 'cancelled' where doctor_id = $1`, [
    medico,
  ]);
  const r = await db.query(`select * from public.get_available_slots($1, $2, $3::date, 1)`, [
    medico,
    consultorio,
    desde,
  ]);
  assert(r.rows.length === 0, "Se filtró la agenda de un médico no publicado");
  await db.query(`update public.subscriptions set status = 'active' where doctor_id = $1`, [medico]);
});

await check("La base de datos rechaza reservar dos veces el mismo hueco", async () => {
  const r = await db.query(`select * from public.get_available_slots($1, $2, $3::date, 1)`, [
    medico,
    consultorio,
    desde,
  ]);
  const hueco = r.rows[0];

  await db.query(
    `insert into public.appointments (patient_id, doctor_id, consulting_room_id, starts_at, ends_at, status)
     values ($1, $2, $3, $4, $5, 'confirmed')`,
    [paciente, medico, consultorio, hueco.slot_start, hueco.slot_end],
  );

  let rechazada = false;
  try {
    await db.query(
      `insert into public.appointments (patient_id, doctor_id, consulting_room_id, starts_at, ends_at, status)
       values ($1, $2, $3, $4, $5, 'pending')`,
      [paciente, medico, consultorio, hueco.slot_start, hueco.slot_end],
    );
  } catch (e) {
    rechazada = e.message.includes("appointments_no_double_booking");
  }
  assert(rechazada, "Se aceptó una segunda reserva sobre el mismo hueco");
  await db.query(`delete from public.appointments`);
});

await check("No ofrece huecos que ya pasaron ni sin la antelación mínima", async () => {
  const hoy = new Date().toISOString().slice(0, 10);
  const r = await db.query(`select * from public.get_available_slots($1, $2, $3::date, 1)`, [
    medico,
    consultorio,
    hoy,
  ]);
  const ahora = Date.now();
  assert(
    r.rows.every((row) => new Date(row.slot_start).getTime() > ahora),
    "Ofreció un hueco en el pasado",
  );
});

console.log(`\n${"─".repeat(64)}`);
console.log(`${pass} pruebas superadas, ${fail} fallidas`);
await db.close();
process.exit(fail ? 1 : 0);
