"""
PocketLlama Server — Entry point.
Replaces Start-PocketLlama.ps1. Handles:
  1. Auto-start Ollama if not running
  2. Generate random auth key
  3. Start DevTunnel with public access
  4. Display QR code in terminal
  5. Launch the FastAPI proxy server
"""

import os
import sys
import time
import secrets
import subprocess
import re
import signal
import httpx
import qrcode
import json
import uvicorn

from config import PROXY_PORT, OLLAMA_PORT, OLLAMA_BASE, ENABLE_STT

# ── Utilities ────────────────────────────────────────────────────────────────

def generate_auth_key() -> str:
    """Generate a random 32-character hex auth key."""
    return secrets.token_hex(16)


def print_banner():
    print()
    print("  ╔════════════════════════════════════════╗")
    print("  ║         PocketLlama  Server            ║")
    print("  ╚════════════════════════════════════════╝")
    print()


def show_qr_code(data: str):
    """Print a compact QR code using Unicode half-block characters."""
    qr = qrcode.QRCode(box_size=1, border=1, error_correction=qrcode.constants.ERROR_CORRECT_L)
    qr.add_data(data)
    qr.make(fit=True)
    matrix = qr.get_matrix()
    rows = len(matrix)
    print()
    print("  Scan this QR code with PocketLlama app:")
    print()
    for y in range(0, rows, 2):
        line = "  "
        for x in range(len(matrix[0])):
            top = matrix[y][x]
            bot = matrix[y + 1][x] if y + 1 < rows else False
            if top and bot:
                line += "█"
            elif top and not bot:
                line += "▀"
            elif not top and bot:
                line += "▄"
            else:
                line += " "
        print(line)
    print()


# ── Step 1: Check / auto-start Ollama ────────────────────────────────────────

