/**
 * Zuke product config. `baseUrl` is a derived value - resolve via
 * {@link getBaseUrl} so server + client code agrees on the canonical host.
 * Production now serves on the custom domain (zuke.thezao.com); set
 * `NEXT_PUBLIC_SITE_URL` explicitly to pin that value if Vercel's own
 * production-alias env vars don't already reflect it.
 *
 * Resolution order:
 *  1. NEXT_PUBLIC_SITE_URL  - explicit override for prod
 *  2. VERCEL_PROJECT_PRODUCTION_URL - Vercel-provided prod alias
 *  3. VERCEL_URL            - deployment-specific preview alias
 *  4. fallback              - zuke-sandy.vercel.app (pre-custom-domain prod alias)
 */
export const zukeConfig = {
  name: 'Zuke',
  brandColor: '#855dcd',
  juke_path_a_route: '/live/[spaceId]',
  juke_path_b_route: '/live/create',
  public_status_route: '/juke-status',
} as const;

const FALLBACK_BASE_URL = 'https://zuke-sandy.vercel.app';

export function getBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const prodAlias = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prodAlias) return `https://${prodAlias}`;
  const deploymentUrl = process.env.VERCEL_URL;
  if (deploymentUrl) return `https://${deploymentUrl}`;
  return FALLBACK_BASE_URL;
}
