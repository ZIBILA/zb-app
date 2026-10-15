import { NextResponse } from 'next/server';
import prisma, { getShopSettings } from '@/lib/db';
import {
  DEFAULT_PDP_INCL_TAXES_TEXT,
  DEFAULT_PDP_MODEL_INFO,
  parsePdpTrustBoxes,
} from '@/lib/pdp-trust-defaults';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const shop = await getShopSettings();

    if (!shop) {
      return NextResponse.json({ error: 'Store configuration not found' }, { status: 404 });
    }

    const socialLinksData = await prisma.storeSettings.findUnique({
      where: { pageKey: 'social_links' }
    }).catch(() => null);

    // Parse JSON fields safely
    const safeJsonParse = (val: string | null | undefined, fallback: any = []) => {
      if (!val) return fallback;
      try {
        return JSON.parse(val);
      } catch {
        return fallback;
      }
    };

    // Return null for empty strings so the RN app shows nothing when no value is set
    // This prevents hardcoded fallback text from appearing when admin clears a field
    const nullIfEmpty = (val: string | null | undefined): string | null => {
      if (val === undefined || val === null) return null;
      if (typeof val === 'string' && val.trim() === '') return null;
      return val;
    };

    const s = shop as any;

    let instagram = nullIfEmpty(s.instagramUrl);
    let apple = nullIfEmpty(s.appleUrl);
    let spotify = nullIfEmpty(s.spotifyUrl);
    let youtube = nullIfEmpty(s.youtubeUrl);
    let tiktok: string | null = null;
    let twitter: string | null = null;
    let facebook: string | null = null;
    let pinterest: string | null = null;

    if (socialLinksData?.metaDescription) {
      try {
        const parsed = JSON.parse(socialLinksData.metaDescription);
        if (Array.isArray(parsed)) {
          const instaItem = parsed.find((l: any) => l.platform === 'instagram' && (l.placements.includes('app') || l.placements.includes('mobile')));
          const appleItem = parsed.find((l: any) => l.platform === 'apple' && (l.placements.includes('app') || l.placements.includes('mobile')));
          const spotifyItem = parsed.find((l: any) => l.platform === 'spotify' && (l.placements.includes('app') || l.placements.includes('mobile')));
          const youtubeItem = parsed.find((l: any) => l.platform === 'youtube' && (l.placements.includes('app') || l.placements.includes('mobile')));
          const tiktokItem = parsed.find((l: any) => l.platform === 'tiktok' && (l.placements.includes('app') || l.placements.includes('mobile')));
          const twitterItem = parsed.find((l: any) => (l.platform === 'twitter' || l.platform === 'x') && (l.placements.includes('app') || l.placements.includes('mobile')));
          const facebookItem = parsed.find((l: any) => l.platform === 'facebook' && (l.placements.includes('app') || l.placements.includes('mobile')));
          const pinterestItem = parsed.find((l: any) => l.platform === 'pinterest' && (l.placements.includes('app') || l.placements.includes('mobile')));

          if (instaItem) instagram = instaItem.url || null;
          if (appleItem) apple = appleItem.url || null;
          if (spotifyItem) spotify = spotifyItem.url || null;
          if (youtubeItem) youtube = youtubeItem.url || null;
          if (tiktokItem) tiktok = tiktokItem.url || null;
          if (twitterItem) twitter = twitterItem.url || null;
          if (facebookItem) facebook = facebookItem.url || null;
          if (pinterestItem) pinterest = pinterestItem.url || null;
        }
      } catch (err) {
        console.error('[App API config social parsing failed]:', err);
      }
    }

    const config = {
      hero: {
        image: nullIfEmpty(s.heroImage),
        video: nullIfEmpty(s.heroVideo),
        title: nullIfEmpty(s.heroTitle),
        subtitle: nullIfEmpty(s.heroSubtitle),
        buttonText: nullIfEmpty(s.heroButtonText),
        showText: s.showHeroText,
      },
      latestCuration: {
        title: nullIfEmpty(s.latestCurationTitle),
        subtitle: nullIfEmpty(s.latestCurationSubtitle),
        show: s.showLatestCuration,
      },
      archive: {
        title: nullIfEmpty(s.archiveTitle),
        subtitle: nullIfEmpty(s.archiveSubtitle),
        show: s.showArchive,
        video: nullIfEmpty(s.collectionsMedia),  // archive video = collectionsMedia field
      },
      blueprint: {
        title: nullIfEmpty(s.blueprintTitle),
        subtitle: nullIfEmpty(s.blueprintSubtitle),
        show: s.showBlueprint,
        image: nullIfEmpty(s.featuredMediaImage),
      },
      pdp: {
        showProductVideo: s.showProductVideo,
        showSizeChart: s.showSizeChart,
        showBrand: s.showBrand,
        showShippingReturn: s.showShippingReturn,
        showCare: s.showCare,
        showSizeFit: s.showSizeFit,
        showDetails: s.showDetails,
        background: nullIfEmpty(s.pdpBackground),
        trustBoxes: parsePdpTrustBoxes(s.pdpTrustBoxes),
        inclTaxesText: nullIfEmpty(s.pdpInclTaxesText) || DEFAULT_PDP_INCL_TAXES_TEXT,
        showInclTaxes: s.pdpShowInclTaxes !== false,
        modelInfoDefault: nullIfEmpty(s.pdpModelInfoDefault) || DEFAULT_PDP_MODEL_INFO,
      },
      social: {
        instagram,
        apple,
        spotify,
        youtube,
        tiktok,
        twitter,
        facebook,
        pinterest,
      },
      media: {
        featured: nullIfEmpty(s.featuredMedia),
        featuredImage: nullIfEmpty(s.featuredMediaImage),
        featuredLink: nullIfEmpty(s.featuredMediaLink),
        collections: nullIfEmpty(s.collectionsMedia),
        collectionsLink: nullIfEmpty(s.collectionsMediaLink),
        footer: nullIfEmpty(s.footerVideo),
        footerLogo3dUrl: s.footerLogo3dUrl || 'https://cdn.shopify.com/3d/models/e024b09e83a75c03/Zicabella-silver-logo.glb',
      },
      navigation: {
        mainMenu: s.mainMenuHandle,
        secondaryMenu: s.secondaryMenuHandle,
        enabledCollectionsHeader: safeJsonParse(s.enabledCollectionsHeader),
        enabledCollectionsPage: safeJsonParse(s.enabledCollectionsPage),
        enabledCollectionsMenu: safeJsonParse(s.enabledCollectionsMenu),
      },
      features: {
        showTreeText: s.showTreeText,
        kineticMeshProducts: safeJsonParse(s.kineticMeshProducts),
        kineticMeshTitle: nullIfEmpty(s.kineticMeshTitle),
      },
      community: {
        title: nullIfEmpty(s.communityTitle),
        subtitle: nullIfEmpty(s.communitySubtitle),
        show: s.showCommunity,
        ageRestricted: s.communityAgeRestricted,
        minOrders: s.communityMinOrders,
        whatsAppEnabled: s.communityWhatsAppEnabled,
      },
      spotlight: {
        title: nullIfEmpty(s.spotlightTitle),
        subtitle: nullIfEmpty(s.spotlightSubtitle),
        collection: s.spotlightCollection || null,
        products: safeJsonParse(s.spotlightProducts),
        media: s.spotlightMedia || null,
      },
      homepage: {
        collection: s.homepageCollection || null,
        products: s.homepageProducts || null,
      },
      flipbook: {
        config: safeJsonParse(s.flipbookConfig),
        desc: nullIfEmpty(s.flipbookDesc),
        image: nullIfEmpty(s.flipbookImage),
        tag: nullIfEmpty(s.flipbookTag),
        title: nullIfEmpty(s.flipbookTitle),
        video: nullIfEmpty(s.flipbookVideo),
      },
      ringCarousel: {
        items: safeJsonParse(s.ringCarouselItems),
        title: nullIfEmpty(s.ringCarouselTitle),
        show: s.showRingCarousel,
      }
    };

    return NextResponse.json({ config }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error: any) {
    console.error('[App API] Config error:', error.message);
    return NextResponse.json(
      { config: null, error: error.message },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
