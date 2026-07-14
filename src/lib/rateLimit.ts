import { NextRequest } from 'next/server';

/**
 * In-memory fixed-window rate limiter for public write endpoints (import-x,
 * upload, snippet, password-gated space creation) - previously had none.
 *
 * Caveat: state lives in the function instance's memory, not a shared store
 * (no Redis/Upstash configured). On Vercel a warm instance serves many
 * consecutive requests from the same client, so this meaningfully blocks a
 * casual script hammering an endpoint, but a distributed attacker hitting
 * many cold instances in parallel can exceed the limit. Real protection
 * needs Upstash Ratelimit or equivalent shared store - this is a stopgap,
 * not a guarantee.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  return forwardedFor?.split(',')[0]?.trim() ?? 'unknown';
}

export function checkRateLimit(
  request: NextRequest,
  routeName: string,
  opts: { max: number; windowMs: number },
): { limited: boolean; retryAfterSeconds: number } {
  const key = `${routeName}:${clientKey(request)}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { limited: false, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  if (bucket.count > opts.max) {
    return { limited: true, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { limited: false, retryAfterSeconds: 0 };
}
