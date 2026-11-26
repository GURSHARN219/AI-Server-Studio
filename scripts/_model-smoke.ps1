$ErrorActionPreference = "Stop"
$root = Join-Path $env:TEMP "aist-model-smoke-20261025"
Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $root | Out-Null
$stop = Join-Path $root "stop"
$env:AIST_PORTABLE_ROOT = $root
$env:AIST_TEST_SHUTDOWN_FILE = $stop
$out = Join-Path $root "stdout.txt"
$err = Join-Path $root "stderr.txt"
$exe = Join-Path (Get-Location) "build\bin\AI-Server-Studio.exe"
$models = "A:\AI_Models\LMStudio_models\lmstudio-community"
$process = Start-Process -FilePath $exe -ArgumentList "--server", "--port", "0", "--models-dir", $models -WorkingDirectory $env:WINDIR -RedirectStandardOutput $out -RedirectStandardError $err -PassThru

$port = $null
$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline -and -not $port) {
    Start-Sleep -Milliseconds 500
    if (Test-Path $out) {
        $line = Get-Content $out -ErrorAction SilentlyContinue | Select-Object -Last 1
        if ($line -match '"port":(\d+)') { $port = [int]$Matches[1] }
    }
}
if (-not $port) { throw "server did not publish a port" }

$base = "http://127.0.0.1:$port/v1"
$signupBody = @{ email = "smoke@example.test"; password = "SmokeTest-2026!" } | ConvertTo-Json -Compress
$session = Invoke-RestMethod -Method Post -Uri "$base/auth/signup" -ContentType "application/json" -Body $signupBody
$headers = @{ Authorization = "Bearer $($session.token)" }
$qwen = Join-Path $models "Qwen3-4B-Thinking-2507-GGUF\Qwen3-4B-Thinking-2507-Q4_K_M.gguf"
$gemma = Join-Path $models "gemma-4-E4B-it-GGUF\gemma-4-E4B-it-Q4_K_M.gguf"

$qbody = @{ model_path = $qwen; config = @{} } | ConvertTo-Json -Compress
$qtime = [Diagnostics.Stopwatch]::StartNew()
try {
    $q = Invoke-RestMethod -Method Post -Uri "$base/models/load" -Headers $headers -ContentType "application/json" -Body $qbody -TimeoutSec 180
    $qstatus = "success"
    $qerror = ""
} catch {
    $qstatus = "failed"
    $qerror = $_.ErrorDetails.Message
}
$qtime.Stop()
$status1 = Invoke-RestMethod -Uri "$base/system/status" -Headers $headers
$inferenceStatus = "failed"
$inferenceError = ""
$inferenceText = ""
try {
    $chatBody = @{
        model = [IO.Path]::GetFileNameWithoutExtension($qwen)
        messages = @(@{ role = "user"; content = "Reply with OK" })
        max_tokens = 4
        stream = $false
    } | ConvertTo-Json -Depth 6 -Compress
    $completion = Invoke-RestMethod -Method Post -Uri "$base/chat/completions" -Headers $headers -ContentType "application/json" -Body $chatBody -TimeoutSec 60
    $inferenceText = [string]$completion.choices[0].message.content
    if (-not [string]::IsNullOrWhiteSpace($inferenceText)) { $inferenceStatus = "success" }
    else { $inferenceError = "completion returned empty content" }
} catch {
    $inferenceError = $_.ErrorDetails.Message
}
try { Invoke-RestMethod -Method Post -Uri "$base/models/unload" -Headers $headers -TimeoutSec 30 | Out-Null } catch {}

$gbody = @{ model_path = $gemma; config = @{} } | ConvertTo-Json -Compress
$gtime = [Diagnostics.Stopwatch]::StartNew()
try {
    $g = Invoke-RestMethod -Method Post -Uri "$base/models/load" -Headers $headers -ContentType "application/json" -Body $gbody -TimeoutSec 180
    $gstatus = "success"
    $gerror = ""
} catch {
    $gstatus = "failed"
    $gerror = $_.ErrorDetails.Message
}
$gtime.Stop()
$status2 = Invoke-RestMethod -Uri "$base/system/status" -Headers $headers
$gemmaInferenceStatus = "failed"
$gemmaInferenceError = ""
$gemmaInferenceText = ""
try {
    $gemmaChatBody = @{
        model = [IO.Path]::GetFileNameWithoutExtension($gemma)
        messages = @(@{ role = "user"; content = "Reply with OK" })
        max_tokens = 4
        stream = $false
    } | ConvertTo-Json -Depth 6 -Compress
    $gemmaCompletion = Invoke-RestMethod -Method Post -Uri "$base/chat/completions" -Headers $headers -ContentType "application/json" -Body $gemmaChatBody -TimeoutSec 60
    $gemmaInferenceText = [string]$gemmaCompletion.choices[0].message.content
    if (-not [string]::IsNullOrWhiteSpace($gemmaInferenceText)) { $gemmaInferenceStatus = "success" }
    else { $gemmaInferenceError = "completion returned empty content" }
} catch {
    $gemmaInferenceError = $_.ErrorDetails.Message
}

New-Item -ItemType File -Force $stop | Out-Null
Wait-Process -Id $process.Id -Timeout 30 -ErrorAction SilentlyContinue

[pscustomobject]@{
    Port = $port
    QwenStatus = $qstatus
    QwenSeconds = [math]::Round($qtime.Elapsed.TotalSeconds, 1)
    QwenError = $qerror
    StatusAfterQwen = ($status1 | ConvertTo-Json -Compress)
    QwenInferenceStatus = $inferenceStatus
    QwenInferenceError = $inferenceError
    QwenInferenceText = $inferenceText
    GemmaStatus = $gstatus
    GemmaSeconds = [math]::Round($gtime.Elapsed.TotalSeconds, 1)
    GemmaError = $gerror
    StatusAfterGemma = ($status2 | ConvertTo-Json -Compress)
    GemmaInferenceStatus = $gemmaInferenceStatus
    GemmaInferenceError = $gemmaInferenceError
    GemmaInferenceText = $gemmaInferenceText
    EngineLog = (Get-Content (Join-Path $root "logs\engine.log") -Raw -ErrorAction SilentlyContinue)
} | Format-List
