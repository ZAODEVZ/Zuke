import crypto from 'crypto';
import { ENV } from '@/lib/env';
import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/db/supabase';

const NONCE_TTL_MS = 15 * 60 * 1000;

/**
 * In-memory fallback replay store. Used automatically if the auth_nonces
 * table (scripts/auth-nonces-migration-1.sql) hasn't been applied yet, or
 * on any other DB error - see consumeNonce(). Only replay-protects within a
 * single warm Vercel instance when running in this mode.
 */
const memoryConsumed = new Map<string, number>();
function evictMemory() {
  const now = Date.now();
  for (const [k, expiry] of memoryConsumed) {
    if (expiry < now) memoryConsumed.delete(k);
  }
}
function consumeInMemory(nonce: string): { ok: boolean; reason?: string } {
  evictMemory();
  if (memoryConsumed.has(nonce)) return { ok: false, reason: 'replayed' };
  memoryConsumed.set(nonce, Date.now() + NONCE_TTL_MS);
  return { ok: true };
}

function hmac(payload: string): string {
  if (!ENV.SESSION_SECRET) throw new Error('SESSION_SECRET not configured');
  return crypto
    .createHmac('sha256', ENV.SESSION_SECRET)
    .update(payload)
    .digest('hex')
    .slice(0, 32);
}

export function issueNonce(): string {
  const random = crypto.randomBytes(16).toString('hex');
  const ts = Date.now().toString();
  const sig = hmac(`${random}.${ts}`);
  return `${random}.${ts}.${sig}`;
}

/**
 * Verify a nonce's signature + TTL, then atomically claim it via a shared
 * DB store so replay protection works across every Vercel instance, not
 * just the one that happens to serve a given request.
 *
 * Falls back to an in-memory store (same behavior as before this change)
 * if auth_nonces doesn't exist yet or the DB call fails for any other
 * reason - see scripts/auth-nonces-migration-1.sql for why this fallback
 * exists and is safe.
 */
export async function consumeNonce(nonce: string): Promise<{ ok: boolean; reason?: string }> {
  const parts = nonce.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [random, ts, sig] = parts;

  const expected = hmac(`${random}.${ts}`);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return { ok: false, reason: 'bad-signature' };
  }

  const issued = parseInt(ts, 10);
  if (!Number.isFinite(issued) || Date.now() - issued > NONCE_TTL_MS) {
    return { ok: false, reason: 'expired' };
  }

  const expiresAt = new Date(Date.now() + NONCE_TTL_MS).toISOString();
  const { error } = await supabaseAdmin.from('auth_nonces').insert({ nonce, expires_at: expiresAt });

  if (!error) return { ok: true };

  // Unique-violation on the primary key means a real replay - trust it.
  if ((error as { code?: string }).code === '23505') {
    return { ok: false, reason: 'replayed' };
  }

  // Anything else (table missing, network blip, etc) - degrade to the
  // in-memory store rather than fail every signin.
  logger.warn('[auth/nonce] auth_nonces DB check failed, falling back to in-memory (non-fatal):', error);
  return consumeInMemory(nonce);
}
