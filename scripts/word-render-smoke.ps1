param(
  [string]$DocxPath = "..\outputs\ich_kano_entropy\prod-research-smoke.docx",
  [string]$OutputDir = "..\outputs\ich_kano_entropy\word-render-smoke"
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath([string]$PathValue) {
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return [System.IO.Path]::GetFullPath($PathValue)
  }
  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $PathValue))
}

$docx = Resolve-FullPath $DocxPath
$outDir = Resolve-FullPath $OutputDir
$pdf = Join-Path $outDir "word-render-smoke.pdf"
$pngPrefix = Join-Path $outDir "page"
$checkScript = Join-Path $outDir "check_word_render.py"

if (!(Test-Path $docx)) {
  throw "DOCX not found: $docx"
}

New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue $pdf
Get-ChildItem -Path $outDir -Filter "page-*.png" -ErrorAction SilentlyContinue | Remove-Item -Force

$beforeWordIds = @(Get-CimInstance Win32_Process -Filter "name='WINWORD.EXE'" -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessId })
$wordJob = Start-Job -ScriptBlock {
  param([string]$DocxFile, [string]$PdfFile)
  $ErrorActionPreference = "Stop"
  $word = $null
  $document = $null
  try {
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    try { $word.AutomationSecurity = 3 } catch {}
    $document = $word.Documents.OpenNoRepairDialog($DocxFile, $false, $true, $false)
    $pages = $document.ComputeStatistics(2)
    $document.ExportAsFixedFormat($PdfFile, 17)
    $document.Close($false)
    $document = $null
    $word.Quit()
    $word = $null
    [pscustomobject]@{ pageCount = $pages }
  } finally {
    if ($document -ne $null) {
      try { $document.Close($false) } catch {}
    }
    if ($word -ne $null) {
      try { $word.Quit() } catch {}
    }
  }
} -ArgumentList $docx, $pdf

if (!(Wait-Job $wordJob -Timeout 120)) {
  Stop-Job $wordJob -ErrorAction SilentlyContinue
  Remove-Job $wordJob -Force -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "name='WINWORD.EXE'" -ErrorAction SilentlyContinue |
    Where-Object { $beforeWordIds -notcontains $_.ProcessId -and $_.CommandLine -match '/Automation|-Embedding' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  throw "Word render timed out after 120 seconds. Close modal Word dialogs or add-ins and retry."
}

$wordResult = Receive-Job $wordJob
Remove-Job $wordJob -Force -ErrorAction SilentlyContinue
$pageCount = [int]($wordResult | Select-Object -First 1).pageCount

if (!(Test-Path $pdf) -or ((Get-Item $pdf).Length -le 0)) {
  throw "Word did not create a valid PDF: $pdf"
}

$pdftoppm = $env:PDFTOPPM_BIN
if (!$pdftoppm) {
  $bundled = "C:\Users\jingyan.ren\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdftoppm.exe"
  if (Test-Path $bundled) {
    $pdftoppm = $bundled
  } else {
    $pdftoppm = "pdftoppm"
  }
}

& $pdftoppm -png -r 144 $pdf $pngPrefix
if ($LASTEXITCODE -ne 0) {
  throw "pdftoppm failed with exit code $LASTEXITCODE"
}

$python = $env:CODEX_PYTHON_BIN
if (!$python) {
  $bundledPython = "C:\Users\jingyan.ren\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
  if (Test-Path $bundledPython) {
    $python = $bundledPython
  } else {
    $python = "python"
  }
}

@'
import glob
import json
import os
import sys
from PIL import Image, ImageStat

out_dir = sys.argv[1]
expected_pages = int(sys.argv[2])
paths = sorted(glob.glob(os.path.join(out_dir, "page-*.png")))
if not paths:
    raise SystemExit("No rendered PNG pages were created")
if expected_pages and len(paths) != expected_pages:
    raise SystemExit(f"Rendered page count mismatch: expected {expected_pages}, got {len(paths)}")

pages = []
for path in paths:
    with Image.open(path) as image:
        rgb = image.convert("RGB")
        stat = ImageStat.Stat(rgb)
        extrema = rgb.getextrema()
        width, height = rgb.size
        # A blank all-white page has very small channel variance and white extrema.
        variance = sum(stat.var)
        nonwhite = any(channel[0] < 248 for channel in extrema)
        if width < 900 or height < 1200:
            raise SystemExit(f"Rendered page is too small: {path} {width}x{height}")
        if variance < 1 and not nonwhite:
            raise SystemExit(f"Rendered page appears blank: {path}")
        pages.append({
            "path": path,
            "width": width,
            "height": height,
            "variance": round(float(variance), 2),
        })

print(json.dumps({"ok": True, "pageCount": len(pages), "pages": pages}, ensure_ascii=False, indent=2))
'@ | Set-Content -Path $checkScript -Encoding UTF8

$renderCheck = & $python $checkScript $outDir $pageCount
if ($LASTEXITCODE -ne 0) {
  throw "Rendered page check failed"
}

[pscustomobject]@{
  ok = $true
  docx = $docx
  pdf = $pdf
  outputDir = $outDir
  wordPageCount = $pageCount
  renderCheck = ($renderCheck | ConvertFrom-Json)
} | ConvertTo-Json -Depth 8
