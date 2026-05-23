import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, sha256Hex } from '../crypto.js';
import { randomBytes } from 'node:crypto';

const KEY = randomBytes(32).toString('base64');

describe('crypto', () => {
  it('round-trips arbitrary strings', () => {
    const plain = 'access-token-deadbeef-' + Math.random();
    const ct = encrypt(plain, KEY);
    expect(ct).not.toEqual(plain);
    expect(decrypt(ct, KEY)).toEqual(plain);
  });

  it('produces different ciphertext each call (random IV)', () => {
    const plain = 'same input';
    const a = encrypt(plain, KEY);
    const b = encrypt(plain, KEY);
    expect(a).not.toEqual(b);
  });

  it('throws on tampered ciphertext', () => {
    const ct = encrypt('hello', KEY);
    const tampered = Buffer.from(ct, 'base64');
    tampered[tampered.length - 1] ^= 0x01;
    expect(() => decrypt(tampered.toString('base64'), KEY)).toThrow();
  });

  it('rejects non-32-byte keys', () => {
    const shortKey = Buffer.alloc(16).toString('base64');
    expect(() => encrypt('x', shortKey)).toThrow(/32 bytes/);
  });

  it('sha256 is deterministic', () => {
    expect(sha256Hex('hello')).toEqual(sha256Hex('hello'));
    expect(sha256Hex('a')).not.toEqual(sha256Hex('b'));
  });
});
