/**
 * Live-audio provider registry. Resolve a backend by id; default is
 * `'juke'`, which keeps every existing surface (created before rows carried
 * a provider tag) on its current behavior.
 *
 * `juke_spaces.provider` (migration #3) stores which backend owns a row;
 * pass that value through {@link isLiveAudioProviderId} +
 * {@link getLiveAudioProvider} to pick the implementation.
 */
import { hmsProvider } from './hms';
import { jukeProvider } from './juke';
import type { LiveAudioProvider, LiveAudioProviderId } from './types';

export type {
  CreatedRoom,
  CreateRoomInput,
  CreateRoomResult,
  EndRoomResult,
  GetEmbedOptions,
  LiveAudioProvider,
  LiveAudioProviderId,
  RoomEmbed,
} from './types';
export { jukeProvider } from './juke';
export { hmsProvider } from './hms';

/** The backend used when nothing selects one explicitly. */
export const DEFAULT_LIVE_AUDIO_PROVIDER_ID: LiveAudioProviderId = 'juke';

/**
 * Implemented providers. `'stream'` and `'songjam'` are reserved ids with no
 * implementation yet — resolving them throws until they land, rather than
 * silently falling back to Juke for a room Juke does not host.
 */
const REGISTRY: Partial<Record<LiveAudioProviderId, LiveAudioProvider>> = {
  juke: jukeProvider,
  hms: hmsProvider,
};

/** Narrow an untrusted value (query param, DB column) to a known provider id. */
export function isLiveAudioProviderId(value: unknown): value is LiveAudioProviderId {
  return value === 'juke' || value === 'hms' || value === 'stream' || value === 'songjam';
}

/**
 * Resolve a provider by id. `undefined`/`null` (e.g. a row written before
 * migration #3) resolves to the default `'juke'` provider.
 *
 * @throws for a known-but-unimplemented id (`'stream'`, `'songjam'`) so a
 *         mis-tagged row fails loudly instead of hitting the wrong backend.
 */
export function getLiveAudioProvider(
  id?: LiveAudioProviderId | null,
): LiveAudioProvider {
  const resolvedId = id ?? DEFAULT_LIVE_AUDIO_PROVIDER_ID;
  const provider = REGISTRY[resolvedId];
  if (!provider) {
    throw new Error(`Live-audio provider '${resolvedId}' is not implemented yet`);
  }
  return provider;
}
