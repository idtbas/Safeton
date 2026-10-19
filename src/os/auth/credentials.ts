/**
 * Local administrator credentials for the simulated login.
 *
 * Passwords never leave the browser and are never stored in clear text: they are derived with
 * PBKDF2-HMAC-SHA-256 (Web Crypto) and a random 128-bit salt. This protects the simulated
 * console against casual inspection only — it is not an authentication system for real
 * infrastructure (there is none behind it).
 */
import { z } from 'zod';

export const PBKDF2_ITERATIONS = 600_000;
export const ACCOUNT_SCHEMA_VERSION = 1;

export const ROLES = ['infrastructure-admin', 'site-reliability', 'operator'] as const;
export type Role = (typeof ROLES)[number];

export const credentialSchema = z.object({
  algorithm: z.literal('PBKDF2-SHA256'),
  iterations: z.number().int().min(1000),
  salt: z.string().min(16),
  hash: z.string().min(32),
});
export type StoredCredential = z.infer<typeof credentialSchema>;

export const accountSchema = z.object({
  username: z.string().regex(/^[a-z_][a-z0-9_.-]{1,31}$/),
  displayName: z.string().min(1).max(80),
  role: z.enum(ROLES),
  credential: credentialSchema,
  createdAt: z.string(),
});
export type Account = z.infer<typeof accountSchema>;

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(
  password: string,
  iterations = PBKDF2_ITERATIONS,
): Promise<StoredCredential> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations);
  return { algorithm: 'PBKDF2-SHA256', iterations, salt: toB64(salt), hash: toB64(hash) };
}

export async function verifyPassword(password: string, cred: StoredCredential): Promise<boolean> {
  const expected = fromB64(cred.hash);
  const actual = await derive(password, fromB64(cred.salt), cred.iterations);
  if (actual.length !== expected.length) return false;
  // Constant-time comparison.
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}

export interface PasswordAssessment {
  /** 0 (unusable) … 4 (strong) */
  score: 0 | 1 | 2 | 3 | 4;
  /** Reasons the password does not meet the policy (i18n keys). */
  problems: ('tooShort' | 'needsVariety' | 'containsUsername' | 'common')[];
}

const COMMON = new Set([
  'password',
  'passwort',
  '12345678',
  'qwertzui',
  'qwertyui',
  'admin123',
  'safeton1',
  'letmein1',
]);

/** Policy: ≥ 12 characters, ≥ 3 character classes, not containing the username. */
export function assessPassword(password: string, username = ''): PasswordAssessment {
  const problems: PasswordAssessment['problems'] = [];
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (password.length < 12) problems.push('tooShort');
  if (classes < 3) problems.push('needsVariety');
  if (username.length >= 3 && password.toLowerCase().includes(username.toLowerCase()))
    problems.push('containsUsername');
  if (COMMON.has(password.toLowerCase().slice(0, 8))) problems.push('common');
  let score = Math.min(4, Math.floor(password.length / 6) + classes - 2);
  if (problems.length > 0) score = Math.min(score, 1);
  return { score: Math.max(0, score) as PasswordAssessment['score'], problems };
}

/** Delay before the next login attempt is accepted after `failures` consecutive failures. */
export function loginBackoffMs(failures: number): number {
  if (failures < 3) return 0;
  return Math.min(30_000, 1000 * 2 ** (failures - 3));
}
