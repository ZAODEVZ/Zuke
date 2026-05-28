import { NextResponse } from 'next/server';
import { issueNonce } from '@/lib/auth/nonce';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const nonce = issueNonce();
    return NextResponse.json({ nonce });
  } catch (error) {
    console.error('[auth/nonce] failed:', error);
    return NextResponse.json({ error: 'Nonce service unavailable' }, { status: 503 });
  }
}
