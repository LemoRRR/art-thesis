param(
  [string]$BaseUrl = "https://paper-ai-tool.vercel.app",
  [string]$OutputDir = "..\outputs\ich_kano_entropy\prod-stage3-research-word-render-current",
  [int]$MinPages = 4,
  [double]$MinPageVariance = 1
)

$ErrorActionPreference = "Stop"

function Resolve-FullPath([string]$PathValue) {
  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return [System.IO.Path]::GetFullPath($PathValue)
  }
  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $PathValue))
}

$outDir = Resolve-FullPath $OutputDir
$e2eDir = Join-Path $outDir "e2e"
$renderDir = Join-Path $outDir "render"

New-Item -ItemType Directory -Force -Path $e2eDir | Out-Null
New-Item -ItemType Directory -Force -Path $renderDir | Out-Null

node scripts/prod-stage3-research-e2e.mjs $BaseUrl $e2eDir
if ($LASTEXITCODE -ne 0) {
  throw "Production Stage3 research E2E failed with exit code $LASTEXITCODE"
}

$docx = Get-ChildItem -Path $e2eDir -Filter "*.docx" -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (!$docx) {
  throw "Production Stage3 research E2E did not download a DOCX into $e2eDir"
}

$renderJson = powershell -NoProfile -ExecutionPolicy Bypass -File scripts/word-render-smoke.ps1 `
  -DocxPath $docx.FullName `
  -OutputDir $renderDir `
  -MinPages $MinPages `
  -MinPageVariance $MinPageVariance

if ($LASTEXITCODE -ne 0) {
  throw "Word render smoke failed with exit code $LASTEXITCODE"
}

[pscustomobject]@{
  ok = $true
  baseUrl = $BaseUrl
  downloadedDocx = $docx.FullName
  e2eOutputDir = $e2eDir
  renderOutputDir = $renderDir
  render = ($renderJson | ConvertFrom-Json)
} | ConvertTo-Json -Depth 10
