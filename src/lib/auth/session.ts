import { cookies } from 'next/headers';
import { ENV } from '@/lib/env';

export interface SessionData {
  isAdmin: boolean;
  fid?: number;
}

export async function getSessionData(): Promise<SessionData | null> {
  const cookieStore = await cookies();
  const adminCookie = cookieStore.get('zuke_admin');
  if (adminCookie?.value === ENV.ZUKE_ADMIN_PASSWORD && ENV.ZUKE_ADMIN_PASSWORD) {
    return { isAdmin: true };
  }
  return null;
}
