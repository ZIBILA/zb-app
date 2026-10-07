import prisma, { getShopSettings } from "@/lib/db";

export type StorefrontFooterData = {
  shop: {
    domain: string;
    instagramUrl?: string;
    appleUrl?: string;
    spotifyUrl?: string;
    youtubeUrl?: string;
    footerLogo3dUrl?: string;
    footerVideo?: string;
  } | null;
  policies: { handle: string; title: string }[];
  socialLinks: Array<{
    id: string;
    platform: string;
    label: string;
    url: string;
    placements: string[];
  }>;
};

/** Server-side data load — plain JSON safe for Client Component props. */
export async function getStorefrontFooterData(): Promise<StorefrontFooterData> {
  let shop: StorefrontFooterData["shop"] = null;
  let policies: StorefrontFooterData["policies"] = [];
  let socialLinks: StorefrontFooterData["socialLinks"] = [];

  try {
    const [shopData, policiesData, socialLinksData] = await Promise.all([
      getShopSettings().catch(() => null),
      prisma.policy
        .findMany({
          select: { handle: true, title: true },
          orderBy: { title: "asc" },
        })
        .catch(() => []),
      prisma.storeSettings
        .findUnique({
          where: { pageKey: "social_links" },
        })
        .catch(() => null),
    ]);

    if (shopData) {
      shop = {
        domain: String((shopData as any).domain || ""),
        instagramUrl: (shopData as any).instagramUrl || undefined,
        appleUrl: (shopData as any).appleUrl || undefined,
        spotifyUrl: (shopData as any).spotifyUrl || undefined,
        youtubeUrl: (shopData as any).youtubeUrl || undefined,
        footerLogo3dUrl: (shopData as any).footerLogo3dUrl || undefined,
        footerVideo: (shopData as any).footerVideo || undefined,
      };
    }

    policies = (policiesData as any[]).map((p) => ({
      handle: p.handle,
      title: p.title,
    }));

    if (socialLinksData?.metaDescription) {
      try {
        socialLinks = JSON.parse(socialLinksData.metaDescription);
      } catch {
        // ignore bad JSON
      }
    }
  } catch (error: any) {
    console.warn("[Footer] Error querying settings/policies:", error?.message || error);
  }

  return { shop, policies, socialLinks };
}
