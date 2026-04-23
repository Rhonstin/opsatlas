import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Derive a 32-byte AES key from ENCRYPTION_KEY using PBKDF2.
 * Deterministic but far stronger than the old pad-with-zeros approach.
 */
function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error('ENCRYPTION_KEY env var not set');
  return crypto.pbkdf2Sync(secret, 'opsatlas-v2-salt', 100_000, KEY_LENGTH, 'sha256');
}

/**
 * Legacy key derivation (v1): simple pad/slice.
 * Only used to decrypt old ciphertexts — never used to encrypt.
 */
function getLegacyKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error('ENCRYPTION_KEY env var not set');
  return Buffer.from(secret.padEnd(KEY_LENGTH, '0').slice(0, KEY_LENGTH));
}

/** Encrypt plaintext. Always produces a v2-prefixed ciphertext. */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'v2:' + Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptWithKey(b64: string, key: Buffer): string {
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const data = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/**
 * Decrypt ciphertext produced by encrypt().
 * Handles both v2 (PBKDF2 key) and legacy v1 (pad-with-zeros key) formats
 * so existing credentials continue to work after upgrading.
 */
export function decrypt(ciphertext: string): string {
  if (ciphertext.startsWith('v2:')) {
    return decryptWithKey(ciphertext.slice(3), getKey());
  }
  // Legacy v1 — old ciphertexts have no prefix
  return decryptWithKey(ciphertext, getLegacyKey());
}
