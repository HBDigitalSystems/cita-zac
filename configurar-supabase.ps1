# =============================================================================
#  Configura el acceso de la CLI de Supabase
# =============================================================================
#  Ejecutar en una terminal de PowerShell, dentro de la carpeta del proyecto:
#
#      .\configurar-supabase.ps1
#
#  Te pedirá dos credenciales y las guardará como variables de entorno de tu
#  usuario de Windows. Quedan solo en tu equipo: ni en este archivo, ni en el
#  historial de PowerShell, ni en ningún chat.
#
#  Para borrarlas cuando ya no hagan falta:
#
#      .\configurar-supabase.ps1 -Borrar
# =============================================================================

param(
  [switch]$Borrar
)

$ErrorActionPreference = "Stop"

if ($Borrar) {
  [Environment]::SetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", $null, "User")
  [Environment]::SetEnvironmentVariable("SUPABASE_DB_PASSWORD", $null, "User")

  Write-Host ""
  Write-Host "  Credenciales borradas de este equipo." -ForegroundColor Green
  Write-Host ""
  Write-Host "  Recuerda: borrarla de aqui no la cambia en Supabase." -ForegroundColor Yellow
  Write-Host "  Para invalidarla de verdad, restablecela en" -ForegroundColor Yellow
  Write-Host "  Project Settings -> Database -> Reset database password" -ForegroundColor White
  Write-Host ""
  exit 0
}

Write-Host ""
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host "   Configuracion de acceso a Supabase" -ForegroundColor Cyan
Write-Host "  ===============================================" -ForegroundColor Cyan
Write-Host ""

# --- Contrasena de la base de datos ------------------------------------------
# Es la UNICA credencial necesaria. A proposito: un token personal de Supabase
# (sbp_) no se puede limitar a un proyecto — alcanza toda la cuenta y todos los
# demas proyectos. La contrasena de la base solo abre ESTA base de datos, asi
# que si se filtrara, el resto de proyectos siguen intactos.
Write-Host "  Contrasena de la base de datos" -ForegroundColor Yellow
Write-Host ""
Write-Host "  NO es la de tu cuenta de Supabase. Es la de la base de datos:" -ForegroundColor Gray
Write-Host "    Project Settings -> Database -> Reset database password" -ForegroundColor White
Write-Host ""
Write-Host "  Pegala con clic derecho. No se vera nada mientras pegas:" -ForegroundColor Gray
Write-Host "  eso es normal, las contrasenas se ocultan." -ForegroundColor Gray
Write-Host ""

$passSeguro = Read-Host "  Contrasena" -AsSecureString
$pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passSeguro)
)

if ([string]::IsNullOrWhiteSpace($pass)) {
  Write-Host ""
  Write-Host "  No escribiste nada. Cancelado." -ForegroundColor Red
  exit 1
}

# --- Guardar a nivel de usuario ----------------------------------------------
# "User" y no "Process": asi la heredan los procesos nuevos, que es lo que
# permite que Claude ejecute la CLI sin llegar a ver la credencial.
[Environment]::SetEnvironmentVariable("SUPABASE_DB_PASSWORD", $pass, "User")
$env:SUPABASE_DB_PASSWORD = $pass

# Si quedaba un token de la configuracion anterior, se retira: ya no se usa y
# tenerlo guardado solo amplia el alcance de un posible descuido.
[Environment]::SetEnvironmentVariable("SUPABASE_ACCESS_TOKEN", $null, "User")

Write-Host ""
Write-Host "  Guardada. Comprobando la conexion..." -ForegroundColor Gray
Write-Host ""

$exe = Join-Path $PSScriptRoot "node_modules\.bin\supabase.exe"
if (-not (Test-Path $exe)) {
  Write-Host "  No encuentro la CLI en node_modules. Ejecuta antes: bun install" -ForegroundColor Red
  exit 1
}

$enc = [uri]::EscapeDataString($pass)
$url = "postgresql://postgres:$enc@db.pcbajtjfxpabkkufxjzj.supabase.co:5432/postgres"

# PowerShell 5.1 envuelve la salida de error de un ejecutable en una excepcion,
# aunque el programa haya terminado bien. Con ErrorActionPreference en "Stop"
# eso abortaba el script justo antes de mostrar el resultado. Se relaja solo
# durante esta llamada.
$anterior = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$salida = (& $exe db push --db-url $url --dry-run 2>&1 | Out-String) -replace [regex]::Escape($enc), '***'
$ErrorActionPreference = $anterior

if ($salida -match "upToDate|Finished|up to date|DRY RUN") {
  Write-Host "  ===============================================" -ForegroundColor Green
  Write-Host "   TODO CORRECTO" -ForegroundColor Green
  Write-Host "   La base de DoctorCita_Zacatecas responde." -ForegroundColor Green
  Write-Host "  ===============================================" -ForegroundColor Green
  Write-Host ""
  Write-Host "  Esta credencial solo abre ESTA base de datos." -ForegroundColor Gray
  Write-Host "  Tus otros proyectos quedan fuera de su alcance." -ForegroundColor Gray
  Write-Host ""
  Write-Host "  Vuelve al chat y escribe: listo" -ForegroundColor White
} elseif ($salida -match "password authentication failed|SASL") {
  Write-Host "  La contrasena no es correcta." -ForegroundColor Red
  Write-Host "  Restablecela en Project Settings -> Database y reintenta." -ForegroundColor Red
} else {
  Write-Host "  Respuesta inesperada:" -ForegroundColor Yellow
  Write-Host ($salida.Trim()) -ForegroundColor Gray
  Write-Host ""
  Write-Host "  Copia eso y pegalo en el chat para que lo revisemos." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  Cuando terminemos, borra las credenciales con:" -ForegroundColor DarkGray
Write-Host "    .\configurar-supabase.ps1 -Borrar" -ForegroundColor DarkGray
Write-Host ""
