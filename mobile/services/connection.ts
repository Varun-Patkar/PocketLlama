/**
 * PocketLlama — Connection manager.
 * Handles QR code data parsing, connection validation, and persistence.
 */

import * as Crypto from 'expo-crypto';
import { Connection, QRPayload } from '../types';
import { testConnection } from './ollama';
import { saveConnection, touchConnection } from './database';

/**
 * Parse QR code data into a structured payload.
 * Expects JSON with `url` and `key` fields.
 * @throws Error if data is not valid JSON or missing required fields.
 */
export function parseQRData(rawData: string): QRPayload {
  let parsed: any;
  try {
    parsed = JSON.parse(rawData);
  } catch {
    throw new Error('Invalid QR code — not valid JSON.');
  }
  if (!parsed.url || typeof parsed.url !== 'string') {
    throw new Error('QR code missing "url" field.');
  }
  if (!parsed.key || typeof parsed.key !== 'string') {
    throw new Error('QR code missing "key" field.');
  }
  // Normalize: strip trailing slash from URL
  const url = parsed.url.replace(/\/+$/, '');
  return { url, key: parsed.key };
}

/**
 * Test a connection and, if successful, save it to the local database.
 * @returns The saved Connection object.
 * @throws Error if the connection test fails.
 */
export async function saveAndTestConnection(url: string, key: string): Promise<Connection> {
  // Normalize URL
  const normalizedUrl = url.replace(/\/+$/, '');

  // Test the connection first
  const ok = await testConnection(normalizedUrl, key);
  if (!ok) {
    throw new Error('Could not connect. Check the URL and key, and make sure the server is running.');
  }

  // Extract a short name from the URL for display
  const name = extractConnectionName(normalizedUrl);

  const connection: Connection = {
    id: Crypto.randomUUID(),
    url: normalizedUrl,
    key,
    name,
    createdAt: Date.now(),
    lastUsed: Date.now(),
  };

  await saveConnection(connection);
  return connection;
}

/**
 * Mark a connection as recently used (updates last_used timestamp).
 */
export async function markConnectionUsed(id: string): Promise<void> {
  await touchConnection(id);
}

/**
 * Extract a short, human-readable name from a URL.
 * e.g. "https://abc123.devtunnels.ms" => "abc123"
 */
function extractConnectionName(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    // For devtunnels URLs, use the subdomain
    const parts = hostname.split('.');
    if (parts.length >= 3) return parts[0];
    return hostname;
  } catch {
    return url.slice(0, 20);
  }
}
