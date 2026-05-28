import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSessionData } from '@/lib/auth/session';
import { AdminConsole } from './AdminConsole';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await getSessionData();
  if (!session?.isAdmin) {
    redirect('/admin/login');
  }

  const isLegacy = session.fid === 0 && session.username === 'legacy-admin';

  return (
    <main className="flex-1 flex flex-col items-center px-4 py-10 bg-[#0a0a14] text-white">
      <div className="w-full max-w-3xl flex flex-col gap-8">
        <header className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <h1 className="text-2xl font-semibold">Zuke Admin</h1>
            <p className="text-sm text-gray-400">
              {isLegacy ? (
                <>
                  Signed in via legacy password. Sign in with Farcaster instead at{' '}
                  <Link href="/admin/login" className="underline text-purple-300">
                    /admin/login
                  </Link>
                  .
                </>
              ) : (
                <>
                  Signed in as{' '}
                  <span className="text-white">
                    {session.displayName || session.username || `fid:${session.fid}`}
                  </span>{' '}
                  (FID {session.fid})
                </>
              )}
            </p>
          </div>
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className="text-xs px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 border border-white/10"
            >
              Sign out
            </button>
          </form>
        </header>

        <AdminConsole />

        <footer className="text-xs text-gray-500 pt-8">
          <Link href="/juke-status" className="underline">
            View raw juke-status
          </Link>{' '}
          ·{' '}
          <Link href="/listen" className="underline">
            Public listen page
          </Link>
        </footer>
      </div>
    </main>
  );
}
