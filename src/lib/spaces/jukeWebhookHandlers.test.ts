import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyWebhookEvent, parseWebhookEvent } from './jukeWebhookHandlers';

vi.mock('./jukeSpacesDb', () => ({
  updateJukeSpace: vi.fn(),
  bumpParticipantCount: vi.fn(),
  addParticipant: vi.fn(),
  removeParticipant: vi.fn(),
  insertNativeJukeSpace: vi.fn(),
  getJukeSpace: vi.fn().mockResolvedValue({ title: 'Test Space', participants: [] }),
}));
vi.mock('./recordingsDb', () => ({
  countRecordingsForSpace: vi.fn().mockResolvedValue(0),
  insertRecording: vi.fn().mockResolvedValue(null),
}));
vi.mock('./jukeAgentJoin', () => ({
  isAutoAgentJoinEnabled: vi.fn().mockReturnValue(false),
  joinAgentInJukeRoom: vi.fn(),
}));
vi.mock('./juke-api-reads', () => ({
  getJukeRoomDetail: vi.fn().mockResolvedValue({ ok: true, status: 200, data: {}, rateLimit: {} }),
}));
vi.mock('@/lib/env', () => ({
  ENV: { JUKE_API_KEY: 'test-juke-key' },
}));
vi.mock('@/lib/publish/auto-cast', () => ({
  autoCastToZao: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/zuke.config', () => ({
  getBaseUrl: vi.fn().mockReturnValue('https://zuke.thezao.com'),
}));

import {
  updateJukeSpace,
  bumpParticipantCount,
  addParticipant,
  removeParticipant,
  insertNativeJukeSpace,
  getJukeSpace,
} from './jukeSpacesDb';
import { countRecordingsForSpace, insertRecording } from './recordingsDb';
import { getJukeRoomDetail } from './juke-api-reads';
import { autoCastToZao } from '@/lib/publish/auto-cast';

describe('parseWebhookEvent', () => {
  it('reads the 2026-05-23 shape (event_type + data.room_id)', () => {
    const result = parseWebhookEvent({
      event_type: 'room.started',
      event_id: 'evt-1',
      data: { room_id: 'sp-1' },
    });
    expect(result).toEqual({ eventType: 'room.started', spaceId: 'sp-1', eventId: 'evt-1' });
  });

  it('falls back across event/type aliases', () => {
    expect(parseWebhookEvent({ event: 'room.finished', space_id: 'sp-2' }).eventType).toBe(
      'room.finished',
    );
    expect(parseWebhookEvent({ type: 'room.finished', spaceId: 'sp-3' }).eventType).toBe(
      'room.finished',
    );
  });

  it('falls back across spaceId aliases at every nesting level', () => {
    expect(parseWebhookEvent({ space_id: 'a' }).spaceId).toBe('a');
    expect(parseWebhookEvent({ spaceId: 'b' }).spaceId).toBe('b');
    expect(parseWebhookEvent({ data: { roomId: 'c' } }).spaceId).toBe('c');
    expect(parseWebhookEvent({ data: { spaceId: 'd' } }).spaceId).toBe('d');
    expect(parseWebhookEvent({ data: { id: 'e' } }).spaceId).toBe('e');
    expect(parseWebhookEvent({ space: { id: 'f' } }).spaceId).toBe('f');
  });

  it('returns null spaceId/eventId and empty eventType when nothing matches', () => {
    expect(parseWebhookEvent({})).toEqual({ eventType: '', spaceId: null, eventId: null });
    expect(parseWebhookEvent(null)).toEqual({ eventType: '', spaceId: null, eventId: null });
  });
});

