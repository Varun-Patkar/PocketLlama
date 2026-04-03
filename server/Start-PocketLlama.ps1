<#
.SYNOPSIS
    PocketLlama Server — Authenticated reverse proxy for Ollama via DevTunnels.

.DESCRIPTION
    Starts an HTTP proxy on a local port that validates an X-Auth-Key header,
    forwards requests to Ollama (localhost:11434), exposes the proxy via
    DevTunnels with public visibility, and generates a QR code containing
    the tunnel URL + auth key for the PocketLlama mobile app.

.PARAMETER ProxyPort
    The local port the proxy listens on. Default: 8080.

.PARAMETER OllamaPort
    The port Ollama is running on. Default: 11434.

.EXAMPLE
    .\Start-PocketLlama.ps1
    .\Start-PocketLlama.ps1 -ProxyPort 9090
#>
param(
    [int]$ProxyPort = 8080,
    [int]$OllamaPort = 11434
)

# ── Strict mode ──────────────────────────────────────────────────────────────
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Generate a random 32-char hex auth key ───────────────────────────────────
function New-AuthKey {
    $bytes = [byte[]]::new(16)
    $rng   = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $rng.Dispose()
    return ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
}

# ── QR code generation using inline C# (no external DLL needed) ─────────────
# Generates a minimal QR code as ASCII block art in the terminal.
# Uses a compact QR encoder compiled on the fly with Add-Type.
function Show-QRCode {
    param([string]$Data)

    # Try using the qrcode Python package first (most reliable output)
    $pythonAvailable = $false
    try {
        $null = & python --version 2>&1
        $pythonAvailable = $true
    } catch { }

    if ($pythonAvailable) {
        try {
            # Install qrcode if not present, then generate
            & python -m pip install qrcode[pil] --quiet 2>&1 | Out-Null
            $escaped = $Data -replace '"', '\"'
            # Use Unicode half-block chars to compress 2 rows into 1 line (halves QR height)
            $pyScript = @"
import qrcode
qr = qrcode.QRCode(box_size=1, border=1, error_correction=qrcode.constants.ERROR_CORRECT_L)
qr.add_data("$escaped")
qr.make(fit=True)
matrix = qr.get_matrix()
rows = len(matrix)
for y in range(0, rows, 2):
    line = ''
    for x in range(len(matrix[0])):
        top = matrix[y][x]
        bot = matrix[y+1][x] if y+1 < rows else False
        if top and bot:
            line += '\u2588'
        elif top and not bot:
            line += '\u2580'
        elif not top and bot:
            line += '\u2584'
        else:
            line += ' '
    print(line)
"@
            Write-Host ""
            Write-Host "  Scan this QR code with PocketLlama app:" -ForegroundColor Cyan
            Write-Host ""
            & python -c $pyScript
            Write-Host ""
            return
        } catch {
            Write-Host "  [QR] Python qrcode failed, falling back to text output." -ForegroundColor Yellow
        }
    }

    # Fallback: just print the data clearly
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "  ║  QR code generation requires Python + qrcode    ║" -ForegroundColor Cyan
    Write-Host "  ║  Install: pip install qrcode[pil]               ║" -ForegroundColor Cyan
    Write-Host "  ║  Copy the JSON below into the app manually.     ║" -ForegroundColor Cyan
    Write-Host "  ╚══════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

# ── Forward a single HTTP request to Ollama and stream the response back ─────
function Invoke-ProxyRequest {
    param(
        [System.Net.HttpListenerContext]$Context,
        [string]$OllamaBase,
        [string]$AuthKey
    )

    $req = $Context.Request
    $res = $Context.Response

    # ── CORS preflight ───────────────────────────────────────────────────────
    $res.Headers.Set("Access-Control-Allow-Origin", "*")
    $res.Headers.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
    $res.Headers.Set("Access-Control-Allow-Headers", "Content-Type, X-Auth-Key, Authorization")
    $res.Headers.Set("Access-Control-Max-Age", "86400")

    if ($req.HttpMethod -eq 'OPTIONS') {
        $res.StatusCode = 204
        $res.Close()
        return
    }

    # ── Auth check ───────────────────────────────────────────────────────────
    $clientKey = $req.Headers["X-Auth-Key"]
    if ($clientKey -ne $AuthKey) {
        $res.StatusCode = 401
        $body = [System.Text.Encoding]::UTF8.GetBytes('{"error":"Unauthorized – invalid or missing X-Auth-Key"}')
        $res.ContentType = "application/json"
        $res.ContentLength64 = $body.Length
        $res.OutputStream.Write($body, 0, $body.Length)
        $res.Close()
        return
    }

    # ── Build upstream URL ───────────────────────────────────────────────────
    $upstreamUrl = "$OllamaBase$($req.RawUrl)"

    try {
        # Create upstream request
        $upstream = [System.Net.HttpWebRequest]::Create($upstreamUrl)
        $upstream.Method = $req.HttpMethod
        $upstream.ContentType = $req.ContentType
        $upstream.AllowAutoRedirect = $false
        $upstream.Timeout = 600000           # 10 minutes for long generations
        $upstream.ReadWriteTimeout = 600000

        # Forward request body if present
        if ($req.HasEntityBody) {
            $upstream.ContentLength = $req.ContentLength64
            $reqStream = $upstream.GetRequestStream()
            $req.InputStream.CopyTo($reqStream)
            $reqStream.Close()
        }

        # Get upstream response and stream it back
        $upstreamRes = $upstream.GetResponse()
        $res.StatusCode = [int]$upstreamRes.StatusCode
        $res.ContentType = $upstreamRes.ContentType

        # Copy headers we care about
        foreach ($header in @('Transfer-Encoding', 'Content-Encoding')) {
            $val = $upstreamRes.Headers[$header]
            if ($val) { try { $res.Headers.Set($header, $val) } catch {} }
        }

        # Stream the response body in chunks (crucial for /api/chat streaming)
        $upStream = $upstreamRes.GetResponseStream()
        $buffer = [byte[]]::new(4096)
        while ($true) {
            $read = $upStream.Read($buffer, 0, $buffer.Length)
            if ($read -le 0) { break }
            $res.OutputStream.Write($buffer, 0, $read)
            $res.OutputStream.Flush()
        }
        $upStream.Close()
        $upstreamRes.Close()
    }
    catch [System.Net.WebException] {
        $we = $_.Exception
        if ($we.Response) {
            $errRes = [System.Net.HttpWebResponse]$we.Response
            $res.StatusCode = [int]$errRes.StatusCode
            $res.ContentType = $errRes.ContentType
            $errStream = $errRes.GetResponseStream()
            $errStream.CopyTo($res.OutputStream)
            $errStream.Close()
            $errRes.Close()
        } else {
            $res.StatusCode = 502
            $errBody = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"Ollama unreachable: $($we.Message)`"}")
            $res.ContentType = "application/json"
            $res.ContentLength64 = $errBody.Length
            $res.OutputStream.Write($errBody, 0, $errBody.Length)
        }
    }
    catch {
        $res.StatusCode = 500
        $errBody = [System.Text.Encoding]::UTF8.GetBytes("{`"error`":`"Proxy error: $($_.Exception.Message)`"}")
        $res.ContentType = "application/json"
        $res.ContentLength64 = $errBody.Length
        $res.OutputStream.Write($errBody, 0, $errBody.Length)
    }
    finally {
        try { $res.Close() } catch {}
    }
}

# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

Write-Host ""
Write-Host "  ╔════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "  ║         PocketLlama  Server            ║" -ForegroundColor Magenta
Write-Host "  ╚════════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""

# ── Step 1: Check / auto-start Ollama ────────────────────────────────────────
Write-Host "  [1/4] Checking Ollama on port $OllamaPort..." -ForegroundColor Yellow
$ollamaRunning = $false
try {
    $ollamaCheck = Invoke-RestMethod -Uri "http://localhost:$OllamaPort/api/tags" -TimeoutSec 3
    $ollamaRunning = $true
} catch {
    $ollamaRunning = $false
}

if (-not $ollamaRunning) {
    Write-Host "  [...]  Ollama not detected — starting it automatically..." -ForegroundColor Yellow
    # Try to find ollama executable
    $ollamaCmd = Get-Command ollama -ErrorAction SilentlyContinue
    if (-not $ollamaCmd) {
        Write-Host "  [ERR] 'ollama' CLI not found in PATH." -ForegroundColor Red
        Write-Host "        Install from: https://ollama.com" -ForegroundColor Red
        exit 1
    }
    # Start ollama serve in the background
    $ollamaProcess = Start-Process -FilePath "ollama" -ArgumentList "serve" `
        -PassThru -NoNewWindow `
        -RedirectStandardOutput ([System.IO.Path]::GetTempFileName()) `
        -RedirectStandardError ([System.IO.Path]::GetTempFileName())

    # Wait up to 15 seconds for Ollama to become responsive
    $waited = 0
    while ($waited -lt 15) {
        Start-Sleep -Milliseconds 500
        $waited += 0.5
        try {
            $ollamaCheck = Invoke-RestMethod -Uri "http://localhost:$OllamaPort/api/tags" -TimeoutSec 2
            $ollamaRunning = $true
            break
        } catch { }
    }
    if (-not $ollamaRunning) {
        Write-Host "  [ERR] Ollama failed to start within 15 seconds." -ForegroundColor Red
        exit 1
    }
    Write-Host "  [OK]  Ollama started automatically (PID $($ollamaProcess.Id))" -ForegroundColor Green
} else {
    Write-Host "  [OK]  Ollama is already running" -ForegroundColor Green
}

$modelCount = ($ollamaCheck.models | Measure-Object).Count
Write-Host "        $modelCount model(s) available" -ForegroundColor Gray

# ── Step 2: Generate auth key ────────────────────────────────────────────────
Write-Host "  [2/4] Generating auth key..." -ForegroundColor Yellow
$authKey = New-AuthKey
Write-Host "  [OK]  Auth key generated" -ForegroundColor Green

# ── Step 3: Start DevTunnel ──────────────────────────────────────────────────
Write-Host "  [3/4] Starting DevTunnel on port $ProxyPort..." -ForegroundColor Yellow

# Check devtunnel CLI is available
try {
    $null = Get-Command devtunnel -ErrorAction Stop
} catch {
    Write-Host "  [ERR] 'devtunnel' CLI not found." -ForegroundColor Red
    Write-Host "        Install: https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started" -ForegroundColor Red
    exit 1
}

# Start devtunnel in background and capture output to find the URL
$tunnelLogFile = [System.IO.Path]::GetTempFileName()
$tunnelErrFile = [System.IO.Path]::GetTempFileName()
$tunnelProcess = Start-Process -FilePath "devtunnel" `
    -ArgumentList "host", "-p", "$ProxyPort", "--allow-anonymous" `
    -RedirectStandardOutput $tunnelLogFile `
    -RedirectStandardError $tunnelErrFile `
    -PassThru -NoNewWindow

# Wait for the tunnel URL to appear in the log (up to 30 seconds)
# DevTunnel may output to stdout or stderr depending on version.
# URL formats seen in the wild:
#   https://XXXX-8080.inc1.devtunnels.ms   (preferred — no port in URL)
#   https://XXXX.inc1.devtunnels.ms:8080   (has port suffix)
$tunnelUrl = $null
$elapsed = 0
while ($elapsed -lt 30) {
    Start-Sleep -Milliseconds 500
    $elapsed += 0.5
    # Check both stdout and stderr for the tunnel URL
    foreach ($logFile in @($tunnelLogFile, $tunnelErrFile)) {
        if (-not (Test-Path $logFile)) { continue }
        $logContent = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
        if (-not $logContent) { continue }
        # Match any devtunnels.ms URL (with optional regional subdomain like inc1.)
        if ($logContent -match '(https://[a-z0-9\-]+(?:\.[a-z0-9\-]+)*\.devtunnels\.ms(?::\d+)?[^\s,]*)') {
            $allUrls = [regex]::Matches($logContent, '(https://[a-z0-9\-]+(?:\.[a-z0-9\-]+)*\.devtunnels\.ms(?::\d+)?[^\s,]*)')
            # Prefer the URL without an explicit port (the -PORT. variant is cleaner)
            $tunnelUrl = $null
            foreach ($m in $allUrls) {
                $candidate = $m.Groups[1].Value.TrimEnd('/')
                if ($candidate -notmatch ':\d+$') {
                    $tunnelUrl = $candidate
                    break
                }
            }
            # Fallback to first URL if all have ports
            if (-not $tunnelUrl) {
                $tunnelUrl = $allUrls[0].Groups[1].Value.TrimEnd('/')
            }
            break
        }
    }
    if ($tunnelUrl) { break }
}

if (-not $tunnelUrl) {
    Write-Host "  [ERR] Could not obtain DevTunnel URL within 30s." -ForegroundColor Red
    Write-Host "        Check 'devtunnel' login status: devtunnel user login" -ForegroundColor Red
    if ($tunnelProcess -and !$tunnelProcess.HasExited) { $tunnelProcess.Kill() }
    exit 1
}

Write-Host "  [OK]  Tunnel ready: $tunnelUrl" -ForegroundColor Green

# ── Step 4: Show QR code ─────────────────────────────────────────────────────
Write-Host "  [4/4] Generating QR code..." -ForegroundColor Yellow

$qrData = @{ url = $tunnelUrl; key = $authKey } | ConvertTo-Json -Compress
Show-QRCode -Data $qrData

Write-Host "  ┌──────────────────────────────────────────────────────┐" -ForegroundColor White
Write-Host "  │  Connection Details (for manual entry):              │" -ForegroundColor White
Write-Host "  │                                                      │" -ForegroundColor White
Write-Host "  │  URL: $tunnelUrl" -ForegroundColor Cyan -NoNewline
Write-Host "$(' ' * [Math]::Max(0, 48 - $tunnelUrl.Length))│" -ForegroundColor White
Write-Host "  │  Key: $authKey │" -ForegroundColor Cyan
Write-Host "  │                                                      │" -ForegroundColor White
Write-Host "  └──────────────────────────────────────────────────────┘" -ForegroundColor White
Write-Host ""
Write-Host "  Proxy listening on http://localhost:$ProxyPort → Ollama :$OllamaPort" -ForegroundColor Gray
Write-Host "  Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host ""

# ── Start the HTTP listener (main loop) ──────────────────────────────────────
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://+:$ProxyPort/")

try {
    $listener.Start()
} catch {
    # Fallback to localhost-only if + binding fails (no admin)
    $listener = [System.Net.HttpListener]::new()
    $listener.Prefixes.Add("http://localhost:$ProxyPort/")
    $listener.Start()
}

$ollamaBase = "http://localhost:$OllamaPort"

# Register Ctrl+C handler — stops the listener which unblocks GetContext()
$null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
    # This fires when the process is exiting
} -SupportEvent

# Use CancelKeyPress to cleanly break out of the blocking GetContext() call
$cancelHandler = [System.ConsoleCancelEventHandler]{
    param($s, $e)
    $e.Cancel = $true  # Prevent immediate process kill
    try { $listener.Stop() } catch {}
}
[Console]::add_CancelKeyPress($cancelHandler)

try {
    while ($listener.IsListening) {
        # GetContext blocks until a request arrives — listener.Stop() will unblock it
        try {
            $context = $listener.GetContext()
        } catch [System.Net.HttpListenerException] {
            # Listener was stopped by Ctrl+C handler — exit loop
            break
        }
        $method = $context.Request.HttpMethod
        $path   = $context.Request.RawUrl
        $ts     = Get-Date -Format "HH:mm:ss"
        Write-Host "  [$ts] $method $path" -ForegroundColor DarkGray

        Invoke-ProxyRequest -Context $context -OllamaBase $ollamaBase -AuthKey $authKey
    }
}
catch {
    if ($_.Exception -is [System.Net.HttpListenerException]) {
        # Listener was stopped — clean exit
    } else {
        Write-Host "  [ERR] $($_.Exception.Message)" -ForegroundColor Red
    }
}
finally {
    Write-Host ""
    Write-Host "  Shutting down..." -ForegroundColor Yellow
    try { [Console]::remove_CancelKeyPress($cancelHandler) } catch {}
    try { $listener.Stop() } catch {}
    try { $listener.Close() } catch {}
    if ($tunnelProcess -and !$tunnelProcess.HasExited) {
        $tunnelProcess.Kill()
        Write-Host "  DevTunnel stopped." -ForegroundColor Yellow
    }
    # Clean up temp files
    if (Test-Path $tunnelLogFile) { Remove-Item $tunnelLogFile -Force -ErrorAction SilentlyContinue }
    if (Test-Path $tunnelErrFile) { Remove-Item $tunnelErrFile -Force -ErrorAction SilentlyContinue }
    Write-Host "  Goodbye!" -ForegroundColor Green
}
