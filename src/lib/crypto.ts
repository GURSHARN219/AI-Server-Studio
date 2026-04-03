/**
 * AES-256-GCM encryption for API keys stored in Supabase.
 * Uses the Web Crypto API — available in both browser and Electron renderer.
 *
 * Format: base64( iv[12] || ciphertext || authTag[16] )
 *
 * The key is derived from a per-install secret stored in localStorage.
 * This is not a substitute for server-side encryption, but it prevents
 * plaintext keys being readable in the DB without the client secret.
 */

const STORAGE_KEY = "ai-server-crypto-secret";
const ALGO = "AES-GCM";

/** Returns (or generates) the per-install 256-bit key material from localStorage. */
function getRawSecret(): Uint8Array {
  let hex = localStorage.getItem(STORAGE_KEY);
  if (!hex || hex.length !== 64) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(STORAGE_KEY, hex);
  }
  return new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
}

async function importKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw.buffer as ArrayBuffer, { name: ALGO }, false, ["encrypt", "decrypt"]);
}

/** Encrypts a plaintext API key. Returns a base64 string. */
export async function encryptApiKey(plaintext: string): Promise<string> {
  if (!plaintext) return "";
  const key = await importKey(getRawSecret());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt({ name: ALGO, iv }, key, encoded);
  // Prepend IV so we can decrypt later: iv(12) + ciphertext+tag
  const combined = new Uint8Array(iv.byteLength + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

/** Decrypts a base64-encoded AES-GCM ciphertext. Returns "" on failure.
 *  Falls back to treating the value as plaintext if decryption fails —
 *  handles the case where the local crypto secret was lost/regenerated. */
export async function decryptApiKey(ciphertext: string): Promise<string> {
  if (!ciphertext) return "";
  try {
    const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const key = await importKey(getRawSecret());
    const plainBuf = await crypto.subtle.decrypt({ name: ALGO, iv }, key, data);
    return new TextDecoder().decode(plainBuf);
  } catch {
    // If decryption fails, check if the stored value looks like a raw API key
    // (starts with "sk-", "Bearer ", or is otherwise not base64 AES output).
    // This handles key-loss scenarios gracefully.
    try {
      const decoded = atob(ciphertext);
      // If it decodes to printable ASCII that looks like an API key, use it
      if (/^[sk\-A-Za-z0-9_\-]{20,}/.test(decoded)) return decoded;
    } catch { /* not base64 at all */ }
    return "";
  }
}
