// Genera src/integrations/supabase/types.ts introspeccionando el esquema.
//
// Sustituye a `supabase gen types`, que en este equipo no funciona porque
// necesita Docker para su contenedor postgres-meta. La salida imita el formato
// oficial de Supabase (Database → public → Tables → Row/Insert/Update, Enums)
// para que sea reemplazable el día que Docker funcione.
//
//   bun run supabase/tests/gen-types.js

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, "..", "migrations");
const OUT = join(HERE, "..", "..", "src", "integrations", "supabase", "types.ts");

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

// Correspondencia tipo Postgres → tipo TypeScript.
function tsType(dataType, udtName, enums) {
  if (dataType === "ARRAY") {
    const inner = udtName.replace(/^_/, "");
    return `${tsType(baseTypeOf(inner), inner, enums)}[]`;
  }
  if (dataType === "USER-DEFINED") {
    if (enums.has(udtName)) return `Database["public"]["Enums"]["${udtName}"]`;
    return "unknown";
  }
  return baseToTs(dataType, udtName);
}

function baseTypeOf(udt) {
  const map = {
    int2: "smallint",
    int4: "integer",
    int8: "bigint",
    float4: "real",
    float8: "double precision",
    numeric: "numeric",
    bool: "boolean",
    text: "text",
    varchar: "character varying",
    bpchar: "character",
    uuid: "uuid",
    json: "json",
    jsonb: "jsonb",
    date: "date",
    time: "time",
    timestamp: "timestamp",
    timestamptz: "timestamptz",
    inet: "inet",
    citext: "text",
  };
  return map[udt] ?? udt;
}

function baseToTs(dataType, udtName) {
  const t = dataType.toLowerCase();
  if (["smallint", "integer", "bigint", "numeric", "real", "double precision"].includes(t)) {
    // bigint y numeric llegan como string desde postgres-js en cantidades
    // grandes, pero Supabase los tipa como number. Se mantiene la convención.
    return "number";
  }
  if (t === "boolean") return "boolean";
  if (t === "json" || t === "jsonb") return "Json";
  if (udtName === "citext") return "string";
  return "string";
}

const db = await PGlite.create({
  extensions: { pg_trgm, citext, btree_gist, pgcrypto, unaccent },
});

