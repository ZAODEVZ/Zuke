import crypto from 'crypto';
import { ENV } from '@/lib/env';

const NONCE_TTL_MS = 15 * 60 * 1000;

const consumed = new Map<string, number>();
function evict() {
  const now = Date.now();
  for (const [k, expiry] of consumed) {
    if (expiry < now) consumed.delete(k);
  }
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

export function consumeNonce(nonce: string): { ok: boolean; reason?: string } {
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

  evict();
  if (consumed.has(nonce)) return { ok: false, reason: 'replayed' };
  consumed.set(nonce, Date.now() + NONCE_TTL_MS);

  return { ok: true };
}
