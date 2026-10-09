import type { Metadata, Viewport } from "next";
import { Inter, Poppins } from "next/font/google";
import localFont from "next/font/local";
import Script from "next/script";
import { Providers } from "./providers";
import "./globals.css";
import LayoutWrapper from "@/components/LayoutWrapper";
import StorefrontFooter from "@/components/StorefrontFooter";
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
import { PLACEHOLDER_EMAIL_HASHES } from "@/lib/tracking/placeholder-identity";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
  display: "swap",
});

/* ISR/SSG enabled — force-dynamic removed from root layout.
   Only truly dynamic pages (checkout, cart, search) set their own dynamic mode. */

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
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
  formatDetection: { telephone: false },
};


export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID || process.env.NEXT_PUBLIC_FACEBOOK_PIXEL_ID || "2049977412558608";
  // Demo-account and synthetic placeholder hashes never used as Advanced Matching.
  const metaBlockedIdentityHashes = [...DEMO_EMAIL_HASHES, ...DEMO_PHONE_HASHES, ...PLACEHOLDER_EMAIL_HASHES];
  const snapPixelId = process.env.NEXT_PUBLIC_SNAP_PIXEL_ID || "7d2481be-4ccf-42b2-b9ea-958c6c7bbdcd";
  const openaiAdsPixelId = process.env.NEXT_PUBLIC_OPENAI_ADS_PIXEL_ID || '';
  const storefrontGtmId = process.env.NEXT_PUBLIC_STOREFRONT_GTM_ID || "GTM-WKTQJ5LF";
  const adminGtmId = process.env.NEXT_PUBLIC_ADMIN_GTM_ID || "GTM-TDGKF386";

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
        {/* Google Tag Manager - Storefront vs Admin domain routing */}
        <script
          id="google-tag-manager"
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined') {
                var isAppOrAdmin = window.location.hostname === 'app.zicabella.com' || window.location.pathname.startsWith('/dashboard') || window.location.pathname.startsWith('/admin') || window.location.pathname.startsWith('/web-store');
                if (!isAppOrAdmin) {
                  (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
                  new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
                  j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
                  'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
                  })(window,document,'script','dataLayer','${storefrontGtmId}');
                }
              }
            `,
          }}
        />
        <link rel="preconnect" href="https://cdn.shopify.com" />
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
        <Script
          id="fb-pixel"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/dashboard') && !window.location.pathname.startsWith('/admin') && !window.location.pathname.startsWith('/web-store')) {
                !function(f,b,e,v,n,t,s)
                {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
                n.callMethod.apply(n,arguments):n.queue.push(arguments)};
                if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
                n.queue=[];t=b.createElement(e);t.async=!0;
                t.src=v;s=b.getElementsByTagName(e)[0];
                s.parentNode.insertBefore(t,s)}(window, document,'script',
                'https://connect.facebook.net/en_US/fbevents.js');
                fbq('set', 'autoConfig', false, '${pixelId}');
                // Manual Advanced Matching on the FIRST init: identity this browser already
                // holds (hashed zb_guest_* cookies, only when bound to this visitor via
                // zb_pii_owner) is available to PageView and the first ViewContent too.
                // Later initPixel() calls still add new identity (login / checkout).
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
                    var zbMap = { em: 'zb_guest_email', ph: 'zb_guest_phone', fn: 'zb_guest_fn', ln: 'zb_guest_ln', ct: 'zb_guest_ct', st: 'zb_guest_st', zp: 'zb_guest_zp', country: 'zb_guest_country', db: 'zb_guest_dob' };
                    for (var zbK in zbMap) {
                      var zbV = (zbC[zbMap[zbK]] || '').toLowerCase();
                      if (/^[a-f0-9]{64}$/.test(zbV) && zbBlocked.indexOf(zbV) === -1) zbAM[zbK] = zbV;
                    }
                  }
                } catch (e) {}
                window.__zbMetaAM = zbAM;
                fbq('init', '${pixelId}', zbAM);
              }
            `,
          }}
        />
        {/* Snap Pixel Base Code */}
        <Script
          id="snap-pixel"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/dashboard') && !window.location.pathname.startsWith('/admin') && !window.location.pathname.startsWith('/web-store')) {
                (function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function()
                {a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};
                a.queue=[];var s='script';r=t.createElement(s);r.async=!0;
                r.src=n;var u=t.getElementsByTagName(s)[0];
                if (u && u.parentNode) { u.parentNode.insertBefore(r,u); } else { (document.head || document.body).appendChild(r); }
                })(window,document,
                'https://sc-static.net/scevent.min.js');

                snaptr('init', '${snapPixelId}', {});
              }
            `,
          }}
        />
        {/* OpenAI (ChatGPT) Ads Pixel Base Code */}
        {openaiAdsPixelId && (
          <Script
            id="openai-ads-pixel"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `
                if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/dashboard') && !window.location.pathname.startsWith('/admin') && !window.location.pathname.startsWith('/web-store')) {
                  !function(o,a,i,q){if(o.oaiq)return;q=o.oaiq=function(){
                  q.callMethod?q.callMethod.apply(q,arguments):q.q.push(arguments)};
                  q.q=[];q.l=1*new Date();var s=a.createElement(i),
                  f=a.getElementsByTagName(i)[0];s.async=1;
                  s.src='https://bzrcdn.openai.com/sdk/oaiq.min.js';
                  if(f&&f.parentNode){f.parentNode.insertBefore(s,f);}else{(a.head||a.body).appendChild(s);}
                  }(window,document,'script');
                  oaiq('init', { pixelId: '${openaiAdsPixelId}' });
                }
              `,
            }}
          />
        )}
      </head>
      <body className={`${geistSans.variable} ${inter.variable} ${poppins.variable} antialiased`}>
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
          <FacebookSDKInit />
          <SnapPixelRouteTracker />
          <OpenAiPixelRouteTracker />
          <LayoutWrapper footer={<StorefrontFooter />}>
            {children}
          </LayoutWrapper>
          <Toaster position="top-right" />
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}

