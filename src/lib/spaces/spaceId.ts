/**
 * A Zuke space id is one of two shapes:
 *   - a native Juke space id (rooms hosted on Juke), or
 *   - an imported X Space, namespaced `x-{xSpaceId}` by {@link zukeIdForXSpace}.
 *
 * Routes that accept a `spaceId` which could belong to EITHER a hosted or an
 * imported space (upload, recap export, recap-video, the `/live/{id}` page)
 * must use {@link isValidSpaceId} rather than `isValidJukeSpaceId`, which only
 * recognizes the hosted shape and would 404 an imported X Space.
 */
import { isValidJukeSpaceId } from './juke';
import { isValidXSpaceId } from './xSpaces';

/** Narrow an untrusted path segment / field to a known Zuke space id shape. */
export function isValidSpaceId(value: unknown): value is string {
  // Keep `value` typed `unknown` through the first guard: a `value is string`
  // predicate applied to an already-`string` would narrow the else path to
  // `never`. The `typeof` check below re-establishes `string` for the X branch.
  if (isValidJukeSpaceId(value)) return true;
  return typeof value === 'string' && value.startsWith('x-') && isValidXSpaceId(value.slice(2));
}

/** True for the imported-X-Space namespace (`x-{xSpaceId}`). */
export function isImportedSpaceId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('x-') && isValidXSpaceId(value.slice(2));
}
