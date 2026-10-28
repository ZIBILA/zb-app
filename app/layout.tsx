import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Providers } from "./providers";
import "./globals.css";
import LayoutWrapper from "@/components/LayoutWrapper";
import { getStorefrontFooterData } from "@/lib/storefront-footer-data";
import { fetchEnabledCollections } from "@/lib/shopify-admin";
import { Toaster } from "sonner";
import MetaPixelRouteTracker from "@/components/MetaPixelRouteTracker";
import FacebookSDKInit from "@/components/FacebookSDKInit";
import SnapPixelRouteTracker from "@/components/SnapPixelRouteTracker";
import OpenAiPixelRouteTracker from "@/components/OpenAiPixelRouteTracker";
import { NavigationProgress } from "@/components/ui/NavigationProgress";
import { OrganizationJsonLd } from "@/components/seo/OrganizationJsonLd";
import { WebsiteJsonLd } from "@/components/seo/WebsiteJsonLd";
import { Analytics } from "@/components/seo/Analytics";
import "@/lib/auth/env-check";
import { DEMO_EMAIL_HASHES, DEMO_PHONE_HASHES } from "@/lib/buildMetaUserData";
import { PLACEHOLDER_EMAIL_HASHES, PLACEHOLDER_NAME_HASHES, PLACEHOLDER_PHONE_HASHES, PLACEHOLDER_ZIP_HASHES } from "@/lib/tracking/placeholder-identity";
import { resolveSnapPixelId } from "@/lib/snap/config";
import { resolveMetaServerPixelId } from "@/lib/meta/config";
import { parseConsentRegions } from "@/lib/meta/consent";
import MetaConsentGate from "@/components/MetaConsentGate";

/* ISR/SSG enabled — force-dynamic removed from root layout.
   Only truly dynamic pages (checkout, cart, search) set their own dynamic mode. */

