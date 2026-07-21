import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { jukeEmbedUrl, jukeSpaceUrl } from '../juke';
import { hmsProvider } from './hms';
import { jukeProvider } from './juke';
import {
  DEFAULT_LIVE_AUDIO_PROVIDER_ID,
  getLiveAudioProvider,
  isLiveAudioProviderId,
} from './index';

describe('provider registry', () => {
  it('defaults to the juke provider', () => {
    expect(DEFAULT_LIVE_AUDIO_PROVIDER_ID).toBe('juke');
    expect(getLiveAudioProvider().provider).toBe('juke');
    expect(getLiveAudioProvider(null).provider).toBe('juke');
    expect(getLiveAudioProvider(undefined)).toBe(jukeProvider);
  });

  it('resolves implemented providers by id', () => {
    expect(getLiveAudioProvider('juke')).toBe(jukeProvider);
    expect(getLiveAudioProvider('hms')).toBe(hmsProvider);
  });

  it('throws for reserved-but-unimplemented ids instead of falling back', () => {
    expect(() => getLiveAudioProvider('stream')).toThrow(/not implemented/);
    expect(() => getLiveAudioProvider('songjam')).toThrow(/not implemented/);
  });

  it('narrows untrusted values to known provider ids', () => {
    expect(isLiveAudioProviderId('juke')).toBe(true);
    expect(isLiveAudioProviderId('hms')).toBe(true);
    expect(isLiveAudioProviderId('stream')).toBe(true);
    expect(isLiveAudioProviderId('songjam')).toBe(true);
    expect(isLiveAudioProviderId('twitch')).toBe(false);
    expect(isLiveAudioProviderId('')).toBe(false);
    expect(isLiveAudioProviderId(42)).toBe(false);
    expect(isLiveAudioProviderId(null)).toBe(false);
  });
});

describe('juke provider', () => {
  it('carries the juke literal id', () => {
    expect(jukeProvider.provider).toBe('juke');
  });

  it('validates room ids with the existing Juke rules', () => {
    expect(jukeProvider.isValidRoomId('zao-live_42')).toBe(true);
    expect(jukeProvider.isValidRoomId('bad/../id')).toBe(false);
    expect(jukeProvider.isValidRoomId(42)).toBe(false);
  });

  it('getEmbed matches the existing juke URL helpers exactly', async () => {
    const embed = await jukeProvider.getEmbed('zao-live-42');
    expect(embed.provider).toBe('juke');
    expect(embed.embedUrl).toBe(jukeEmbedUrl('zao-live-42'));
    expect(embed.pageUrl).toBe(jukeSpaceUrl('zao-live-42'));
    expect(embed.deeplinkUrl).toBe('https://juke.audio/space/zao-live-42?open=app');
    expect(embed.ogImageUrl).toBe('https://juke.audio/space/zao-live-42/opengraph-image');
  });

  it('getEmbed forwards audioOff and partnerToken options', async () => {
    const embed = await jukeProvider.getEmbed('abc123', {
      audioOff: true,
      partnerToken: 'tok',
    });
    expect(embed.embedUrl).toBe(jukeEmbedUrl('abc123', { audioOff: true, partnerToken: 'tok' }));
  });

  it('getEmbed rejects an invalid room id', async () => {
    await expect(jukeProvider.getEmbed('bad/../id')).rejects.toThrow(/Invalid Juke space id/);
  });

  it('createRoom reports 503 when JUKE_API_KEY is not configured', async () => {
    // ENV.JUKE_API_KEY is '' in the test environment.
    const result = await jukeProvider.createRoom({ title: 'Test space' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.error).toMatch(/JUKE_API_KEY/);
    }
  });

  it('endRoom rejects an invalid room id before any upstream call', async () => {
    const result = await jukeProvider.endRoom('bad/../id');
    expect(result).toEqual({ ok: false, status: 400, error: 'Invalid Juke space id' });
  });

  it('endRoom reports 503 when JUKE_API_KEY is not configured', async () => {
    const result = await jukeProvider.endRoom('abc123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(503);
  });
});

describe('hms provider (real implementation)', () => {
  // Real 100ms room ids are 24 lowercase hex chars - 'abc123' never matches.
  const VALID_ROOM_ID = 'a'.repeat(24);
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.HMS_ACCESS_KEY;
    delete process.env.HMS_APP_SECRET;
    delete process.env.HMS_WEBHOOK_SECRET;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('carries the hms literal id', () => {
    expect(hmsProvider.provider).toBe('hms');
  });

  it('isValidRoomId only accepts 24-char lowercase hex ids', () => {
    expect(hmsProvider.isValidRoomId('abc123')).toBe(false);
    expect(hmsProvider.isValidRoomId(VALID_ROOM_ID)).toBe(true);
  });

  it('createRoom reports 503 when HMS_ACCESS_KEY/HMS_APP_SECRET are not configured', async () => {
    const created = await hmsProvider.createRoom({ title: 'Test room' });
    expect(created).toMatchObject({ ok: false, status: 503 });
  });

  it('endRoom rejects an invalid room id with 400 before ever checking config', async () => {
    const ended = await hmsProvider.endRoom('abc123');
    expect(ended).toMatchObject({ ok: false, status: 400 });
  });

  it('endRoom reports 503 for a valid-format room id when not configured', async () => {
    const ended = await hmsProvider.endRoom(VALID_ROOM_ID);
    expect(ended).toMatchObject({ ok: false, status: 503 });
  });

  it('getEmbed throws for an invalid room id', async () => {
    await expect(hmsProvider.getEmbed('abc123')).rejects.toThrow(/Invalid HMS room id/);
  });

  it('handleWebhook returns 500 when HMS_WEBHOOK_SECRET is not configured', async () => {
    const res = await hmsProvider.handleWebhook(
      new Request('http://localhost/api/live/webhooks/hms', { method: 'POST', body: '{}' }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/HMS_WEBHOOK_SECRET/);
  });

  it('handleWebhook returns 401 for an unauthenticated delivery once a secret is configured', async () => {
    process.env.HMS_WEBHOOK_SECRET = 'test-webhook-secret';
    const res = await hmsProvider.handleWebhook(
      new Request('http://localhost/api/live/webhooks/hms', { method: 'POST', body: '{}' }),
    );
    expect(res.status).toBe(401);
  });
});
