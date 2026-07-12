import { logger } from '@/lib/logger';

/**
 * Stub. No @thezao Farcaster signer credential exists in this repo yet (no
 * signer env var is read anywhere in src/lib/env.ts) - posting real casts
 * needs one provisioned first. Always logs-and-no-ops until then; callers
 * treat the null return as "did not post" and continue silently.
 */
export async function autoCastToZao(text: string, embedUrl?: string): Promise<string | null> {
  logger.info('[auto-cast] stub - would post:', text.slice(0, 60), embedUrl);
  return null;
}
