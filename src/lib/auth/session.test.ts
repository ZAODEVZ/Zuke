import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCookieStore = {
  get: vi.fn<(name: string) => { value: string } | undefined>(),
};
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));

let mockSession: Record<string, unknown>;
const mockSave = vi.fn();
const mockDestroy = vi.fn();
vi.mock('iron-session', () => ({
  getIronSession: vi.fn(async () => mockSession),
}));

vi.mock('@/lib/env', () => ({
  ENV: {
    SESSION_SECRET: 'test-session-secret-at-least-32-characters-long',
    ZUKE_ADMIN_PASSWORD: '',
    ZUKE_ADMIN_FIDS: [777],
  },
}));

import { getSessionData, saveSession, clearSession, isAdminFid } from './session';
import { ENV } from '@/lib/env';

describe('getSessionData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCookieStore.get.mockReturnValue(undefined);
    mockSession = { save: mockSave, destroy: mockDestroy };
  });

  it('returns null when there is no fid in the iron session and no legacy cookie', async () => {
    const result = await getSessionData();
    expect(result).toBeNull();
  });

  it('returns session data built from a real SIWF session', async () => {
    mockSession = { fid: 42, username: 'zaal', displayName: 'Zaal', pfpUrl: 'https://pfp', isAdmin: true };
    const result = await getSessionData();
    expect(result).toEqual({
      fid: 42,
      username: 'zaal',
      displayName: 'Zaal',
      pfpUrl: 'https://pfp',
      isAdmin: true,
    });
  });

  it('defaults missing optional fields to empty string / false', async () => {
    mockSession = { fid: 42 };
    const result = await getSessionData();
    expect(result).toEqual({ fid: 42, username: '', displayName: '', pfpUrl: '', isAdmin: false });
  });
});

describe('getSessionData - legacy admin cookie', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession = { save: mockSave, destroy: mockDestroy };
  });

  it('is not consulted at all when ZUKE_ADMIN_PASSWORD is unset (default env in this suite)', async () => {
    mockCookieStore.get.mockReturnValue({ value: 'whatever' });
    const result = await getSessionData();
    // No fid on mockSession either, so falls through to null - proves the
    // legacy branch was skipped rather than accidentally matching.
    expect(result).toBeNull();
  });

  it('grants legacy admin when the zuke_admin cookie matches ZUKE_ADMIN_PASSWORD', async () => {
    ENV.ZUKE_ADMIN_PASSWORD = 'correct-horse-battery-staple';
    try {
      mockCookieStore.get.mockReturnValue({ value: 'correct-horse-battery-staple' });
      const result = await getSessionData();
      expect(result).toEqual({
        fid: 0,
        username: 'legacy-admin',
        displayName: 'Legacy Admin',
        pfpUrl: '',
        isAdmin: true,
      });
    } finally {
      ENV.ZUKE_ADMIN_PASSWORD = '';
    }
  });

  it('rejects a zuke_admin cookie that does not match ZUKE_ADMIN_PASSWORD', async () => {
    ENV.ZUKE_ADMIN_PASSWORD = 'correct-horse-battery-staple';
    try {
      mockCookieStore.get.mockReturnValue({ value: 'wrong-password' });
      const result = await getSessionData();
      expect(result).toBeNull();
    } finally {
      ENV.ZUKE_ADMIN_PASSWORD = '';
    }
  });
});

describe('saveSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession = { save: mockSave };
  });

  it('writes fid/username/displayName/pfpUrl and saves', async () => {
    await saveSession({ fid: 1, username: 'u', displayName: 'd', pfpUrl: 'p' });
    expect(mockSession.fid).toBe(1);
    expect(mockSession.username).toBe('u');
    expect(mockSession.displayName).toBe('d');
    expect(mockSession.pfpUrl).toBe('p');
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('sets isAdmin true only when the fid is in ZUKE_ADMIN_FIDS (777 in this suite)', async () => {
    await saveSession({ fid: 777, username: 'u', displayName: 'd', pfpUrl: 'p' });
    expect(mockSession.isAdmin).toBe(true);
  });

  it('sets isAdmin false for a non-admin fid', async () => {
    await saveSession({ fid: 1, username: 'u', displayName: 'd', pfpUrl: 'p' });
    expect(mockSession.isAdmin).toBe(false);
  });
});

describe('clearSession', () => {
  it('destroys the session', async () => {
    mockSession = { destroy: mockDestroy };
    await clearSession();
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});

describe('isAdminFid', () => {
  it('matches an fid in ZUKE_ADMIN_FIDS', () => {
    expect(isAdminFid(777)).toBe(true);
  });

  it('rejects an fid not in ZUKE_ADMIN_FIDS', () => {
    expect(isAdminFid(1)).toBe(false);
  });
});
