import { redirect } from 'next/navigation';
import { getSessionData } from '@/lib/auth/session';
import { AdminLoginButton } from '@/components/AdminLoginButton';

export const dynamic = 'force-dynamic';

export default async function AdminLoginPage() {
  const session = await getSessionData();
  if (session?.isAdmin) {
    redirect('/admin');
  }

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 bg-[#0a0a14] text-white">
      <div className="w-full max-w-md flex flex-col items-center gap-6 text-center">
        <h1 className="text-3xl font-semibold">Zuke Admin</h1>
        <p className="text-sm text-gray-400">
          Sign in with Farcaster to manage spaces, webhooks, and recordings.
          Only allowlisted FIDs can access this dashboard.
        </p>
        <AdminLoginButton />
        <p className="text-xs text-gray-600">
          Not on the list? Ping @bettercallzaal on Farcaster.
        </p>
      </div>
    </main>
  );
}
