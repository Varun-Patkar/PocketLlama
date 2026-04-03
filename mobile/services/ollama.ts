/**
 * PocketLlama — Ollama API client.
 * Handles model listing, connection testing, and streaming chat via the
 * authenticated PocketLlama proxy (X-Auth-Key header).
 *
 * Uses the Ollama /api/chat endpoint for multi-turn conversations with
 * streaming NDJSON responses.
 */

import { OllamaModel, OllamaChatMessage } from '../types';

/** Cache of vision capability per model name (avoids repeated /api/show calls). */
const visionCache: Record<string, boolean> = {};

/** Currently active XHR for cancelling in-flight requests. */
let currentXhr: XMLHttpRequest | null = null;

/**
 * Build headers object with the auth key.
 * Every request to the PocketLlama proxy must include X-Auth-Key.
 */
function authHeaders(key: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Auth-Key': key,
  };
}

/**
 * Test whether the proxy+Ollama are reachable and the key is valid.
 * @returns true if connection succeeds, false otherwise.
 */
export async function testConnection(url: string, key: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/tags`, {
      method: 'GET',
      headers: authHeaders(key),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch the list of available models from the connected Ollama instance.
 * @returns Array of OllamaModel objects.
 */
export async function getModels(url: string, key: string): Promise<OllamaModel[]> {
  const res = await fetch(`${url}/api/tags`, {
    method: 'GET',
    headers: authHeaders(key),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch models: ${res.status}`);
  }
  const data = await res.json();
  return (data.models || []).map((m: any) => ({
    name: m.name,
    size: m.size || 0,
    modifiedAt: m.modified_at || '',
    digest: m.digest || '',
    details: m.details || {},
  }));
}

/**
 * Check if a model supports vision/image input by querying /api/show.
 * Uses projector_info (most reliable), CLIP family, or architecture checks.
 * Falls back to name-based heuristics if /api/show fails.
 * Results are cached per model name to avoid repeated API calls.
 */
export async function checkVisionCapability(url: string, key: string, modelName: string): Promise<boolean> {
  // Return cached result if available
  if (modelName in visionCache) return visionCache[modelName];

  // Check known overrides first (models that don't advertise vision via /api/show)
  if (isVisionModelByName(modelName)) {
    visionCache[modelName] = true;
    return true;
  }

  try {
    const res = await fetch(`${url}/api/show`, {
      method: 'POST',
      headers: authHeaders(key),
      body: JSON.stringify({ name: modelName }),
    });
    if (!res.ok) {
      // Fallback to name-based check
      const result = isVisionModelByName(modelName);
      visionCache[modelName] = result;
      return result;
    }

    const data = await res.json();

    // Most reliable: projector_info exists = model has a vision projector
    if (data.projector_info) {
      visionCache[modelName] = true;
      return true;
    }

    // Check model families for CLIP (used by many vision models)
    if (data.details?.families?.includes('clip')) {
      visionCache[modelName] = true;
      return true;
    }

    // Check architecture in modelinfo
    const arch = data.modelinfo?.['general.architecture']?.toLowerCase() || '';
    const visionArchs = ['llava', 'mllama', 'moondream', 'minicpm'];
    if (visionArchs.some((v) => arch.includes(v))) {
      visionCache[modelName] = true;
      return true;
    }

    visionCache[modelName] = false;
    return false;
  } catch {
    // API call failed — fall back to name-based heuristics
    const result = isVisionModelByName(modelName);
    visionCache[modelName] = result;
    return result;
  }
}

/**
 * Fallback name-based check for vision capability.
 * Used when /api/show is unavailable.
 */
function isVisionModelByName(modelName: string): boolean {
  const lower = modelName.toLowerCase();
  const keywords = ['vl', 'llava', 'vision', 'bakllava', 'moondream', 'minicpm'];
  // Known vision models that don't advertise it via /api/show
  const knownVision = ['vaultbox/qwen3.5-uncensored'];
  return keywords.some((kw) => lower.includes(kw)) || knownVision.some((kv) => lower.startsWith(kv));
}

/**
 * Synchronous check — returns cached result or false.
 * Use checkVisionCapability() for the async version that queries the API.
 */
export function isVisionModel(modelName: string): boolean {
  if (modelName in visionCache) return visionCache[modelName];
  return isVisionModelByName(modelName);
}

/**
 * Format a byte size into a human-readable string (e.g. "4.2 GB").
 */
