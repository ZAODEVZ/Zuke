/**
 * Tiny URL guards shared by the recordings routes. Pure (no imports) so they
 * are trivially unit-testable and safe to use at any layer.
 */

/**
 * True only for a well-formed `https://` URL. We store user-supplied media URLs
 * (X Space audio, recap video) and render them straight into `<audio src>`,
 * `<video src>`, and `<a href>` — restricting the scheme to https keeps
 * `javascript:`, `data:`, and `file:` out of the DOM, and keeps mixed-content
 * `http:` media from silently failing on the https site.
 */
export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  return url.protocol === 'https:';
}
