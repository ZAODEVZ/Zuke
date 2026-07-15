import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/env', () => ({
  ENV: { SESSION_SECRET: 'test-session-secret-at-least-32-characters-long' },
}));

const mockInsert = vi.fn();
vi.mock('@/lib/db/supabase', () => ({
  supabaseAdmin: { from: vi.fn(() => ({ insert: mockInsert })) },
}));

import { issueNonce, consumeNonce } from './nonce';

describe('issueNonce / consumeNonce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts a freshly issued nonce (DB insert succeeds)', async () => {
    mockInsert.mockResolvedValue({ error: null });
    const nonce = issueNonce();
    const result = await consumeNonce(nonce);
    expect(result).toEqual({ ok: true });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ nonce, expires_at: expect.any(String) }),
    );
  });

  it('rejects a malformed nonce without touching the DB', async () => {
    const result = await consumeNonce('not-a-real-nonce');
    expect(result).toEqual({ ok: false, reason: 'malformed' });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects a nonce with a tampered signature', async () => {
    const nonce = issueNonce();
    const [random, ts] = nonce.split('.');
    const tampered = `${random}.${ts}.${'0'.repeat(32)}`;
    const result = await consumeNonce(tampered);
    expect(result).toEqual({ ok: false, reason: 'bad-signature' });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects an expired nonce without touching the DB', async () => {
    vi.useFakeTimers();
    try {
      const nonce = issueNonce();
      vi.advanceTimersByTime(16 * 60 * 1000); // past the 15-minute TTL
      const result = await consumeNonce(nonce);
      expect(result).toEqual({ ok: false, reason: 'expired' });
      expect(mockInsert).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats a real DB replay (unique-violation) as replayed', async () => {
    mockInsert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } });
    const nonce = issueNonce();
    const result = await consumeNonce(nonce);
    expect(result).toEqual({ ok: false, reason: 'replayed' });
  });

  it('falls back to the in-memory store when the DB call fails for another reason', async () => {
    mockInsert.mockResolvedValue({
      error: { code: 'PGRST205', message: "Could not find the table 'public.auth_nonces'" },
    });
    const nonce = issueNonce();
    const first = await consumeNonce(nonce);
    expect(first).toEqual({ ok: true });

    // Second consume of the SAME nonce, DB still failing the same way - the
    // in-memory fallback should now catch the replay even though the DB
    // never persisted anything.
    const second = await consumeNonce(nonce);
    expect(second).toEqual({ ok: false, reason: 'replayed' });
  });
});
