$ErrorActionPreference = "Stop"

$msysBin = "C:\msys64\ucrt64\bin"
$msysUsrBin = "C:\msys64\usr\bin"
if (Test-Path -LiteralPath $msysBin -PathType Container) {
    $env:Path = "$msysBin;$msysUsrBin;$env:Path"
}

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH. Install it before building."
    }
}

Require-Command "go"
Require-Command "npm"
Require-Command "wails"
Require-Command "gcc"
Require-Command "g++"

$repo = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $repo "cmd\engine")

$goRoot = (& go env GOROOT).Trim()
$goCompiler = Join-Path $goRoot "bin\go.exe"
if (-not (Test-Path -LiteralPath $goCompiler -PathType Leaf)) {
    throw "Could not resolve the real Go compiler from GOROOT: $goCompiler"
}

$env:CGO_ENABLED = "1"
$env:CC = (Get-Command gcc).Source
$env:CXX = (Get-Command g++).Source

$buildVersion = "0.1.01"
$gitCommit = (& git rev-parse --short HEAD 2>$null).Trim()
if ([string]::IsNullOrWhiteSpace($gitCommit)) { $gitCommit = "unknown" }
$buildDate = (Get-Date).ToUniversalTime().ToString("o")
$ldflags = "-X main.appVersion=$buildVersion -X main.gitCommit=$gitCommit -X main.buildDate=$buildDate"
Write-Host "[aist] Version $buildVersion commit $gitCommit build-date $buildDate"

$goVersion = (& go version)
Write-Host "[aist] $goVersion"
$wailsVersion = (& wails version)
Write-Host "[aist] Wails $wailsVersion"

Write-Host "[aist] Building React production assets..."
& npm --prefix (Join-Path $repo "app") run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed with exit code $LASTEXITCODE." }

$index = Join-Path $repo "app\dist\index.html"
if (-not (Test-Path -LiteralPath $index -PathType Leaf)) {
    throw "Frontend build completed without the required embedded asset: $index"
}
$assets = Join-Path $repo "app\dist\assets"
if (-not (Test-Path -LiteralPath $assets -PathType Container)) {
    throw "Frontend build completed without the required assets directory: $assets"
}
if (@(Get-ChildItem -LiteralPath $assets -File).Count -eq 0) {
    throw "Frontend build produced an empty assets directory: $assets"
}

Write-Host "[aist] Building Wails v2 Windows desktop executable..."
$iconSource = Join-Path $repo "app\public\logo.png"
$faviconSource = Join-Path $repo "app\public\favicon.ico"
$iconTarget = Join-Path $repo "cmd\engine\appicon.png"
$windowsIconTarget = Join-Path $repo "build\windows\icon.ico"
if (-not (Test-Path -LiteralPath $iconSource -PathType Leaf)) {
    throw "The intended application icon source is missing: $iconSource"
}
if (-not (Test-Path -LiteralPath $faviconSource -PathType Leaf)) {
    throw "The intended Windows ICO source is missing: $faviconSource"
}
Copy-Item -LiteralPath $iconSource -Destination $iconTarget -Force
New-Item -ItemType Directory -Path (Split-Path -Parent $windowsIconTarget) -Force | Out-Null
Copy-Item -LiteralPath $faviconSource -Destination $windowsIconTarget -Force

# Wails normally supplies these production tags itself. Keep them explicit so
# this release script cannot regress into the Windows diagnostic stub if CLI
# defaults change or the project is built through a wrapper.
try {
    & wails build `
        -platform windows/amd64 `
        -compiler $goCompiler `
        -tags "desktop,production" `
        -ldflags $ldflags `
        -webview2 browser `
        -nosyncgomod `
        -skipbindings `
        -skipembedcreate `
        -trimpath `
        -o AI-Server-Studio.exe
    if ($LASTEXITCODE -ne 0) { throw "Wails build failed with exit code $LASTEXITCODE." }
} finally {
    Remove-Item -LiteralPath $iconTarget -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $windowsIconTarget -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $repo "cmd\engine\windows") -Recurse -Force -ErrorAction SilentlyContinue
}

$built = Join-Path $repo "build\bin\AI-Server-Studio.exe"
if (-not (Test-Path -LiteralPath $built -PathType Leaf)) {
    throw "Wails build did not produce the expected artifact: $built"
}

$packageDir = Join-Path $repo "build\bin"

$nativeSource = Join-Path $repo "bin"
foreach ($required in @("llama.dll", "ggml.dll", "ggml-base.dll")) {
    $source = Join-Path $nativeSource $required
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Required native inference dependency is missing: $source"
    }
}

# Windows resolves DLL imports before Go main() can run. Keep the source
# `bin/` tree untouched, but place loader-visible copies beside the final
# executable in the `build/bin` portable package.
foreach ($source in Get-ChildItem -LiteralPath $nativeSource -Filter "*.dll" -File) {
    $destination = Join-Path $packageDir $source.Name
    if (Test-Path -LiteralPath $destination -PathType Leaf) {
        # A running desktop app can keep its packaged DLLs locked. Avoid
        # replacing files that are already byte-for-byte current.
        $sourceHash = (Get-FileHash -LiteralPath $source.FullName -Algorithm SHA256).Hash
        $destinationHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
        if ($sourceHash -eq $destinationHash) { continue }
    }
    Copy-Item -LiteralPath $source.FullName -Destination $destination -Force
}
foreach ($runtimeDLL in @("libgcc_s_seh-1.dll", "libstdc++-6.dll", "libwinpthread-1.dll")) {
    $source = Join-Path $msysBin $runtimeDLL
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Required CGO runtime dependency is missing: $source"
    }
    Copy-Item -LiteralPath $source -Destination $packageDir -Force
}

Write-Host "[aist] Built portable package in $packageDir"
