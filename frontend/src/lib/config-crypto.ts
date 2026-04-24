/**
 * Client-side AES-256-GCM encryption for config exports.
 * Uses the Web Crypto API — password never leaves the browser.
 *
 * Envelope format (JSON):
 *   { opsatlas: "1", encrypted: true, salt: "<b64>", iv: "<b64>", data: "<b64>" }
 */

const ITERATIONS = 150_000;

function b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function unb64(s: string): ArrayBuffer {
  const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function toArrayBuffer(arr: Uint8Array): ArrayBuffer {
  return arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength) as ArrayBuffer;
}

async function deriveKey(password: string, salt: ArrayBuffer, usage: KeyUsage[]): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  );
}

export interface EncryptedEnvelope {
  opsatlas: '1';
  encrypted: true;
  salt: string;
  iv: string;
  data: string;
}

export function isEncryptedEnvelope(obj: unknown): obj is EncryptedEnvelope {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    (obj as Record<string, unknown>).opsatlas === '1' &&
    (obj as Record<string, unknown>).encrypted === true
  );
}

export async function encryptConfig(json: string, password: string): Promise<string> {
  const saltArr = crypto.getRandomValues(new Uint8Array(16));
  const ivArr   = crypto.getRandomValues(new Uint8Array(12));
  const salt    = toArrayBuffer(saltArr);
  const iv      = toArrayBuffer(ivArr);
  const key     = await deriveKey(password, salt, ['encrypt']);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(json),
  );

  const envelope: EncryptedEnvelope = {
    opsatlas: '1',
    encrypted: true,
    salt: b64(salt),
    iv:   b64(iv),
    data: b64(ciphertext),
  };
  return JSON.stringify(envelope);
}

export async function decryptConfig(fileContent: string, password: string): Promise<string> {
  let parsed: unknown;
  try { parsed = JSON.parse(fileContent); } catch { throw new Error('File is not valid JSON'); }

  if (!isEncryptedEnvelope(parsed)) {
    // Plain JSON export (legacy) — return as-is
    return fileContent;
  }

  const salt = unb64(parsed.salt);
  const iv   = unb64(parsed.iv);
  const data = unb64(parsed.data);
  const key  = await deriveKey(password, salt, ['decrypt']);

  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  } catch {
    throw new Error('Wrong password or corrupted file');
  }

  return new TextDecoder().decode(plaintext);
}
