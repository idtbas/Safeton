import { describe, expect, it } from 'vitest';
import {
  PBKDF2_ITERATIONS,
  assessPassword,
  hashPassword,
  loginBackoffMs,
  verifyPassword,
} from './credentials';

describe('PBKDF2 credentials', () => {
  it('derives a salted hash and verifies only the right password', async () => {
    const cred = await hashPassword('Correct-Horse-42!', 2000);
    expect(cred).toMatchObject({ algorithm: 'PBKDF2-SHA256', iterations: 2000 });
    expect(cred.hash).not.toContain('Correct');
    expect(await verifyPassword('Correct-Horse-42!', cred)).toBe(true);
    expect(await verifyPassword('correct-horse-42!', cred)).toBe(false);
    expect(await verifyPassword('', cred)).toBe(false);
  });

  it('uses a fresh salt for every derivation', async () => {
    const a = await hashPassword('same-Password-1', 1000);
    const b = await hashPassword('same-Password-1', 1000);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('defaults to the OWASP-recommended iteration count', async () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
    const cred = await hashPassword('Correct-Horse-42!');
    expect(cred.iterations).toBe(PBKDF2_ITERATIONS);
    expect(await verifyPassword('Correct-Horse-42!', cred)).toBe(true);
  });

  it('rejects a tampered hash', async () => {
    const cred = await hashPassword('Correct-Horse-42!', 1000);
    const bytes = Uint8Array.from(atob(cred.hash), (c) => c.charCodeAt(0));
    bytes[0]! ^= 1;
    const tampered = { ...cred, hash: btoa(String.fromCharCode(...bytes)) };
    expect(await verifyPassword('Correct-Horse-42!', tampered)).toBe(false);
  });
});

describe('password policy and login backoff', () => {
  it('assesses length, variety, username and common passwords', () => {
    expect(assessPassword('short').problems).toEqual(['tooShort', 'needsVariety']);
    expect(assessPassword('alllowercaseletters').problems).toEqual(['needsVariety']);
    expect(assessPassword('Ada.lovelace-2026', 'ada.lovelace').problems).toEqual(['containsUsername']);
    expect(assessPassword('Password1234!').problems).toContain('common');
    const good = assessPassword('Correct-Horse-42!', 'ada');
    expect(good.problems).toEqual([]);
    expect(good.score).toBeGreaterThanOrEqual(3);
  });

  it('delays repeated failures exponentially up to 30 s', () => {
    expect([1, 2].map(loginBackoffMs)).toEqual([0, 0]);
    expect([3, 4, 5].map(loginBackoffMs)).toEqual([1000, 2000, 4000]);
    expect(loginBackoffMs(20)).toBe(30_000);
  });
});
