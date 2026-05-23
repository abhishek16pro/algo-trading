import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

/**
 * AES-256-GCM symmetric encryption used for broker credentials at rest.
 *
 * Output is base64( iv | authTag | ciphertext ), iv = 12 bytes, authTag = 16 bytes.
 */
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(encKeyBase64: string): Buffer {
  const k = Buffer.from(encKeyBase64, 'base64');
  if (k.length !== 32) throw new Error('Encryption key must be 32 bytes (base64).');
  return k;
}

export function encrypt(plaintext: string, encKeyBase64: string): string {
  const key = getKey(encKeyBase64);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decrypt(blobBase64: string, encKeyBase64: string): string {
  const key = getKey(encKeyBase64);
  const buf = Buffer.from(blobBase64, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('Ciphertext too short');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Deterministic SHA-256 hex digest. Used for idempotency keys. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Generate a 256-bit random token in base64url form. */
export function randomTokenB64Url(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}
