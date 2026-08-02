// Banco de pruebas de las migraciones de DoctorCita sobre PGlite (Postgres WASM).
// Sustituye a `supabase db start` mientras Docker no funcione: valida DDL,
// cuerpos de funciones, constraints, tipos e índices. NO valida el
// comportamiento del RLS en tiempo de ejecución — eso exige sesiones reales.

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

// Andamiaje: todo lo que Supabase da por hecho y PGlite no trae.
const SUPABASE_STUBS = `
  create role anon;
  create role authenticated;
  create role service_role;

  create schema if not exists auth;
  create schema if not exists storage;
  create schema if not exists extensions;

  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    phone text,
    raw_user_meta_data jsonb default '{}'::jsonb,
    created_at timestamptz default now()
  );

  -- En Supabase lee el JWT de la petición. Aquí lo simulamos con una variable
  -- de sesión para poder probar las policies más adelante.
  create or replace function auth.uid() returns uuid
  language sql stable as $fn$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
  $fn$;

  create or replace function auth.role() returns text
  language sql stable as $fn$
    select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
  $fn$;

  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[],
    created_at timestamptz default now()
  );

  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id),
    name text,
    owner uuid,
    created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;

  create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $fn$
    select string_to_array(name, '/');
  $fn$;

  create publication supabase_realtime;
`

const db = await PGlite.create({
  extensions: { pg_trgm, citext, btree_gist, pgcrypto, unaccent },
})

console.log('Postgres:', (await db.query('select version()')).rows[0].version.split(',')[0])
console.log()

try {
  await db.exec(SUPABASE_STUBS)
  console.log('  andamiaje de Supabase listo (auth, storage, roles, publication)\n')
} catch (e) {
  console.error('FALLO EN EL ANDAMIAJE:', e.message)
  process.exit(1)
}

const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort()

let failed = 0
for (const file of files) {
  const sql = await readFile(join(MIGRATIONS, file), 'utf8')
  const label = file.replace(/^\d+_/, '')
  try {
    await db.exec(sql)
    console.log(`  OK    ${label}`)
  } catch (e) {
    failed++
    console.log(`  FALLO ${label}`)
    console.log(`        ${e.message.split('\n').join('\n        ')}`)
    if (e.hint) console.log(`        HINT: ${e.hint}`)
  }
}

console.log()
if (failed) {
  console.log(`${failed} de ${files.length} migraciones fallaron.`)
  process.exit(1)
}

// Inventario final: confirma que se creó lo que se esperaba.
const counts = await db.query(`
  select
    (select count(*) from pg_tables where schemaname = 'public')                          as tablas,
    (select count(*) from pg_policies where schemaname = 'public')                        as policies,
    (select count(*) from pg_trigger where not tgisinternal)                              as triggers,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public')                                                         as funciones,
    (select count(*) from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typtype = 'e')                                     as enums,
    (select count(*) from pg_indexes where schemaname = 'public')                          as indices,
    (select count(*) from storage.buckets)                                                as buckets
`)
console.log('Las', files.length, 'migraciones se aplicaron sin error.\n')
console.table(counts.rows[0])

// Comprobación de que los catálogos quedaron sembrados.
const seeds = await db.query(`
  select 'municipios' as catalogo, count(*)::int from public.municipalities
  union all select 'especialidades',   count(*)::int from public.specialties
  union all select 'subespecialidades',count(*)::int from public.subspecialties
  union all select 'aseguradoras',     count(*)::int from public.insurance_companies
  union all select 'idiomas',          count(*)::int from public.languages
  union all select 'roles',            count(*)::int from public.roles
  union all select 'planes',           count(*)::int from public.plans
  union all select 'ajustes',          count(*)::int from public.settings
`)
console.table(seeds.rows)

await db.close()