export function formatModelSize(bytes: number): string {
  if (bytes === 0) return 'Unknown';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

/**
 * Send a chat message to Ollama and stream the response token-by-token.
 *
 * Uses XMLHttpRequest with onprogress for true incremental streaming in
 * React Native / Expo Go (fetch ReadableStream is not supported in Hermes).
 * Parses NDJSON lines from the growing responseText, calling onToken for
 * each new text chunk as it arrives.
 *
 * @param url      - Proxy base URL (e.g. https://xxx.devtunnels.ms)
 * @param key      - Auth key for X-Auth-Key header
 * @param model    - Model name (e.g. "llama3.1:8b")
 * @param messages - Full conversation history in Ollama format
 * @param onToken  - Callback invoked with each streamed text token
 * @returns The complete assembled assistant response text.
 */
export function sendMessage(
  url: string,
  key: string,
  model: string,
  messages: OllamaChatMessage[],
  onToken: (token: string) => void
): Promise<string> {
  // Cancel any previous in-flight request
  if (currentXhr) {
    currentXhr.abort();
  }

  return new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    currentXhr = xhr;

    // Track how much of responseText we've already processed
    let processedLength = 0;
    let fullResponse = '';

    /**
     * Process any new NDJSON lines that appeared in responseText since
     * the last call. Called from both onprogress and onload.
     */
    const processNewChunks = () => {
      const newText = xhr.responseText.substring(processedLength);
      processedLength = xhr.responseText.length;

      const lines = newText.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const chunk = JSON.parse(trimmed);
          if (chunk.message?.content) {
            fullResponse += chunk.message.content;
            onToken(chunk.message.content);
          }
        } catch {
          // Incomplete JSON line — will be completed in the next chunk
        }
      }
    };

    xhr.open('POST', `${url}/api/chat`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('X-Auth-Key', key);

    // Track incremental progress — this fires as data arrives
    xhr.onprogress = () => {
      processNewChunks();
    };

    xhr.onload = () => {
      // Process any remaining data not caught by onprogress
      processNewChunks();
      currentXhr = null;

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(fullResponse);
      } else {
        reject(new Error(`Ollama error (${xhr.status}): ${xhr.responseText}`));
      }
    };

    xhr.onerror = () => {
      currentXhr = null;
      reject(new Error('Network error — could not reach Ollama.'));
    };

    xhr.onabort = () => {
      currentXhr = null;
      const err = new Error('Request aborted');
      err.name = 'AbortError';
      reject(err);
    };

    xhr.send(JSON.stringify({
      model,
      messages,
      stream: true,
    }));
  });
}

/**
 * Abort the currently in-flight chat request (if any).
 * Used when the user presses the "Stop" button during generation.
 */
export function abortCurrentRequest(): void {
  if (currentXhr) {
    currentXhr.abort();
    currentXhr = null;
  }
}

/**
 * Generate a short 2-3 word title for a chat based on the first Q&A exchange.
 * Uses the same model with a non-streaming request for simplicity.
 * Returns the title string, or a fallback if generation fails.
 */
export async function generateChatTitle(
  url: string,
  key: string,
  model: string,
  userMessage: string,
  assistantMessage: string
): Promise<string> {
  try {
    const res = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: authHeaders(key),
      body: JSON.stringify({
        model,
        messages: [
          { role: 'user', content: userMessage },
          { role: 'assistant', content: assistantMessage.slice(0, 200) },
          {
            role: 'user',
            content:
              'Generate a short 2-3 word title for this conversation. Reply with ONLY the title, no quotes, no punctuation, no explanation.',
          },
        ],
        stream: false,
        options: { num_predict: 10, temperature: 0.3 },
      }),
    });
    if (!res.ok) return userMessage.slice(0, 30);
    const data = await res.json();
    const title = (data.message?.content || '').trim().replace(/^["']|["']$/g, '').slice(0, 40);
    return title || userMessage.slice(0, 30);
  } catch {
    return userMessage.slice(0, 30);
  }
}

// ── STT (Speech-to-Text) ───────────────────────────────────────────────────

/** Cached STT availability result. */
let sttAvailableCache: boolean | null = null;

/**
 * Check if the server has STT (speech-to-text) enabled.
 * Queries GET /health and checks the `stt` field.
 * Result is cached for the session.
 */
export async function checkSTTAvailable(url: string, key: string): Promise<boolean> {
  if (sttAvailableCache !== null) return sttAvailableCache;
  try {
    const res = await fetch(`${url}/health`, {
      method: 'GET',
      headers: { 'X-Auth-Key': key },
    });
    if (!res.ok) { sttAvailableCache = false; return false; }
    const data = await res.json();
    sttAvailableCache = !!data.stt;
    return sttAvailableCache;
  } catch {
    sttAvailableCache = false;
    return false;
  }
}

/** Reset the STT cache (call on disconnect/reconnect). */
export function resetSTTCache(): void {
  sttAvailableCache = null;
}

/**
 * Send an audio file to the server's /stt endpoint for transcription.
 * @param url   - Server base URL
 * @param key   - Auth key
 * @param audioUri - Local file URI of the recorded audio
 * @returns The transcribed text, or empty string on failure.
 */
export async function transcribeAudio(url: string, key: string, audioUri: string): Promise<string> {
  try {
    const formData = new FormData();
    // React Native FormData accepts {uri, type, name} objects
    formData.append('file', {
      uri: audioUri,
      type: 'audio/m4a',
      name: 'recording.m4a',
    } as any);

    const res = await fetch(`${url}/stt`, {
      method: 'POST',
      headers: { 'X-Auth-Key': key },
      body: formData,
    });
    if (!res.ok) return '';
    const data = await res.json();
    return data.text || '';
  } catch {
    return '';
  }
}
