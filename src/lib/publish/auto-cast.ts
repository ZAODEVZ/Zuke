import { logger } from '@/lib/logger';

export async function autoCastToZao(text: string, embedUrl?: string): Promise<string | null> {
  logger.info('[auto-cast] stub - would post:', text.slice(0, 60), embedUrl);
  return null;
}
