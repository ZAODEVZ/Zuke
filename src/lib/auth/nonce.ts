import crypto from 'crypto';
import { ENV } from '@/lib/env';

// SIWE spec (EIP-4361) requires nonces to be entirely alphanumeric.
// We encode the signed nonce as 80 lowercase hex chars: 16B random || 8B timestamp || 16B HMAC.
// No dots, no special chars — Warpcast validates nonce format at signing time.

const NONCE_TTL_MS = 15 * 60 * 1000;
const NONCE_HEX_LEN = 80; // 16 + 8 + 16 bytes = 40 bytes = 80 hex chars

const consumed = new Map<string, number>();
function evict() {
  const now = Date.now();
  for (const [k, expiry] of consumed) {
    if (expiry < now) consumed.delete(k);
  }
}

function hmacBytes(payload: Buffer): Buffer {
  if (!ENV.SESSION_SECRET) throw new Error('SESSION_SECRET not configured');
  return crypto
    .createHmac('sha256', ENV.SESSION_SECRET)
    .update(payload)
    .digest()
    .slice(0, 16);
}

export function issueNonce(): string {
  const random = crypto.randomBytes(16);
  const tsBuf = Buffer.alloc(8);
  tsBuf.writeBigUInt64BE(BigInt(Date.now()));
  const sig = hmacBytes(Buffer.concat([random, tsBuf]));
  return Buffer.concat([random, tsBuf, sig]).toString('hex');
}

export function consumeNonce(nonce: string): { ok: boolean; reason?: string } {
  if (!/^[0-9a-f]{80}$/.test(nonce)) return { ok: false, reason: 'malformed' };

  const buf = Buffer.from(nonce, 'hex');
  const random = buf.subarray(0, 16);
  const tsBuf = buf.subarray(16, 24);
  const sig = buf.subarray(24, 40);

  const expectedSig = hmacBytes(Buffer.concat([random, tsBuf]));
  if (!crypto.timingSafeEqual(sig, expectedSig)) {
    return { ok: false, reason: 'bad-signature' };
  }

  const ts = Number(tsBuf.readBigUInt64BE());
  if (!Number.isFinite(ts) || Date.now() - ts > NONCE_TTL_MS) {
    return { ok: false, reason: 'expired' };
  }

  evict();
  if (consumed.has(nonce)) return { ok: false, reason: 'replayed' };
  consumed.set(nonce, Date.now() + NONCE_TTL_MS);

  return { ok: true };
}
