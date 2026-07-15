import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAppClient, viemConnector } from '@farcaster/auth-client';
import { consumeNonce } from '@/lib/auth/nonce';
import { saveSession } from '@/lib/auth/session';
import { ENV } from '@/lib/env';

const verifySchema = z.object({
  message: z.string().min(1),
  signature: z.string().min(1),
  nonce: z.string().min(1),
  domain: z.string().min(1),
});

let _appClient: ReturnType<typeof createAppClient> | null = null;
function getAppClient() {
  if (!_appClient) {
    _appClient = createAppClient({
      ethereum: viemConnector({ rpcUrl: ENV.OPTIMISM_RPC_URL }),
    });
  }
  return _appClient;
}

async function fetchNeynarProfile(fid: number): Promise<{
  username: string;
  displayName: string;
  pfpUrl: string;
} | null> {
  const key = ENV.NEYNAR_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(
      `https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`,
      { headers: { 'x-api-key': key, accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const j = await res.json();
    const u = j?.users?.[0];
    if (!u) return null;
    return {
      username: u.username ?? '',
      displayName: u.display_name ?? u.username ?? `fid:${fid}`,
      pfpUrl: u.pfp_url ?? '',
    };
  } catch (err) {
    console.error('[auth/verify] neynar fetch failed:', err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = verifySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { message, signature, nonce, domain } = parsed.data;

    const nonceCheck = await consumeNonce(nonce);
    if (!nonceCheck.ok) {
      return NextResponse.json(
        { error: `Invalid nonce: ${nonceCheck.reason}. Please try signing in again.` },
        { status: 400 },
      );
    }

    let result;
    try {
      result = await getAppClient().verifySignInMessage({
        message,
        signature: signature as `0x${string}`,
        nonce,
        domain,
      });
    } catch (verifyError) {
      console.error('[auth/verify] SIWF RPC error:', verifyError);
      return NextResponse.json(
        { error: 'Verification service temporarily unavailable. Please try again.' },
        { status: 503 },
      );
    }

    if (result.isError || !result.success) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const fid = result.fid;
    if (!fid || typeof fid !== 'number') {
      return NextResponse.json(
        { error: 'Verification succeeded but no Farcaster ID returned.' },
        { status: 502 },
      );
    }

    if (!ENV.ZUKE_ADMIN_FIDS.includes(fid)) {
      return NextResponse.json(
        { error: 'Your Farcaster account is not authorized as a Zuke admin.', fid },
        { status: 403 },
      );
    }

    const profile = (await fetchNeynarProfile(fid)) ?? {
      username: '',
      displayName: `fid:${fid}`,
      pfpUrl: '',
    };

    try {
      await saveSession({
        fid,
        username: profile.username,
        displayName: profile.displayName,
        pfpUrl: profile.pfpUrl,
      });
    } catch (sessionErr) {
      console.error('[auth/verify] saveSession failed:', sessionErr);
      return NextResponse.json(
        { error: 'Could not create session. Please try again.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, redirect: '/admin' });
  } catch (error) {
    console.error('[auth/verify] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
