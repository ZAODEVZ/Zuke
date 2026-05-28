import { cache } from 'react';
import { getIronSession, IronSession } from 'iron-session';
import { cookies } from 'next/headers';
import { ENV } from '@/lib/env';

export interface SessionPayload {
  fid?: number;
  username?: string;
  displayName?: string;
  pfpUrl?: string;
  isAdmin?: boolean;
}

export interface SessionData {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string;
  isAdmin: boolean;
}

const isProd = process.env.NODE_ENV === 'production';

function sessionOptions() {
  if (!ENV.SESSION_SECRET || ENV.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must be set and at least 32 characters');
  }
  return {
    password: ENV.SESSION_SECRET,
    cookieName: 'zuke_session',
    cookieOptions: {
      secure: isProd,
      httpOnly: true,
      sameSite: 'lax' as const,
      maxAge: 7 * 24 * 60 * 60,
      path: '/',
    },
  };
}

export async function getSession(): Promise<IronSession<SessionPayload>> {
  const cookieStore = await cookies();
  return getIronSession<SessionPayload>(cookieStore, sessionOptions());
}

export const getSessionData = cache(async (): Promise<SessionData | null> => {
  // Back-compat: keep the legacy zuke_admin password cookie working until the
  // SIWF migration is fully validated. Delete this block + ZUKE_ADMIN_PASSWORD
  // env var after task #71 (rotate secrets) closes.
  if (ENV.ZUKE_ADMIN_PASSWORD) {
    const cookieStore = await cookies();
    const legacy = cookieStore.get('zuke_admin');
    if (legacy?.value === ENV.ZUKE_ADMIN_PASSWORD) {
      return {
        fid: 0,
        username: 'legacy-admin',
        displayName: 'Legacy Admin',
        pfpUrl: '',
        isAdmin: true,
      };
    }
  }

  const session = await getSession();
  if (!session.fid) return null;
  return {
    fid: session.fid,
    username: session.username ?? '',
    displayName: session.displayName ?? '',
    pfpUrl: session.pfpUrl ?? '',
    isAdmin: session.isAdmin ?? false,
  };
});

export async function saveSession(data: {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string;
}) {
  const session = await getSession();
  session.fid = data.fid;
  session.username = data.username;
  session.displayName = data.displayName;
  session.pfpUrl = data.pfpUrl;
  session.isAdmin = ENV.ZUKE_ADMIN_FIDS.includes(data.fid);
  await session.save();
}

export async function clearSession() {
  const session = await getSession();
  session.destroy();
}

export function isAdminFid(fid: number): boolean {
  return ENV.ZUKE_ADMIN_FIDS.includes(fid);
}