def ensure_ollama_running() -> bool:
    """Check if Ollama is running, start it if not. Returns True on success."""
    print(f"  [1/4] Checking Ollama on port {OLLAMA_PORT}...")

    # Check if already running
    try:
        r = httpx.get(f"{OLLAMA_BASE}/api/tags", timeout=3)
        if r.status_code == 200:
            models = r.json().get("models", [])
            print(f"  [OK]  Ollama is already running")
            print(f"        {len(models)} model(s) available")
            return True
    except Exception:
        pass

    # Try to start Ollama
    print("  [...]  Ollama not detected — starting it automatically...")
    try:
        subprocess.Popen(
            ["ollama", "serve"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except FileNotFoundError:
        print("  [ERR] 'ollama' CLI not found in PATH.")
        print("        Install from: https://ollama.com")
        return False

    # Wait up to 15 seconds
    for _ in range(30):
        time.sleep(0.5)
        try:
            r = httpx.get(f"{OLLAMA_BASE}/api/tags", timeout=2)
            if r.status_code == 200:
                models = r.json().get("models", [])
                print(f"  [OK]  Ollama started automatically")
                print(f"        {len(models)} model(s) available")
                return True
        except Exception:
            pass

    print("  [ERR] Ollama failed to start within 15 seconds.")
    return False


# ── Step 3: Start DevTunnel ──────────────────────────────────────────────────

def start_devtunnel() -> tuple[subprocess.Popen | None, str | None]:
    """Start devtunnel and return (process, url). Returns (None, None) on failure."""
    print(f"  [3/4] Starting DevTunnel on port {PROXY_PORT}...")

    # Check devtunnel is available
    try:
        subprocess.run(["devtunnel", "--version"], capture_output=True, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        print("  [ERR] 'devtunnel' CLI not found.")
        print("        Install: https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started")
        return None, None

    # Write stdout/stderr to temp files so we can poll without blocking
    # (devtunnel is a long-running process that never exits)
    import tempfile
    stdout_file = tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False)
    stderr_file = tempfile.NamedTemporaryFile(mode="w", suffix=".log", delete=False)

    proc = subprocess.Popen(
        ["devtunnel", "host", "-p", str(PROXY_PORT), "--allow-anonymous"],
        stdout=stdout_file,
        stderr=stderr_file,
    )

    # Store temp file paths for cleanup later
    proc._stdout_log = stdout_file.name  # type: ignore
    proc._stderr_log = stderr_file.name  # type: ignore

    # Wait up to 30 seconds for the tunnel URL to appear in the log files
    url_pattern = re.compile(
        r"(https://[a-z0-9\-]+(?:\.[a-z0-9\-]+)*\.devtunnels\.ms(?::\d+)?[^\s,]*)"
    )
    tunnel_url = None
    start_time = time.time()

    while time.time() - start_time < 30:
        time.sleep(0.5)
        # Check both log files for the tunnel URL
        for log_path in [stdout_file.name, stderr_file.name]:
            try:
                with open(log_path, "r", errors="ignore") as f:
                    content = f.read()
                if not content:
                    continue
                matches = url_pattern.findall(content)
                if matches:
                    # Prefer URL without explicit port suffix
                    for candidate in matches:
                        candidate = candidate.rstrip("/")
                        if not re.search(r":\d+$", candidate):
                            tunnel_url = candidate
                            break
                    if not tunnel_url:
                        tunnel_url = matches[0].rstrip("/")
            except Exception:
                pass

        if tunnel_url:
            break

    if not tunnel_url:
        print("  [ERR] Could not obtain DevTunnel URL within 30s.")
        print("        Check 'devtunnel' login status: devtunnel user login")
        proc.kill()
        return None, None

    print(f"  [OK]  Tunnel ready: {tunnel_url}")
    return proc, tunnel_url


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print_banner()

    # Step 1: Ollama
    if not ensure_ollama_running():
        sys.exit(1)

    # Step 2: Auth key
    print("  [2/4] Generating auth key...")
    auth_key = generate_auth_key()
    print("  [OK]  Auth key generated")

    # Step 3: DevTunnel
    tunnel_proc, tunnel_url = start_devtunnel()
    if not tunnel_url:
        sys.exit(1)

    # Step 4: QR code
    print("  [4/4] Generating QR code...")
    qr_data = json.dumps({"url": tunnel_url, "key": auth_key}, separators=(",", ":"))
    show_qr_code(qr_data)

    # Print connection details
    pad = max(0, 48 - len(tunnel_url))
    print("  ┌──────────────────────────────────────────────────────┐")
    print("  │  Connection Details (for manual entry):              │")
    print("  │                                                      │")
    print(f"  │  URL: {tunnel_url}{' ' * pad}│")
    print(f"  │  Key: {auth_key} │")
    print("  │                                                      │")
    print("  └──────────────────────────────────────────────────────┘")
    print()
    stt_status = "enabled" if ENABLE_STT else "disabled"
    print(f"  Proxy: http://localhost:{PROXY_PORT} → Ollama :{OLLAMA_PORT}")
    print(f"  STT:   {stt_status}")
    print(f"  Press Ctrl+C to stop.")
    print()

    # Set auth key on the FastAPI app
    from app import set_auth_key, load_stt_model
    set_auth_key(auth_key)

    # Load STT model if enabled
    if ENABLE_STT:
        load_stt_model()

    # Graceful shutdown handler
    def shutdown(sig, frame):
        print()
        print("  Shutting down...")
        if tunnel_proc and tunnel_proc.poll() is None:
            tunnel_proc.kill()
            print("  DevTunnel stopped.")
        # Clean up temp log files
        for attr in ('_stdout_log', '_stderr_log'):
            path = getattr(tunnel_proc, attr, None)
            if path:
                try: os.unlink(path)
                except Exception: pass
        print("  Goodbye!")
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # Start the FastAPI server
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=PROXY_PORT,
        log_level="info",
    )


if __name__ == "__main__":
    main()
