import StorefrontFooterClient from "./StorefrontFooterClient";
import { getStorefrontFooterData } from "@/lib/storefront-footer-data";

export { getStorefrontFooterData } from "@/lib/storefront-footer-data";
export type { StorefrontFooterData } from "@/lib/storefront-footer-data";

/** Optional direct render (e.g. pages that don't use LayoutWrapper). */
export default async function StorefrontFooter() {
  const data = await getStorefrontFooterData();
  return (
    <StorefrontFooterClient
      shop={data.shop}
      policies={data.policies}
      socialLinks={data.socialLinks}
    />
  );
}
