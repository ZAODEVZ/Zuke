import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const { mockVerifySignInMessage, mockConsumeNonce, mockSaveSession } = vi.hoisted(() => ({
  mockVerifySignInMessage: vi.fn(),
  mockConsumeNonce: vi.fn(),
  mockSaveSession: vi.fn(),
}));
vi.mock('@farcaster/auth-client', () => ({
  createAppClient: vi.fn(() => ({ verifySignInMessage: mockVerifySignInMessage })),
  viemConnector: vi.fn(),
}));
vi.mock('@/lib/auth/nonce', () => ({ consumeNonce: mockConsumeNonce }));
vi.mock('@/lib/auth/session', () => ({ saveSession: mockSaveSession }));

vi.mock('@/lib/env', () => ({
  ENV: {
    ZUKE_ADMIN_FIDS: [777],
    NEYNAR_API_KEY: '',
    OPTIMISM_RPC_URL: 'https://optimism-rpc.publicnode.com',
  },
}));

import { POST } from './route';

const VALID_BODY = {
  message: 'zuke.thezao.com wants you to sign in...',
  signature: '0xdeadbeef',
  nonce: 'a-nonce',
  domain: 'zuke.thezao.com',
};

function req(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

describe('POST /api/auth/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConsumeNonce.mockReturnValue({ ok: true });
  });

  it('rejects a malformed body before touching nonce/SIWF at all', async () => {
    const res = await POST(req({ message: 'x' })); // missing signature/nonce/domain
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid input');
    expect(mockConsumeNonce).not.toHaveBeenCalled();
    expect(mockVerifySignInMessage).not.toHaveBeenCalled();
  });

  it('rejects an invalid/replayed nonce without calling SIWF', async () => {
    mockConsumeNonce.mockReturnValue({ ok: false, reason: 'replayed' });
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('replayed');
    expect(mockVerifySignInMessage).not.toHaveBeenCalled();
  });

  it('returns 503 if the SIWF RPC call itself throws', async () => {
    mockVerifySignInMessage.mockRejectedValue(new Error('RPC down'));
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(503);
  });

  it('returns 401 on an invalid signature', async () => {
    mockVerifySignInMessage.mockResolvedValue({ success: false, isError: true });
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Invalid signature');
  });

  it('returns 502 if verification succeeds but no fid comes back', async () => {
    mockVerifySignInMessage.mockResolvedValue({ success: true, isError: false, fid: undefined });
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(502);
  });

  it('returns 403 for a real, verified fid that is not an admin', async () => {
    mockVerifySignInMessage.mockResolvedValue({ success: true, isError: false, fid: 1 });
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('not authorized');
    expect(mockSaveSession).not.toHaveBeenCalled();
  });

  it('saves a session and returns success for a verified admin fid (no Neynar key)', async () => {
    mockVerifySignInMessage.mockResolvedValue({ success: true, isError: false, fid: 777 });
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, redirect: '/admin' });
    expect(mockSaveSession).toHaveBeenCalledWith({
      fid: 777,
      username: '',
      displayName: 'fid:777',
      pfpUrl: '',
    });
  });

  it('enriches the session with a real Neynar profile when NEYNAR_API_KEY is set', async () => {
    const { ENV } = await import('@/lib/env');
    ENV.NEYNAR_API_KEY = 'test-key';
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        users: [{ username: 'zaal', display_name: 'Zaal', pfp_url: 'https://pfp' }],
      }),
    } as Response);
    try {
      mockVerifySignInMessage.mockResolvedValue({ success: true, isError: false, fid: 777 });
      const res = await POST(req(VALID_BODY));
      expect(res.status).toBe(200);
      expect(mockSaveSession).toHaveBeenCalledWith({
        fid: 777,
        username: 'zaal',
        displayName: 'Zaal',
        pfpUrl: 'https://pfp',
      });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('fids=777'),
        expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'test-key' }) }),
      );
    } finally {
      ENV.NEYNAR_API_KEY = '';
      fetchMock.mockRestore();
    }
  });

  it('returns 500 if saveSession throws', async () => {
    mockVerifySignInMessage.mockResolvedValue({ success: true, isError: false, fid: 777 });
    mockSaveSession.mockRejectedValue(new Error('DB down'));
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Could not create session. Please try again.');
  });
});