await db.exec(STUBS);
for (const f of (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort()) {
  await db.exec(await readFile(join(MIGRATIONS, f), "utf8"));
}

// ---------------------------------------------------------------- funciones
// Las funciones de PostgreSQL son invocables con supabase.rpc(), así que sus
// firmas tienen que estar en los tipos o cada llamada falla al compilar.
// Se excluyen las que devuelven `trigger`: no se llaman nunca desde el cliente.
// Se descartan dos familias:
//   · las que devuelven `trigger`, que nunca se llaman desde el cliente;
//   · las constructoras que PostgreSQL crea automáticamente al declarar un tipo
//     rango (public.timerange genera timerange(), timemultirange()…). Vienen
//     sobrecargadas y producirían claves repetidas en el objeto de tipos.
const functionRows = (
  await db.query(`
  select
    p.proname                        as name,
    pg_get_function_arguments(p.oid) as args,
    pg_get_function_result(p.oid)    as result
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and pg_get_function_result(p.oid) <> 'trigger'
    and p.proname not in (
      select t.typname from pg_type t
      join pg_namespace tn on tn.oid = t.typnamespace
      where tn.nspname = 'public'
    )
    and p.proname not like 'timemultirange%'
  order by p.proname
`)
).rows;

// Una función sobrecargada aparecería varias veces con el mismo nombre; el
// objeto de tipos solo admite una clave, así que se queda la primera firma.
const seenFunctionNames = new Set();
const uniqueFunctions = functionRows.filter((fn) => {
  if (seenFunctionNames.has(fn.name)) return false;
  seenFunctionNames.add(fn.name);
  return true;
});

/** "p_doctor_id uuid, p_days integer DEFAULT 14" → [{name, type, optional}] */
function parseArgs(signature) {
  if (!signature.trim()) return [];
  return signature.split(",").map((chunk) => {
    const text = chunk.trim();
    const optional = / DEFAULT /i.test(text);
    const withoutDefault = text.split(/ DEFAULT /i)[0].trim();
    const parts = withoutDefault.split(/\s+/);
    const name = parts.shift() ?? "";
    return { name, type: parts.join(" "), optional };
  });
}

/** "TABLE(a timestamptz, b integer)" → objeto; "SETOF x" → array. */
function parseResult(result) {
  const table = result.match(/^TABLE\((.*)\)$/is);
  if (table) {
    const columns = table[1].split(",").map((chunk) => {
      const parts = chunk.trim().split(/\s+/);
      const name = parts.shift() ?? "";
      return `        ${name}: ${baseToTs(parts.join(" "), parts.join(" "))}`;
    });
    return `{\n${columns.join("\n")}\n      }[]`;
  }

  const setof = result.match(/^SETOF\s+(.+)$/i);
  const scalar = setof ? setof[1] : result;
  const ts = baseToTs(scalar, scalar);
  return setof ? `${ts}[]` : ts;
}

// -------------------------------------------------------------------- enums
const enumRows = (
  await db.query(`
  select t.typname as name, e.enumlabel as label
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
  order by t.typname, e.enumsortorder
`)
).rows;

const enums = new Map();
for (const r of enumRows) {
  if (!enums.has(r.name)) enums.set(r.name, []);
  enums.get(r.name).push(r.label);
}

// ------------------------------------------------------------------- tablas
const columns = (
  await db.query(`
  select
    c.table_name,
    c.column_name,
    c.data_type,
    c.udt_name,
    c.is_nullable = 'YES'                                  as nullable,
    c.column_default is not null                           as has_default,
    c.is_identity = 'YES'                                  as is_identity,
    c.is_generated = 'ALWAYS'                              as is_generated,
    c.ordinal_position
  from information_schema.columns c
  join information_schema.tables t
    on t.table_name = c.table_name and t.table_schema = c.table_schema
  where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
  order by c.table_name, c.ordinal_position
`)
).rows;

// ----------------------------------------------------- claves foráneas (FK)
const fks = (
  await db.query(`
  select
    tc.table_name       as source_table,
    kcu.column_name     as source_column,
    ccu.table_name      as target_table,
    ccu.column_name     as target_column,
    tc.constraint_name
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
  join information_schema.constraint_column_usage ccu
    on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
  where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
  order by tc.table_name, kcu.column_name
`)
).rows;

const byTable = new Map();
for (const c of columns) {
  if (!byTable.has(c.table_name)) byTable.set(c.table_name, []);
  byTable.get(c.table_name).push(c);
}

const enumNames = new Set(enums.keys());

// Columnas NOT NULL sin DEFAULT que en realidad rellena un trigger BEFORE
// INSERT. La introspección no puede saberlo —el trigger es código— así que se
// declaran aquí para que el tipo Insert no las exija.
const TRIGGER_FILLED = new Set([
  "doctors.slug", // generate_doctor_slug()
  "appointments.reference", // generate_appointment_reference()
  "prescriptions.folio", // generate_prescription_folio()
  "invoices.folio", // generate_invoice_folio()
]);

function renderTable(table, cols) {
  const rowLines = cols.map((c) => {
    const t = tsType(c.data_type, c.udt_name, enumNames);
    return `          ${c.column_name}: ${t}${c.nullable ? " | null" : ""}`;
  });

  const insertLines = cols
    .map((c) => {
      const t = tsType(c.data_type, c.udt_name, enumNames);
      // Generadas siempre: no se pueden insertar.
      if (c.is_generated) return null;
      // Opcional si admite null, tiene default, es identity o la llena un trigger.
      const optional =
        c.nullable ||
        c.has_default ||
        c.is_identity ||
        TRIGGER_FILLED.has(`${table}.${c.column_name}`);
      return `          ${c.column_name}${optional ? "?" : ""}: ${t}${c.nullable ? " | null" : ""}`;
    })
    .filter(Boolean);

  const updateLines = cols
    .map((c) => {
      if (c.is_generated) return null;
      const t = tsType(c.data_type, c.udt_name, enumNames);
      return `          ${c.column_name}?: ${t}${c.nullable ? " | null" : ""}`;
    })
    .filter(Boolean);

  const rels = fks
    .filter((f) => f.source_table === table)
    .map(
      (f) => `          {
            foreignKeyName: "${f.constraint_name}"
            columns: ["${f.source_column}"]
            referencedRelation: "${f.target_table}"
            referencedColumns: ["${f.target_column}"]
          }`,
    );

  return `      ${table}: {
        Row: {
${rowLines.join("\n")}
        }
        Insert: {
${insertLines.join("\n")}
        }
        Update: {
${updateLines.join("\n")}
        }
        Relationships: [${rels.length ? "\n" + rels.join(",\n") + "\n        " : ""}]
      }`;
}

const tableBlocks = [...byTable.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([table, cols]) => renderTable(table, cols));

const functionBlocks = uniqueFunctions.map((fn) => {
  const args = parseArgs(fn.args);
  const argLines = args.length
    ? args
        .map((a) => `          ${a.name}${a.optional ? "?" : ""}: ${baseToTs(a.type, a.type)}`)
        .join("\n")
    : "          [_ in never]: never";

  return `      ${fn.name}: {
        Args: {
${argLines}
        }
        Returns: ${parseResult(fn.result)}
      }`;
});

const enumBlocks = [...enums.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, labels]) => `      ${name}: ${labels.map((l) => `"${l}"`).join(" | ")}`);

const out = `// GENERADO AUTOMÁTICAMENTE — no editar a mano.
// Fuente: supabase/migrations/*.sql
// Regenerar con: bun run db:types
//
// Se genera introspeccionando el esquema con PGlite en lugar de
// \`supabase gen types\`, que necesita Docker. El formato imita al oficial para
// poder cambiar de generador sin tocar el código que lo consume.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
${tableBlocks.join("\n")}
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
${functionBlocks.join("\n")}
    }
    Enums: {
${enumBlocks.join("\n")}
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type PublicSchema = Database["public"]

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"]

export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"]

export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"]

export type Enums<T extends keyof PublicSchema["Enums"]> =
  PublicSchema["Enums"][T]
`;

await writeFile(OUT, out, "utf8");
console.log(`Escrito ${OUT}`);
console.log(`  ${byTable.size} tablas, ${enums.size} enums, ${fks.length} claves foráneas`);
await db.close();
