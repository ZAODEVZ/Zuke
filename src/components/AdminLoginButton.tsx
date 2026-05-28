'use client';

import { useCallback, useEffect, useState } from 'react';
import { SignInButton, type StatusAPIResponse } from '@farcaster/auth-kit';
import { useRouter } from 'next/navigation';

export function AdminLoginButton() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [serverNonce, setServerNonce] = useState<string | undefined>(undefined);

  useEffect(() => {
    const fetchNonce = () =>
      fetch('/api/auth/nonce')
        .then((r) => r.json())
        .then((d) => setServerNonce(d.nonce))
        .catch(() => {});
    fetchNonce();
    const interval = setInterval(fetchNonce, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const handleSuccess = useCallback(
    async (res: StatusAPIResponse) => {
      setError(null);
      setLoading(true);
      try {
        const payload = {
          message: res.message || '',
          signature: res.signature || '',
          nonce: res.nonce || '',
          domain: window.location.host,
        };
        const response = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok || data.error) {
          if (response.status === 403) {
            setError(
              `FID ${data.fid ?? '?'} is not on the Zuke admin list. Ask Zaal to add you.`,
            );
          } else if (response.status === 401) {
            setError(
              'Signature failed verification. Try signing in again.',
            );
          } else {
            setError(data.error || 'Sign-in failed. Try again.');
          }
          setLoading(false);
          fetch('/api/auth/nonce')
            .then((r) => r.json())
            .then((d) => setServerNonce(d.nonce))
            .catch(() => {});
          return;
        }
        router.push(data.redirect || '/admin');
      } catch (err) {
        console.error('login error:', err);
        setError('Network error. Check your connection and try again.');
        setLoading(false);
      }
    },
    [router],
  );

  return (
    <div className="w-full max-w-sm mx-auto flex flex-col items-center gap-4">
      <div className="farcaster-signin-wrapper" key={serverNonce || 'loading'}>
        {serverNonce ? (
          <SignInButton nonce={serverNonce} onSuccess={handleSuccess} />
        ) : (
          <div className="h-10 w-48 rounded-lg bg-gray-800 animate-pulse" />
        )}
      </div>
      {loading && !error && (
        <p className="text-sm text-gray-400">Verifying...</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-400 text-center">
          {error}
        </p>
      )}
    </div>
  );
}
