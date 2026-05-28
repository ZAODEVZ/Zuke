import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { clearSession } from '@/lib/auth/session';

export async function POST() {
  try {
    await clearSession();
    const cookieStore = await cookies();
    cookieStore.delete('zuke_admin');
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[auth/logout] error:', error);
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 });
  }
}