// Self-hosted — avoids Google Fonts network fetch warnings during `next build`
const inter = localFont({
  src: [
    { path: "./fonts/inter-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/inter-latin-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
  preload: false, // only cart/orders/returns + toasts use Inter; the face still loads on demand
});

const poppins = localFont({
  src: [
    { path: "./fonts/poppins-latin-300.woff2", weight: "300", style: "normal" },
    { path: "./fonts/poppins-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/poppins-latin-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/poppins-latin-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/poppins-latin-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-poppins",
  display: "swap",
  preload: false, // only policies + search use Poppins
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0a0a0a',
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Zica Bella® | Premium Streetwear, Heavyweight Hoodies & Oversized Tees',
    template: '%s | Zica Bella® | Luxury Indian Streetwear',
  },
  description:
    'India\'s premier luxury streetwear label. Discover boxy drop-shoulder oversized graphic tees, vintage acid-wash shirts, custom heavyweight loopback hoodies, and limited drop capsules. Engineered with premium double-yarn cotton blanks. Crafted in India, worn with intent. Free shipping above ₹999.',
  authors: [{ name: 'Zica Bella', url: siteUrl }],
  creator: 'Zica Bella',
  publisher: 'Zica Bella',
  category: 'Fashion & Apparel',
  classification: 'Luxury Streetwear, Indian Apparel, Heavyweight Blanks, Graphic Tees',
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      noimageindex: false,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_IN',
    url: siteUrl,
    siteName: 'Zica Bella',
    title: 'Zica Bella® | Premium Streetwear & Heavyweight Graphic Tees',
    description:
      'India\'s premier luxury streetwear label. Shop custom boxy oversized t-shirts, vintage acid-wash drop shoulder tees, and premium loopback hoodies. Crafted in India, worn with intent.',
    images: [
      {
        url: `${siteUrl}/og-image.jpg`,
        secureUrl: `${siteUrl}/og-image.jpg`,
        width: 1200,
        height: 630,
        alt: 'Zica Bella® | Premium Streetwear & Heavyweight Graphic Tees',
        type: 'image/jpeg',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Zica Bella® | Premium Streetwear & Heavyweight Graphic Tees',
    description: 'India\'s premier luxury streetwear label. Shop custom boxy oversized t-shirts, vintage acid-wash drop shoulder tees, and premium loopback hoodies. Crafted in India, worn with intent.',
    images: ['/og-image.jpg'],
    creator: '@zicabella',
    site: '@zicabella',
  },
  alternates: {
    canonical: siteUrl,
    languages: {
      'en-IN': siteUrl,
    },
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
    shortcut: '/favicon.ico',
  },
  manifest: '/manifest.webmanifest',
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || '_0vcMoBD8FO-9t-J7QtmUyFLYy9XzlhOe9GEsUMAq0g',
    other: {
      'msvalidate.01': process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION || '853916BB78BEBC665721D645159AD1E3',
    },
  },
  appleWebApp: {
    capable: true,
    title: 'Zica Bella®',
    statusBarStyle: 'black-translucent',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
  formatDetection: { telephone: false },
};


export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // '' = Meta tracking off on this deployment (dev / test / staging without an explicit
  // NEXT_PUBLIC_META_PIXEL_ID): the base snippet below is not rendered (lib/meta/config.ts).
  // The id the Conversions API sends with (META_PIXEL_ID, else the public id, else the
  // built-in one): the browser must use the same one or the two halves never deduplicate.
  const pixelId = resolveMetaServerPixelId();
  // Consent regions / Limited Data Use — both off unless the env says otherwise (lib/meta/consent.ts).
  const metaConsentRegions = parseConsentRegions(process.env.NEXT_PUBLIC_META_CONSENT_REGIONS);
  const metaLdu = String(process.env.NEXT_PUBLIC_META_LDU || '').trim() === '1';
  // Demo-account and synthetic placeholder hashes never used as Advanced Matching.
  const metaBlockedIdentityHashes = [...DEMO_EMAIL_HASHES, ...DEMO_PHONE_HASHES, ...PLACEHOLDER_EMAIL_HASHES, ...PLACEHOLDER_PHONE_HASHES, ...PLACEHOLDER_ZIP_HASHES];
  // Name placeholders are checked against fn / ln only (sha256('na') is also Namibia's country code).
  const metaBlockedNameHashes = [...PLACEHOLDER_NAME_HASHES];
  const snapPixelId = resolveSnapPixelId(); // '' = Snap tracking off on this deployment (lib/snap/config.ts)
  const openaiAdsPixelId = process.env.NEXT_PUBLIC_OPENAI_ADS_PIXEL_ID || '';
  const storefrontGtmId = process.env.NEXT_PUBLIC_STOREFRONT_GTM_ID || "GTM-WKTQJ5LF";
  const [footerData, headerCollections] = await Promise.all([
    getStorefrontFooterData(),
    // Desktop header nav links: resolved here so they are in the HTML instead of popping in after a
    // client fetch. Only the fields the header renders are serialised.
    fetchEnabledCollections("header")
      .then((cols) => cols.map((c) => ({ id: c.id, handle: c.handle, title: c.title })))
      .catch(() => [] as { id: number; handle: string; title: string }[]),
  ]);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          id="theme-fallback"
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var theme = localStorage.getItem('theme');
                if (!theme) {
                  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                  var prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
                  if (!prefersDark && !prefersLight) {
                    localStorage.setItem('theme', 'dark');
                  }
                }
              } catch (e) {}
            `,
          }}
        />
        {/* GTM stub only — network gtm.js loads via lazyOnload below so it stays off the critical path. */}
        <script
          id="google-tag-manager-stub"
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                var isAppOrAdmin = location.hostname === 'app.zicabella.com' || location.pathname.startsWith('/dashboard') || location.pathname.startsWith('/admin') || location.pathname.startsWith('/web-store');
                window.__zbGtmId = isAppOrAdmin ? '' : '${storefrontGtmId}';
                window.dataLayer = window.dataLayer || [];
                if (window.__zbGtmId) {
                  window.dataLayer.push({'gtm.start': new Date().getTime(), event: 'gtm.js'});
                }
              })();
            `,
          }}
        />
        <link rel="preconnect" href="https://cdn.shopify.com" />
        {/* Header wordmark font — above the fold on every page, so preload the (same-origin) file */}
        <link rel="preload" href="/fonts/Rocaston.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "ClothingStore",
              "name": "Zica Bella",
              "url": siteUrl,
              "logo": `${siteUrl}/zb-logo-220px.png`,
              "image": `${siteUrl}/zb-logo-220px.png`,
              "description": "Zica Bella is a leading premium luxury streetwear label, redefining street culture through custom heavyweight cotton hoodies, oversized graphic tees, and streetwear denims. Designed in Italy and crafted in India with modular silhouettes.",
              "telephone": "+91-9220385011",
              "priceRange": "₹₹₹",
              "address": {
                "@type": "PostalAddress",
                "addressLocality": "Noida",
                "addressRegion": "Uttar Pradesh",
                "postalCode": "201305",
                "addressCountry": "IN"
              },
              "sameAs": [
                "https://www.instagram.com/zica.bella",
                "https://www.youtube.com/@Zicabella"
              ],
              "potentialAction": {
                "@type": "SearchAction",
                "target": `${siteUrl}/search?q={search_term_string}`,
                "query-input": "required name=search_term_string"
              }
            })
          }}
        />
        {/* Request-time pixel ids for the browser bundle (lib/metaPixel.ts / lib/snapPixel.ts read these
            instead of the build-time NEXT_PUBLIC_* values, so a build env that differs from the runtime env
            cannot leave the snippet and the bundle disagreeing on whether tracking is on). */}
        <script
          id="zb-pixel-ids"
          dangerouslySetInnerHTML={{
            __html: `window.__zbMetaPixelId=${JSON.stringify(pixelId)};window.__zbSnapPixelId=${JSON.stringify(snapPixelId)};
(function(){
  var c = document.cookie, q = location.search, sec = location.protocol === 'https:' ? '; Secure' : '';
  var internal = /(?:^|; )zb_internal=1(?:;|$)/.test(c);
  if (!internal && /[?&]zb_internal=1(?:&|$)/.test(q)) { document.cookie = 'zb_internal=1; max-age=31536000; path=/; SameSite=Lax' + sec; internal = true; }
  var app = /(?:^|; )zb_app=1(?:;|$)/.test(c);
  if (!app && /[?&]zb_app=1(?:&|$)/.test(q)) { document.cookie = 'zb_app=1; path=/; SameSite=Lax' + sec; app = true; }
  window.__zbInternal = internal || app;
})();`,
          }}
        />
        {/* Pixel queue stubs + init (no network). External SDKs load via lazyOnload so early track() calls still queue. */}
        {pixelId && (
        <script
          id="fb-pixel-stub"
          dangerouslySetInnerHTML={{
            __html: `
              // staff / QA / demo browser (zb_internal) or a native-app WebView page (zb_app): the
              // flags are set by the zb-pixel-ids script above and honoured by the relays too.
              var zbInternal = !!window.__zbInternal;
              if (!zbInternal && !location.pathname.startsWith('/dashboard') && !location.pathname.startsWith('/admin') && !location.pathname.startsWith('/web-store')) {
                !function(f,n){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];}(window);
                fbq('set', 'autoConfig', false, '${pixelId}');
                var zbAM = {};
                try {
                  var zbC = {};
                  document.cookie.split(';').forEach(function (p) {
                    var i = p.indexOf('=');
                    if (i > 0) { var k = p.slice(0, i).trim(); try { zbC[k] = decodeURIComponent(p.slice(i + 1)); } catch (e) { zbC[k] = p.slice(i + 1); } }
                  });
                  var zbExt = zbC['zb_external_id'];
                  if (zbExt) zbAM.external_id = zbExt;
                  if (zbC['zb_fb_login_id']) zbAM.fb_login_id = zbC['zb_fb_login_id'];
                  if (zbExt && zbC['zb_pii_owner'] === zbExt) {
                    var zbBlocked = ${JSON.stringify(metaBlockedIdentityHashes)};
                    var zbNameBlocked = ${JSON.stringify(metaBlockedNameHashes)};
                    var zbMap = { em: 'zb_guest_email', ph: 'zb_guest_phone', fn: 'zb_guest_fn', ln: 'zb_guest_ln', ct: 'zb_guest_ct', st: 'zb_guest_st', zp: 'zb_guest_zp', country: 'zb_guest_country', db: 'zb_guest_dob' };
                    for (var zbK in zbMap) {
                      var zbV = (zbC[zbMap[zbK]] || '').toLowerCase();
                      var zbIsName = zbK === 'fn' || zbK === 'ln';
                      if (/^[a-f0-9]{64}$/.test(zbV) && zbBlocked.indexOf(zbV) === -1 && !(zbIsName && zbNameBlocked.indexOf(zbV) !== -1)) zbAM[zbK] = zbV;
                    }
                  }
                } catch (e) {}
                try {
                  var zbRegions = ${JSON.stringify(Array.from(metaConsentRegions))};
                  if (zbRegions.length) {
                    var zbChoice = String((zbC && zbC['zb_consent']) || '').toLowerCase();
                    var zbCC = String((zbC && zbC['zb_geo_cc']) || '').toUpperCase();
                    var zbHold = zbChoice === 'granted' ? false : (zbChoice === 'denied' ? true : !(/^[A-Z]{2}$/.test(zbCC) && zbRegions.indexOf(zbCC) === -1));
                    if (zbHold) fbq('consent', 'revoke');
                  }
                  if (${metaLdu ? 'true' : 'false'}) fbq('dataProcessingOptions', ['LDU'], 0, 0);
                } catch (e) {}
                window.__zbMetaAM = zbAM;
                window.__zbLoadMetaPixel = true;
                fbq('init', '${pixelId}', zbAM);
              }
            `,
          }}
        />
        )}
        {snapPixelId && (
          <script
            id="snap-pixel-stub"
            dangerouslySetInnerHTML={{
              __html: `
              if (!window.__zbInternal && !location.pathname.startsWith('/dashboard') && !location.pathname.startsWith('/admin') && !location.pathname.startsWith('/web-store')) {
                if (!window.snaptr) {
                  var a = window.snaptr = function () { a.handleRequest ? a.handleRequest.apply(a, arguments) : a.queue.push(arguments); };
                  a.queue = [];
                }
                window.__zbLoadSnapPixel = true;
                snaptr('init', '${snapPixelId}', {});
              }
            `,
            }}
          />
        )}
        {openaiAdsPixelId && (
          <script
            id="openai-ads-pixel-stub"
            dangerouslySetInnerHTML={{
              __html: `
                if (!location.pathname.startsWith('/dashboard') && !location.pathname.startsWith('/admin') && !location.pathname.startsWith('/web-store')) {
                  if (!window.oaiq) {
                    var q = window.oaiq = function () { q.callMethod ? q.callMethod.apply(q, arguments) : q.q.push(arguments); };
                    q.q = []; q.l = 1 * new Date();
                  }
                  window.__zbLoadOpenAiPixel = true;
                  oaiq('init', { pixelId: '${openaiAdsPixelId}' });
                }
              `,
            }}
          />
        )}
        <script
          id="third-party-pixels-loader"
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                function inject(src) {
                  var s = document.createElement('script');
                  s.async = true;
                  s.src = src;
                  (document.head || document.body).appendChild(s);
                }
                function load() {
                  if (window.__zbGtmId) inject('https://www.googletagmanager.com/gtm.js?id=' + window.__zbGtmId);
                  if (window.__zbLoadMetaPixel) inject('https://connect.facebook.net/en_US/fbevents.js');
                  if (window.__zbLoadSnapPixel) inject('https://sc-static.net/scevent.min.js');
                  if (window.__zbLoadOpenAiPixel) inject('https://bzrcdn.openai.com/sdk/oaiq.min.js');
                }
                if (document.readyState === 'complete') {
                  setTimeout(load, 1);
                } else {
                  window.addEventListener('load', function () { setTimeout(load, 1); });
                }
              })();
            `,
          }}
        />
      </head>
      <body className={`${inter.variable} ${poppins.variable} antialiased`}>
        {/* Google Tag Manager (noscript) */}
        <noscript>
          <iframe
            src={`https://www.googletagmanager.com/ns.html?id=${storefrontGtmId}`}
            height="0"
            width="0"
            style={{ display: 'none', visibility: 'hidden' }}
          />
        </noscript>
        <OrganizationJsonLd />
        <WebsiteJsonLd />
        <NavigationProgress />
        <Providers>
          <MetaPixelRouteTracker />
          <MetaConsentGate />
          <FacebookSDKInit />
          <SnapPixelRouteTracker />
          <OpenAiPixelRouteTracker />
          <LayoutWrapper footerData={footerData} headerCollections={headerCollections}>
            {children}
          </LayoutWrapper>
          <Toaster position="top-right" />
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}

