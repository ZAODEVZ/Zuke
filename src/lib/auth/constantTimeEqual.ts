import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison. Both inputs are SHA-256'd to a fixed
 * 32-byte digest first, so `timingSafeEqual` never throws on a length
 * mismatch and the comparison leaks neither the length nor the content of
 * the configured secret. Extracted from api/juke/space/route.ts so every
 * shared-secret check (admin password, CRON_SECRET, ...) uses the same
 * timing-safe path instead of a plain `===`.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ah = createHash('sha256').update(a).digest();
  const bh = createHash('sha256').update(b).digest();
  return timingSafeEqual(ah, bh);
}
