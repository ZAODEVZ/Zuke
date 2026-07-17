import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/env', () => ({ ENV: { SESSION_SECRET: 'test-secret-32-bytes-long-xxxxxx' } }));

import { issueNonce, consumeNonce } from './nonce';

describe('issueNonce', () => {
  it('returns an 80-char lowercase hex string', () => {
    const nonce = issueNonce();
    expect(nonce).toMatch(/^[0-9a-f]{80}$/);
  });

  it('is entirely alphanumeric (no dots or special chars)', () => {
    const nonce = issueNonce();
    expect(/^[a-zA-Z0-9]+$/.test(nonce)).toBe(true);
  });

  it('returns a different nonce each time', () => {
    const a = issueNonce();
    const b = issueNonce();
    expect(a).not.toBe(b);
  });
});

describe('consumeNonce', () => {
  it('accepts a freshly issued nonce', () => {
    const nonce = issueNonce();
    const result = consumeNonce(nonce);
    expect(result.ok).toBe(true);
  });

  it('rejects replay of the same nonce', () => {
    const nonce = issueNonce();
    consumeNonce(nonce);
    const result = consumeNonce(nonce);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('replayed');
  });

  it('rejects a tampered nonce', () => {
    const nonce = issueNonce();
    const tampered = nonce.slice(0, -4) + 'ffff';
    const result = consumeNonce(tampered);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('bad-signature');
  });

  it('rejects a nonce with wrong length', () => {
    expect(consumeNonce('abc123').ok).toBe(false);
    expect(consumeNonce('abc123').reason).toBe('malformed');
  });

  it('rejects a nonce with dots (old format)', () => {
    const result = consumeNonce('aabbccdd.1234567890123.deadbeefdeadbeefdeadbeefdeadbeef');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('malformed');
  });

  it('rejects an expired nonce', () => {
    vi.useFakeTimers();
    const nonce = issueNonce();
    vi.advanceTimersByTime(16 * 60 * 1000); // 16 minutes — past 15-min TTL
    const result = consumeNonce(nonce);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('expired');
    vi.useRealTimers();
  });
});
