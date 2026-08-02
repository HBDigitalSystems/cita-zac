// Junta las migraciones en un solo archivo para pegarlo en el editor SQL de
// Supabase.
//
// Es la vía sin credenciales: `supabase db push` necesita la contraseña de la
// base de datos, y no hace falta compartirla con nadie para arrancar. El
// inconveniente es que Supabase no registra estas migraciones en su historial;
// si más adelante se usa `db push`, hay que marcarlas como aplicadas con
// `supabase migration repair --status applied <version>`.
//
//   bun run db:bundle

import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, "migrations");
const OUT = join(HERE, "migrations-bundle.sql");

const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort();

const parts = [
  "-- =============================================================================",
  "-- DoctorCita · Fase 1 · Todas las migraciones en un solo archivo",
  "-- =============================================================================",
  "-- GENERADO AUTOMÁTICAMENTE con `bun run db:bundle`. No editar a mano.",
  "--",
  "-- Cómo aplicarlo:",
  "--   1. Panel de Supabase → SQL Editor → New query",
  "--   2. Pegar TODO este archivo",
  "--   3. Run",
  "--",
  "-- Se ejecuta dentro de una transacción: si algo falla, no queda nada a medias.",
  "-- =============================================================================",
  "",
  "begin;",
  "",
];

for (const file of files) {
  const sql = await readFile(join(MIGRATIONS, file), "utf8");
  parts.push(
    "",
    `-- ${"─".repeat(74)}`,
    `-- ${file}`,
    `-- ${"─".repeat(74)}`,
    "",
    sql.trim(),
    "",
  );
}

parts.push("", "commit;", "");

await writeFile(OUT, parts.join("\n"), "utf8");

const lines = parts.join("\n").split("\n").length;
console.log(`Escrito ${OUT}`);
console.log(`  ${files.length} migraciones · ${lines} líneas`);
