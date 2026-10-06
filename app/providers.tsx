"use client";

import { Suspense, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { ThemeProvider } from '../components/ThemeProvider';
import { CartProvider } from '../lib/cart-context';
import { BookmarkProvider } from '../lib/bookmark-context';
import { RecentlyViewedProvider } from '../lib/recently-viewed-context';
import { SessionProvider } from "next-auth/react";

function AppBridgeWrapper({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();

  useEffect(() => {
    searchParams.get('host');
  }, [searchParams]);

  return <>{children}</>;
}

function SmartSessionProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isDashboard =
    pathname?.startsWith('/dashboard') ||
    pathname?.startsWith('/web-store') ||
    pathname?.startsWith('/portal');

  return (
    <SessionProvider
      // Storefront: avoid focus/interval session storms. Dashboard keeps light refresh.
      refetchOnWindowFocus={Boolean(isDashboard)}
      refetchInterval={isDashboard ? 5 * 60 : 0}
    >
      {children}
    </SessionProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <SmartSessionProvider>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem={true}
        >
          <CartProvider>
            <BookmarkProvider>
              <RecentlyViewedProvider>
                <Suspense fallback={null}>
                  <AppBridgeWrapper>{children}</AppBridgeWrapper>
                </Suspense>
              </RecentlyViewedProvider>
            </BookmarkProvider>
          </CartProvider>
        </ThemeProvider>
      </SmartSessionProvider>
    </Suspense>
  );
}
