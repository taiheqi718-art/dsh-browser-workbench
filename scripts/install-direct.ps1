[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$scratchRoot = Join-Path $projectRoot '.scratch\tooling'
$npmCache = Join-Path $scratchRoot 'npm-cache'
$installTemp = Join-Path $scratchRoot 'temp'
New-Item -ItemType Directory -Path $npmCache, $installTemp -Force | Out-Null

$resolvedProject = (Resolve-Path -LiteralPath $projectRoot).Path
foreach ($name in @(
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy',
  'npm_config_proxy', 'npm_config_https_proxy'
)) {
  Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
}

# Process-local direct download. The user's global proxy and npm config are not
# changed, and Playwright is forbidden from downloading a second browser.
$env:NO_PROXY = '*'
$env:no_proxy = '*'
$env:npm_config_registry = 'https://registry.npmjs.org/'
$env:npm_config_cache = $npmCache
$env:TMP = $installTemp
$env:TEMP = $installTemp
$env:TMPDIR = $installTemp
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
$env:PLAYWRIGHT_SKIP_DOWNLOAD_BROWSER = '1'

& npm.cmd install --prefix $resolvedProject --ignore-scripts --no-audit --no-fund --package-lock
if ($LASTEXITCODE -ne 0) {
  throw "Direct dependency install failed with exit code $LASTEXITCODE. No proxy fallback was attempted."
}

Write-Host "Dependencies installed directly; runtime and cache remain under: $resolvedProject"
