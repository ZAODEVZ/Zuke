export const logger = {
  info: (...args: unknown[]) => console.log('[zuke]', ...args),
  warn: (...args: unknown[]) => console.warn('[zuke]', ...args),
  error: (...args: unknown[]) => console.error('[zuke]', ...args),
};
