// Levanta un Postgres efímero (PGlite) con todas las migraciones aplicadas y lo
// expone por TCP, para que herramientas que hablan el protocolo de Postgres
// puedan conectarse. Se usa sobre todo para `supabase gen types --db-url`.
//
// Existe porque Docker no funciona en este equipo y `supabase db start` no es
// una opción. Uso:
//   bun run supabase/tests/serve.js [puerto]

import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { citext } from '@electric-sql/pglite/contrib/citext'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { unaccent } from '@electric-sql/pglite/contrib/unaccent'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS = join(HERE, '..', 'migrations')
const PORT = Number(process.argv[2] ?? 5433)

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
for (const f of (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(await readFile(join(MIGRATIONS, f), 'utf8'))
}

const server = new PGLiteSocketServer({ db, port: PORT, host: '127.0.0.1' })
await server.start()

console.log(`Postgres efímero escuchando en 127.0.0.1:${PORT}`)
console.log(`  postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`)
console.log('Ctrl+C para detener.')

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await server.stop()
    await db.close()
    process.exit(0)
  })
}
