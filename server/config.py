"""
PocketLlama Server — Configuration.
Loads settings from .env file with sensible defaults.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from the server directory
load_dotenv(Path(__file__).parent / ".env")

PROXY_PORT = int(os.getenv("PROXY_PORT", "8080"))
OLLAMA_PORT = int(os.getenv("OLLAMA_PORT", "11434"))
ENABLE_STT = os.getenv("ENABLE_STT", "false").lower() in ("true", "1", "yes")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")
OLLAMA_BASE = f"http://localhost:{OLLAMA_PORT}"
