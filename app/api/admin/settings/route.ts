import { NextResponse } from 'next/server';
import { revalidatePath, revalidateTag } from 'next/cache';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

const ENV_DOMAIN = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN || process.env.SHOPIFY_STORE_DOMAIN || '8tiahf-bk.myshopify.com';
const ENV_TOKEN  = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';

/** Build a settings response from env vars (used when DB is unavailable) */
function envSettings() {
  return {
    id: 'env-fallback',
    dbStatus: 'mock_failure',
    dbError: 'Database connection failed. Ensure POSTGRES_PRISMA_URL or DATABASE_URL is set in environment variables and redeploy.',
    shopDomain: ENV_DOMAIN,
    accessToken: ENV_TOKEN,
    delhiveryApiKey: '',
    razorpayKeyId: '',
    razorpayKeySecret: '',
    shiprocketEmail: '',
    shiprocketToken: '',
    webhookSecret: '',
    whatsappPhoneId: '',
    whatsappToken: '',
    firebaseProjectId: '',
    firebaseClientEmail: '',
    firebasePrivateKey: '',
    sendgridApiKey: '',
    twilioAccountSid: '',
    twilioAuthToken: '',
    twilioPhoneNumber: '',
    heroImage: '',
    heroVideo: '',
    heroVideoMobile: '',
    heroTitle: '',
    heroSubtitle: '',
    heroButtonText: 'Discover',
    latestCurationTitle: 'Latest curation',
    latestCurationSubtitle: 'Season Drop',
    archiveTitle: 'The Archive',
    archiveSubtitle: 'Organic Evolution',
    blueprintTitle: 'The blueprint of Zica Bella',
    blueprintSubtitle: 'Technique & Motion',
    showProductVideo: true,
    showSizeChart: true,
    showBrand: true,
    showShippingReturn: true,
    showCare: true,
    showSizeFit: true,
    showDetails: true,
    pdpBackground: '',
    instagramUrl: '',
    appleUrl: '',
    spotifyUrl: '',
    youtubeUrl: '',
    showHeroText: false,
    showLatestCuration: true,
    showArchive: true,
    showBlueprint: true,
    featuredMedia: '',
    featuredMediaImage: '',
    featuredMediaMobile: '',
    featuredMediaImageMobile: '',
    collectionsMedia: '',
    collectionsMediaMobile: '',
    footerVideo: '',
    footerVideoMobile: '',
    mainMenuHandle: '',
    secondaryMenuHandle: '',
    showTreeText: true,
    showCommunity: true,
    communityTitle: 'Featured Looks',
    communitySubtitle: 'Community',
    spotlightTitle: 'AUTHENTIC STREETWEAR',
    spotlightSubtitle: 'Luxury Indian streetwear for modern men. Redefining bold everyday style.',
    spotlightCollection: 'tshirts',
    spotlightProducts: '',
    homepageCollection: '',
    homepageProducts: '',
    kineticMeshTitle: 'ARCHIVE EDITION',
    kineticMeshProducts: '',
    enabledCollectionsHeader: '[]',
    enabledCollectionsPage: '[]',
    enabledCollectionsMenu: '[]',
    feedExcludedCollections: '[]',
    flipbookConfig: '[]',
    flipbookImage: '',
    flipbookImageMobile: '',
    flipbookVideo: '',
    flipbookVideoMobile: '',
    flipbookTitle: 'Archival Vision',
    flipbookTag: 'Core Manifest',
    flipbookDesc: 'Engineered for those who move without compromise.',
    featuredMediaLink: '',
    collectionsMediaLink: '',
    flipbookLink: '',
    communityMinOrders: 1,
    communityAgeRestricted: true,
    communityWhatsAppEnabled: true,
    footerLogo3dUrl: 'https://cdn.shopify.com/3d/models/e024b09e83a75c03/Zicabella-silver-logo.glb',
    loginBgImage: '',
    loginBgVideo: '',
    loginBgImageMobile: '',
    loginBgVideoMobile: '',
    loginBgImageLight: '',
    loginBgImageDark: '',
    loginBgImageLightMobile: '',
    loginBgImageDarkMobile: '',
    shopAllLink: '/collections/all',
    collectionProductOrders: '{}',
  };
}

// GET: Fetch settings
export async function GET(req: Request) {
  try {
    const { getShopSettings } = await import('@/lib/db');
    const settings = await getShopSettings();

    return NextResponse.json({
      dbStatus: 'connected',
      shopDomain: settings.domain || ENV_DOMAIN,
      accessToken: settings.accessToken || ENV_TOKEN,
      ...settings,
    });
  } catch (e: any) {
    console.error('[Settings API GET Error]:', e);
    return NextResponse.json({ ...envSettings(), dbError: e.message });
  }
}

