param(
  [string]$DocxPath = "..\outputs\ich_kano_entropy\prod-research-smoke.docx",
  [string]$OutputDir = "..\outputs\ich_kano_entropy\word-render-smoke",
  [int]$MinPages = 1,
  [double]$MinPageVariance = 1
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
if ($pageCount -lt $MinPages) {
  throw "Word page count is too low: expected at least $MinPages, got $pageCount"
}

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
from PIL import Image, ImageDraw, ImageStat

out_dir = sys.argv[1]
expected_pages = int(sys.argv[2])
min_variance = float(sys.argv[3])
paths = sorted(glob.glob(os.path.join(out_dir, "page-*.png")))
if not paths:
    raise SystemExit("No rendered PNG pages were created")
if expected_pages and len(paths) != expected_pages:
    raise SystemExit(f"Rendered page count mismatch: expected {expected_pages}, got {len(paths)}")

pages = []
images = []
for path in paths:
    with Image.open(path) as image:
        rgb = image.convert("RGB")
        images.append((path, rgb.copy()))
        stat = ImageStat.Stat(rgb)
        extrema = rgb.getextrema()
        width, height = rgb.size
        # A blank all-white page has very small channel variance and white extrema.
        variance = sum(stat.var)
        nonwhite = any(channel[0] < 248 for channel in extrema)
        total_samples = 0
        white_samples = 0
        dark_samples = 0
        saturated_samples = 0
        step_x = max(1, width // 120)
        step_y = max(1, height // 160)
        for y in range(0, height, step_y):
            for x in range(0, width, step_x):
                red, green, blue = rgb.getpixel((x, y))
                total_samples += 1
                luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
                if red > 245 and green > 245 and blue > 245:
                    white_samples += 1
                if luminance < 80:
                    dark_samples += 1
                if max(red, green, blue) - min(red, green, blue) > 90 and max(red, green, blue) > 140:
                    saturated_samples += 1
        white_ratio = white_samples / max(1, total_samples)
        dark_ratio = dark_samples / max(1, total_samples)
        saturated_ratio = saturated_samples / max(1, total_samples)
        if width < 900 or height < 1200:
            raise SystemExit(f"Rendered page is too small: {path} {width}x{height}")
        if variance < 1 and not nonwhite:
            raise SystemExit(f"Rendered page appears blank: {path}")
        if variance < min_variance:
            raise SystemExit(f"Rendered page has too little visual content: {path} variance={variance:.2f}, min={min_variance}")
        if dark_ratio > 0.16:
            raise SystemExit(f"Rendered page has too much dark visual noise: {path} dark_ratio={dark_ratio:.3f}")
        if saturated_ratio > 0.12:
            raise SystemExit(f"Rendered page has too much saturated visual noise: {path} saturated_ratio={saturated_ratio:.3f}")
        if white_ratio < 0.45:
            raise SystemExit(f"Rendered page white-space ratio is too low for a thesis page: {path} white_ratio={white_ratio:.3f}")
        pages.append({
            "path": path,
            "width": width,
            "height": height,
            "variance": round(float(variance), 2),
            "whiteRatio": round(float(white_ratio), 3),
            "darkRatio": round(float(dark_ratio), 3),
            "saturatedRatio": round(float(saturated_ratio), 3),
        })

thumb_w = 360
thumbs = []
for idx, (path, image) in enumerate(images, 1):
    scale = thumb_w / max(1, image.width)
    thumb = image.resize((thumb_w, int(image.height * scale)))
    canvas = Image.new("RGB", (thumb.width, thumb.height + 32), "white")
    canvas.paste(thumb, (0, 32))
    draw = ImageDraw.Draw(canvas)
    draw.text((8, 8), f"Page {idx}", fill=(0, 0, 0))
    thumbs.append(canvas)

contact_sheet = ""
if thumbs:
    cols = 2 if len(thumbs) > 1 else 1
    row_h = max(thumb.height for thumb in thumbs)
    rows = (len(thumbs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * thumb_w, rows * row_h), (245, 245, 245))
    for idx, thumb in enumerate(thumbs):
        sheet.paste(thumb, ((idx % cols) * thumb_w, (idx // cols) * row_h))
    contact_sheet = os.path.join(out_dir, "contact-sheet.png")
    sheet.save(contact_sheet)

print(json.dumps({"ok": True, "pageCount": len(pages), "contactSheet": contact_sheet, "pages": pages}, ensure_ascii=False, indent=2))
'@ | Set-Content -Path $checkScript -Encoding UTF8

$renderCheck = & $python $checkScript $outDir $pageCount $MinPageVariance
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