describe('applyWebhookEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no-ops silently when spaceId is null (nothing to update)', async () => {
    await applyWebhookEvent('room.started', null, {});
    expect(updateJukeSpace).not.toHaveBeenCalled();
  });

  it('no-ops on an unrecognised event type', async () => {
    await applyWebhookEvent('something.unknown', 'sp-1', {});
    expect(updateJukeSpace).not.toHaveBeenCalled();
    expect(bumpParticipantCount).not.toHaveBeenCalled();
  });

  it('room.started marks the space active with started_at', async () => {
    await applyWebhookEvent('room.started', 'sp-1', { occurred_at: '2026-01-01T00:00:00Z' });
    expect(updateJukeSpace).toHaveBeenCalledWith('sp-1', {
      status: 'active',
      started_at: '2026-01-01T00:00:00Z',
    });
  });

  it('room.finished marks the space ended and fires the recap cast for a host end', async () => {
    await applyWebhookEvent('room.finished', 'sp-1', {
      occurred_at: '2026-01-01T01:00:00Z',
      data: { ended_via: 'host' },
    });
    expect(updateJukeSpace).toHaveBeenCalledWith('sp-1', {
      status: 'ended',
      ended_at: '2026-01-01T01:00:00Z',
    });
    expect(autoCastToZao).toHaveBeenCalledTimes(1);
  });

  it('room.finished stays quiet on an idle empty-room timeout (no ended_via)', async () => {
    await applyWebhookEvent('room.finished', 'sp-1', { occurred_at: '2026-01-01T01:00:00Z' });
    expect(updateJukeSpace).toHaveBeenCalledWith('sp-1', {
      status: 'ended',
      ended_at: '2026-01-01T01:00:00Z',
    });
    expect(autoCastToZao).not.toHaveBeenCalled();
  });

  it('room.ended is treated the same as room.finished', async () => {
    await applyWebhookEvent('room.ended', 'sp-1', { data: { ended_via: 'api' } });
    expect(updateJukeSpace).toHaveBeenCalledWith(
      'sp-1',
      expect.objectContaining({ status: 'ended' }),
    );
  });

  it('participant.joined bumps the count and adds the participant when an fid is present', async () => {
    await applyWebhookEvent('participant.joined', 'sp-1', { data: { fid: 42, role: 'guest' } });
    expect(bumpParticipantCount).toHaveBeenCalledWith('sp-1', 1);
    expect(addParticipant).toHaveBeenCalledWith(
      'sp-1',
      expect.objectContaining({ fid: 42, role: 'guest' }),
    );
  });

  it('participant.joined still bumps the count when no fid is present, but does not add', async () => {
    await applyWebhookEvent('participant.joined', 'sp-1', { data: {} });
    expect(bumpParticipantCount).toHaveBeenCalledWith('sp-1', 1);
    expect(addParticipant).not.toHaveBeenCalled();
  });

  it('participant.left bumps the count down and removes the participant', async () => {
    await applyWebhookEvent('participant.left', 'sp-1', { data: { fid: 42 } });
    expect(bumpParticipantCount).toHaveBeenCalledWith('sp-1', -1);
    expect(removeParticipant).toHaveBeenCalledWith('sp-1', 42);
  });

  it('recording.ready no-ops when the body carries zero parts', async () => {
    await applyWebhookEvent('recording.ready', 'sp-1', {});
    expect(insertRecording).not.toHaveBeenCalled();
    expect(updateJukeSpace).not.toHaveBeenCalled();
  });

  it('recording.ready sets the legacy recording_url from the first part on a fresh space', async () => {
    vi.mocked(countRecordingsForSpace).mockResolvedValueOnce(0);
    await applyWebhookEvent('recording.ready', 'sp-1', {
      data: { parts: [{ url: 'https://cdn/part-1.mp3' }] },
    });
    expect(updateJukeSpace).toHaveBeenCalledWith('sp-1', { recording_url: 'https://cdn/part-1.mp3' });
    expect(insertRecording).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: 'sp-1', url: 'https://cdn/part-1.mp3', partIndex: 0 }),
    );
  });

  it('recording.ready does not clobber recording_url when parts already exist for this space', async () => {
    vi.mocked(countRecordingsForSpace).mockResolvedValueOnce(2);
    await applyWebhookEvent('recording.ready', 'sp-1', {
      data: { parts: [{ url: 'https://cdn/part-3.mp3' }] },
    });
    expect(updateJukeSpace).not.toHaveBeenCalled();
    expect(insertRecording).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://cdn/part-3.mp3', partIndex: 2 }),
    );
  });
});

describe('native rooms (Farcaster-hosted, not created via Zuke)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getJukeRoomDetail).mockResolvedValue({ ok: true, status: 200, data: {}, rateLimit: {} } as never);
  });

  it('room.started backfills a row when the native room has no existing space', async () => {
    vi.mocked(getJukeSpace).mockResolvedValueOnce(null as never);
    vi.mocked(getJukeRoomDetail).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { id: 'sp-native-1', status: 'active', title: 'Real Farcaster Title' },
      rateLimit: { limit: null, remaining: null, resetAtSeconds: null },
    });
    await applyWebhookEvent('room.started', 'sp-native-1', {
      occurred_at: '2026-01-01T00:00:00Z',
      data: { is_farcaster_native: true, host_mode: 'roving', farcaster_host_fid: 777, farcaster_room_id: 'fc-1' },
    });
    expect(insertNativeJukeSpace).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sp-native-1',
        title: 'Real Farcaster Title',
        createdByFid: 777,
        status: 'active',
        startedAt: '2026-01-01T00:00:00Z',
        raw: expect.objectContaining({ is_farcaster_native: true, host_mode: 'roving' }),
      }),
    );
    expect(updateJukeSpace).toHaveBeenCalledWith('sp-native-1', {
      status: 'active',
      started_at: '2026-01-01T00:00:00Z',
    });
  });

  it('room.started does not backfill when a row already exists for the native room', async () => {
    // default getJukeSpace mock resolves truthy - row already exists
    await applyWebhookEvent('room.started', 'sp-native-1', {
      data: { is_farcaster_native: true, farcaster_host_fid: 777 },
    });
    expect(insertNativeJukeSpace).not.toHaveBeenCalled();
  });

  it('room.started does not even check for an existing space on a non-native event', async () => {
    await applyWebhookEvent('room.started', 'sp-1', {});
    expect(getJukeSpace).not.toHaveBeenCalled();
    expect(insertNativeJukeSpace).not.toHaveBeenCalled();
  });

  it('room.finished polls for a recording on a native room and inserts it when ready', async () => {
    vi.mocked(getJukeRoomDetail).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { id: 'sp-native-1', status: 'ended', recording_url: 'https://cdn/native-recap.mp3' },
      rateLimit: { limit: null, remaining: null, resetAtSeconds: null },
    });
    await applyWebhookEvent('room.finished', 'sp-native-1', {
      data: { is_farcaster_native: true },
    });
    expect(insertRecording).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: 'sp-native-1', url: 'https://cdn/native-recap.mp3', source: 'juke' }),
    );
    expect(updateJukeSpace).toHaveBeenCalledWith('sp-native-1', { recording_url: 'https://cdn/native-recap.mp3' });
  });

  it('room.finished does not insert a recording when the native room has none ready yet', async () => {
    vi.mocked(getJukeRoomDetail).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: { id: 'sp-native-1', status: 'ended' },
      rateLimit: { limit: null, remaining: null, resetAtSeconds: null },
    });
    await applyWebhookEvent('room.finished', 'sp-native-1', {
      data: { is_farcaster_native: true },
    });
    expect(insertRecording).not.toHaveBeenCalled();
  });

  it('room.finished never polls Juke at all for a non-native room', async () => {
    await applyWebhookEvent('room.finished', 'sp-1', {});
    expect(getJukeRoomDetail).not.toHaveBeenCalled();
  });
});
