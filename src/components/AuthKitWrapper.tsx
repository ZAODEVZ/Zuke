'use client';

import { useMemo } from 'react';
import { AuthKitProvider } from '@farcaster/auth-kit';
import '@farcaster/auth-kit/styles.css';

export function AuthKitWrapper({ children }: { children: React.ReactNode }) {
  const config = useMemo(() => {
    const host = typeof window !== 'undefined' ? window.location.host : 'zuke.thezao.com';
    return {
      rpcUrl:
        process.env.NEXT_PUBLIC_OPTIMISM_RPC_URL ||
        'https://optimism-rpc.publicnode.com',
      domain: host,
      // Explicit, matching `domain`'s authority exactly (bare origin, no
      // path). auth-kit's own default is window.location.href, which on
      // /admin/login includes the /admin/login path - EIP-4361 permits
      // that structurally, but deep research (2026-07-15, see
      // .handoffs/session-2026-07-15-siwf-warpcast-sign-in-failure/) found
      // this domain/uri asymmetry as the leading (medium-confidence,
      // unconfirmed) theory for Warpcast's instant silent "Sign in failed"
      // on submit - consent screen renders fine, only fails at signing.
      siweUri: `https://${host}`,
    };
  }, []);

  return <AuthKitProvider config={config}>{children}</AuthKitProvider>;
}
