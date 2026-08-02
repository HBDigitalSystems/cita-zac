// Ejecuta un archivo SQL contra la base de datos remota.
//
// Existe porque los scripts de `supabase/scripts/` NO son migraciones: son
// utilidades de desarrollo (sembrar datos, publicar un médico a mano, crear
// cuentas de prueba). Meterlos en `supabase/migrations/` los aplicaría también
// en producción, que es justo lo que no queremos.
//
// La contraseña se lee de la variable de entorno SUPABASE_DB_PASSWORD y nunca
// se imprime.
//
//   bun run supabase/run-sql.js scripts/cuentas-de-prueba.sql

import { SQL } from "bun";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const archivo = process.argv[2];
if (!archivo) {
  console.error("Uso: bun run supabase/run-sql.js <archivo.sql>");
  process.exit(1);
}

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error(
    "Falta SUPABASE_DB_PASSWORD.\n" +
      "Configúrala con: .\\configurar-supabase.ps1",
  );
  process.exit(1);
}

const PROJECT_REF = "pcbajtjfxpabkkufxjzj";
const url = `postgresql://postgres:${encodeURIComponent(password)}@db.${PROJECT_REF}.supabase.co:5432/postgres`;

const ruta = resolve(join(HERE, archivo));
const sql = await readFile(ruta, "utf8");

console.log(`Ejecutando ${archivo} contra ${PROJECT_REF}…\n`);

const db = new SQL(url);

try {
  // `.simple()` permite varias sentencias en una sola llamada, que es como
  // están escritos estos scripts.
  const resultado = await db.unsafe(sql).simple();

  // `.simple()` devuelve un resultado por sentencia. Solo interesa el último
  // SELECT, que es la comprobación con la que terminan estos scripts; el resto
  // son BEGIN/INSERT/UPDATE cuyo volcado tapaba lo importante.
  const bloques = Array.isArray(resultado) ? resultado : [resultado];
  const selects = bloques.filter(
    (b) => b?.command === "SELECT" && Array.isArray(b) === false && Object.keys(b).length > 4,
  );

  const ultimo = bloques.filter((b) => Array.isArray(b) && b.length > 0).at(-1);
  const comprobacion =
    ultimo ??
    selects.at(-1) ??
    // Bun devuelve las filas como propiedades numeradas del objeto de comando.
    bloques
      .filter((b) => b?.command === "SELECT")
      .map((b) => Object.keys(b).filter((k) => /^\d+$/.test(k)).map((k) => b[k]))
      .at(-1);

  if (Array.isArray(comprobacion) && comprobacion.length > 0) {
    console.table(comprobacion);
  }

  console.log("\nListo.");
} catch (error) {
  console.error("FALLÓ:");
  // El mensaje de Postgres puede incluir la cadena de conexión; se enmascara.
  console.error("  " + String(error.message).replaceAll(password, "***"));
  process.exit(1);
} finally {
  await db.close();
}
