"use client";

import { usePathname } from "next/navigation";
import StorefrontLayout from "@/components/StorefrontLayout";
import StorefrontFooterClient from "@/components/StorefrontFooterClient";
import { CountryProvider } from "@/lib/country-context";
import type { StorefrontFooterData } from "@/lib/storefront-footer-data";

export default function LayoutWrapper({
  children,
  footerData,
}: {
  children: React.ReactNode;
  /** Plain serializable footer props — never pass a Server Component tree here */
  footerData: StorefrontFooterData;
}) {
  const pathname = usePathname();
  const isAdmin =
    pathname?.startsWith("/dashboard") ||
    pathname?.startsWith("/scanner") ||
    pathname?.startsWith("/portal") ||
    pathname?.startsWith("/web-store") ||
    pathname?.startsWith("/unauthorized");

  if (isAdmin) {
    return <>{children}</>;
  }

  // Render StorefrontFooterClient as a real child of CountryProvider (same React tree).
  // Passing <StorefrontFooter /> (RSC) as a prop used to break hooks during SSR.
  const footer = (
    <StorefrontFooterClient
      shop={footerData.shop}
      policies={footerData.policies}
      socialLinks={footerData.socialLinks}
    />
  );

  return (
    <CountryProvider>
      <StorefrontLayout footer={footer}>{children}</StorefrontLayout>
    </CountryProvider>
  );
}
