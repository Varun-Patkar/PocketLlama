"""
PocketLlama Server — FastAPI application.
Authenticated reverse proxy for Ollama with optional STT.

All /api/* requests are validated via X-Auth-Key header, then
streamed through to the local Ollama instance. CORS is fully open
so the mobile app can connect from any origin.
"""

from fastapi import FastAPI, Request, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
import httpx
import tempfile
import os

from config import OLLAMA_BASE, ENABLE_STT, WHISPER_MODEL

# ── App setup ────────────────────────────────────────────────────────────────

app = FastAPI(title="PocketLlama Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=86400,
)

# Auth key is set at startup by start.py
AUTH_KEY: str = ""

def set_auth_key(key: str) -> None:
    """Called by start.py to set the auth key after generation."""
    global AUTH_KEY
    AUTH_KEY = key

# ── Optional STT model ──────────────────────────────────────────────────────

whisper_model = None

def load_stt_model() -> None:
    """Load the faster-whisper model if STT is enabled."""
    global whisper_model
    if not ENABLE_STT:
        return
    try:
        from faster_whisper import WhisperModel
        print(f"  [STT] Loading Whisper model '{WHISPER_MODEL}'...")
        whisper_model = WhisperModel(WHISPER_MODEL, device="cpu")
        print(f"  [STT] Whisper model loaded.")
    except ImportError:
        print("  [STT] faster-whisper not installed. STT disabled.")
        print("        Install: pip install faster-whisper")
    except Exception as e:
        print(f"  [STT] Failed to load Whisper: {e}")

# ── Auth validation ──────────────────────────────────────────────────────────

def validate_auth(request: Request) -> None:
    """Validate the X-Auth-Key header. Raises 401 if invalid."""
    client_key = request.headers.get("X-Auth-Key", "")
    if client_key != AUTH_KEY:
        raise HTTPException(
            status_code=401,
            detail="Unauthorized – invalid or missing X-Auth-Key",
        )

# ── Health / capabilities endpoint ───────────────────────────────────────────

@app.get("/health")
async def health(request: Request):
    """
    Returns server capabilities. The mobile app uses this to detect
    whether STT is available (to show/hide the mic button).
    Auth key is required so random scanners can't probe the server.
    """
    validate_auth(request)
    return {
        "ollama": True,
        "stt": ENABLE_STT and whisper_model is not None,
    }

# ── STT endpoint ─────────────────────────────────────────────────────────────

@app.post("/stt")
async def speech_to_text(request: Request, file: UploadFile = File(...)):
    """
    Transcribe audio to text using faster-whisper.
    Accepts multipart audio file (wav, mp3, webm, ogg, mpeg).
    Returns {"text": "...", "language": "en"}.
    """
    validate_auth(request)

    if not ENABLE_STT or whisper_model is None:
        raise HTTPException(503, "STT is not enabled on this server.")

    allowed = {"audio/wav", "audio/mp3", "audio/webm", "audio/mpeg",
               "audio/ogg", "audio/x-wav", "audio/wave", "audio/m4a",
               "audio/mp4", "video/webm", "application/octet-stream"}
    if file.content_type and file.content_type not in allowed:
        raise HTTPException(400, f"Unsupported audio format: {file.content_type}")

    # Write uploaded audio to a temp file for whisper
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(await file.read())
        tmp.flush()
        tmp_path = tmp.name

    try:
        segments, info = whisper_model.transcribe(tmp_path)
        text = "".join(seg.text for seg in segments)
    finally:
        os.unlink(tmp_path)

    return {"text": text.strip(), "language": info.language}

# ── Ollama proxy (catch-all for /api/*) ──────────────────────────────────────

OLLAMA_TIMEOUT = httpx.Timeout(connect=10.0, read=600.0, write=60.0, pool=10.0)

@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy_ollama(request: Request, path: str):
    """
    Reverse proxy to Ollama. Validates auth, then streams the response
    back chunk-by-chunk for real-time token streaming.
    """
    validate_auth(request)

    # Build upstream URL
    upstream_url = f"{OLLAMA_BASE}/api/{path}"
    if request.url.query:
        upstream_url += f"?{request.url.query}"

    # Read request body
    body = await request.body()

    # Forward headers (skip hop-by-hop)
    forward_headers = {}
    if request.headers.get("content-type"):
        forward_headers["Content-Type"] = request.headers["content-type"]

    try:
        # Use a client that stays alive for the duration of streaming.
        # We must NOT use `async with client` here because StreamingResponse
        # reads the generator lazily — after this function returns.
        client = httpx.AsyncClient(timeout=OLLAMA_TIMEOUT)
        resp = await client.send(
            client.build_request(
                method=request.method,
                url=upstream_url,
                content=body if body else None,
                headers=forward_headers,
            ),
            stream=True,
        )

        response_headers = {
            "Content-Type": resp.headers.get("content-type", "application/json"),
        }

        async def generate():
            """Yield chunks from Ollama, then close client."""
            try:
                async for chunk in resp.aiter_bytes(4096):
                    yield chunk
            finally:
                await resp.aclose()
                await client.aclose()

        return StreamingResponse(
            generate(),
            status_code=resp.status_code,
            headers=response_headers,
        )
    except httpx.ConnectError:
        raise HTTPException(502, "Ollama unreachable — is it running?")
    except httpx.TimeoutException:
        raise HTTPException(504, "Ollama request timed out.")
    except Exception as e:
        raise HTTPException(500, f"Proxy error: {str(e)}")
