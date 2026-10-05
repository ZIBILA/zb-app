"use client";

import { usePathname } from "next/navigation";
import StorefrontHeader from "./StorefrontHeader";
import StorefrontNav from "./StorefrontNav";
import { useEffect, useState, Suspense } from "react";
import PageLoader from "./PageLoader";
import { fetchHeaderCollections } from "@/lib/storefront-fetch";

interface StorefrontLayoutProps {
  children: React.ReactNode;
  footer: React.ReactNode;
}

export default function StorefrontLayout({ children, footer }: StorefrontLayoutProps) {
  const pathname = usePathname();
  const [collections, setCollections] = useState<any[]>([]);
  const [isMobileApp, setIsMobileApp] = useState(false);

  useEffect(() => {
    fetchHeaderCollections()
      .then((data) => setCollections(data))
      .catch(() => {});

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('platform') === 'mobile' || params.get('app') === 'true') {
        setIsMobileApp(true);
      }
    }
  }, []);

  // Hide footer on these routes even before mount — avoids hydration/hook crashes on checkout
  const hideFooter =
    !pathname ||
    pathname === "/login" ||
    pathname === "/chat" ||
    pathname === "/support" ||
    pathname.startsWith("/checkout") ||
    pathname.startsWith("/payment");

  return (
    <div className="liquid-glass-body min-h-screen max-w-full text-foreground selection:bg-white/10 transition-colors duration-500">
      <Suspense fallback={null}>
        <PageLoader />
      </Suspense>
      {!isMobileApp && <StorefrontHeader collections={collections} />}
      
      {/* ── Main Content Landmark ── */}
      <main id="main-content" className="relative z-10 w-full overflow-x-clip">
        {children}
      </main>

      {/* ── Footer (passed from server) ── */}
      {!isMobileApp && !hideFooter && footer}
    </div>
  );
}