// PATCH: Update settings
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { shopId, shopDomain: bodyDomain, ...updates } = body;

    const allowedKeys = [
      'domain', 'accessToken',
      'delhiveryApiKey', 'razorpayKeyId', 'razorpayKeySecret',
      'shiprocketEmail', 'shiprocketPassword', 'shiprocketToken', 'webhookSecret',
      'whatsappPhoneId', 'whatsappToken', 'firebaseProjectId', 'firebaseClientEmail',
      'firebasePrivateKey', 'sendgridApiKey', 'twilioAccountSid', 'twilioAuthToken', 'twilioPhoneNumber',
      'heroImage', 'heroVideo', 'heroVideoMobile', 'heroTitle', 'heroSubtitle', 'heroButtonText',
      'latestCurationTitle', 'latestCurationSubtitle', 'archiveTitle', 'archiveSubtitle',
      'blueprintTitle', 'blueprintSubtitle', 'showHeroText', 'showLatestCuration',
      'showArchive', 'showBlueprint', 'showProductVideo', 'showSizeChart',
      'showBrand', 'showShippingReturn', 'showCare', 'showSizeFit', 'showDetails',
      'pdpBackground', 'instagramUrl', 'appleUrl', 'spotifyUrl', 'youtubeUrl',
      'featuredMedia', 'featuredMediaImage', 'featuredMediaMobile', 'featuredMediaImageMobile',
      'collectionsMedia', 'collectionsMediaMobile', 'kineticMeshProducts',
      'footerVideo', 'footerVideoMobile', 'mainMenuHandle', 'secondaryMenuHandle', 'showTreeText',
      'showCommunity', 'communityTitle', 'communitySubtitle', 'spotlightTitle',
      'spotlightSubtitle', 'spotlightCollection', 'spotlightProducts', 'kineticMeshTitle', 'enabledCollectionsHeader',
      'enabledCollectionsPage', 'enabledCollectionsMenu', 'feedExcludedCollections', 'flipbookConfig',
      'flipbookImage', 'flipbookImageMobile', 'flipbookVideo', 'flipbookVideoMobile', 'flipbookTitle', 'flipbookTag', 'flipbookDesc',
      'featuredMediaLink', 'collectionsMediaLink', 'flipbookLink',
      'communityMinOrders', 'communityAgeRestricted', 'communityWhatsAppEnabled',
      'showRingCarousel', 'ringCarouselTitle', 'ringCarouselItems',
      'homepageCollection', 'homepageProducts',
      'footerLogo3dUrl', 'claudeApiKey', 'claudeWebhookSecret', 'openaiApiKey', 'openaiWebhookSecret',
      'loginBgImage', 'loginBgVideo', 'loginBgImageMobile', 'loginBgVideoMobile',
      'loginBgImageLight', 'loginBgImageDark', 'loginBgImageLightMobile', 'loginBgImageDarkMobile',
      'shopAllLink', 'collectionProductOrders'
    ] as const;

    const booleanKeys = [
      'showHeroText', 'showLatestCuration', 'showArchive', 'showBlueprint',
      'showProductVideo', 'showSizeChart', 'showBrand', 'showShippingReturn',
      'showCare', 'showSizeFit', 'showDetails', 'showTreeText', 'showCommunity',
      'communityAgeRestricted', 'communityWhatsAppEnabled', 'showRingCarousel'
    ];

    const data: any = {};
    for (const key of allowedKeys) {
      if (updates[key] !== undefined) {
        data[key] = booleanKeys.includes(key as any)
          ? (updates[key] === true || updates[key] === 'true')
          : updates[key];
      }
    }

    if (bodyDomain && !data.domain) data.domain = bodyDomain;

    const { updateShopSettings } = await import('@/lib/db');
    const updatedSettings = await updateShopSettings(data);

    try {
      revalidatePath('/');
      revalidatePath('/products/[id]', 'page');
      revalidatePath('/policies/[handle]', 'page');
      revalidateTag('homepage');
      console.log(`[Settings API] Purged storefront caches successfully.`);
    } catch (revalidateErr: any) {
      console.warn(`[Settings API] Cache revalidation warning: ${revalidateErr.message}`);
    }

    console.log(`[Settings API] Saved settings successfully`);
    return NextResponse.json({ success: true, shopDomain: updatedSettings.domain || '8tiahf-bk.myshopify.com', settings: updatedSettings });
  } catch (e: any) {
    console.error('[Settings API PATCH Error]:', e);
    return NextResponse.json({ error: `Save failed: ${e.message}` }, { status: 500 });
  }
}
