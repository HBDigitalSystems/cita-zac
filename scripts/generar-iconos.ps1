# =============================================================================
# Genera los iconos del sitio a partir de public/logo.png
# =============================================================================
# Todo lo que sea un icono sale de aqui, para no recortar a mano ni tener que
# recordar que tamanos hacian falta:
#
#   public/icono.png       512 px       · manifiesto de Android e icono de iOS
#   public/icono-108.png   108 px       · usos pequenos dentro de la interfaz
#   public/favicon.ico     16/32/48/256 · pestana del navegador y accesos directos
#
# El logotipo NO se recorta: se encaja entero y centrado dentro del cuadrado,
# sobre fondo blanco. Es una decision del cliente — quiere su marca completa,
# con el nombre y la linea de abajo, tambien en el icono.
#
# A cambio, en la pestana del navegador (16 px) el texto del logotipo no se
# distingue; lo que se reconoce es el simbolo verde. Si algun dia se prefiere
# un icono legible a ese tamano, la alternativa es usar solo el cuadrado con
# el estetoscopio y la palomita.
#
# Usa System.Drawing, que ya viene en Windows: no anade dependencias.
#
#   .\scripts\generar-iconos.ps1
# =============================================================================

param(
  [string]$Origen = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$raiz = Split-Path $PSScriptRoot -Parent
$publico = Join-Path $raiz "public"
if (-not $Origen) { $Origen = Join-Path $publico "logo.png" }

$logo = [System.Drawing.Image]::FromFile((Resolve-Path $Origen))
Write-Output "Origen: $Origen ($($logo.Width) x $($logo.Height))"

# Encaja el logotipo completo dentro de un cuadrado, centrado y sin deformar.
function Cuadrar($img, [int]$lado) {
  $bmp = New-Object System.Drawing.Bitmap $lado, $lado
  $g = [System.Drawing.Graphics]::FromImage($bmp)

  # Fondo blanco y no transparente: iOS no respeta la transparencia en el icono
  # de la pantalla de inicio y pondria negro detras.
  $g.Clear([System.Drawing.Color]::White)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

  $escala = [Math]::Min($lado / $img.Width, $lado / $img.Height)
  $w = [int]($img.Width * $escala)
  $h = [int]($img.Height * $escala)
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle ([int](($lado - $w) / 2)), ([int](($lado - $h) / 2)), $w, $h))
  $g.Dispose()
  return $bmp
}

foreach ($par in @(@(512, "icono.png"), @(108, "icono-108.png"))) {
  $bmp = Cuadrar $logo $par[0]
  $bmp.Save((Join-Path $publico $par[1]), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "  $($par[1]) ($($par[0]) px)"
}

# --- El ICO -----------------------------------------------------------------
# Se escribe el contenedor a mano porque Icon.Save de .NET guarda un solo
# tamano, y a 16 px un mapa de bits preparado para ese tamano se ve mejor que
# un reescalado del navegador. Desde Vista un ICO admite PNG dentro tal cual,
# asi que no hace falta codificar BMP ni la mascara AND heredada.
$tamanos = @(16, 32, 48, 256)
$imagenes = @()
foreach ($lado in $tamanos) {
  $bmp = Cuadrar $logo $lado
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $imagenes += , @{ lado = $lado; bytes = $ms.ToArray() }
  $ms.Dispose(); $bmp.Dispose()
}

$salida = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $salida
$w.Write([UInt16]0)                 # reservado
$w.Write([UInt16]1)                 # tipo: 1 = icono
$w.Write([UInt16]$imagenes.Count)

$desplazamiento = 6 + (16 * $imagenes.Count)
foreach ($im in $imagenes) {
  # El ancho ocupa un solo byte, asi que 256 no cabe: 0 significa 256.
  $medida = if ($im.lado -ge 256) { 0 } else { $im.lado }
  $w.Write([Byte]$medida); $w.Write([Byte]$medida)
  $w.Write([Byte]0); $w.Write([Byte]0)
  $w.Write([UInt16]1); $w.Write([UInt16]32)
  $w.Write([UInt32]$im.bytes.Length)
  $w.Write([UInt32]$desplazamiento)
  $desplazamiento += $im.bytes.Length
}
foreach ($im in $imagenes) { $w.Write($im.bytes) }
$w.Flush()

[System.IO.File]::WriteAllBytes((Join-Path $publico "favicon.ico"), $salida.ToArray())
$w.Dispose(); $salida.Dispose(); $logo.Dispose()

Write-Output "  favicon.ico ($($tamanos -join ', ') px)"
Write-Output "`nListo."
