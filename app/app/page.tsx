import type { Metadata } from "next";
import Link from "next/link";
import { Coins, Zap, ShieldCheck, ArrowRight, Sparkles, CheckCircle2, ChevronRight } from "lucide-react";

export const metadata: Metadata = {
  title: "Zica Bella App | Fashion Redefined",
  description: "Download the Zica Bella mobile app to redeem Store Coins, enjoy exclusive archival drops, and experience seamless real-time order tracking.",
};

/** Official store listings — App Store Connect id 6769545889 / Android package com.zicabella.app */
const APP_STORE_URL = "https://apps.apple.com/app/zica-bella/id6769545889";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.zicabella.app";

function AppleLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
    </svg>
  );
}

function GooglePlayLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#EA4335" d="M3.6 2.2c-.4.4-.6 1-.6 1.7v16.2c0 .7.2 1.3.6 1.7l.1.1L13 12.1v-.2L3.7 2.1l-.1.1z" />
      <path fill="#FBBC04" d="M16.7 15.9 13 12.1v-.2l3.7-3.8.1.1 4.4 2.5c1.3.7 1.3 1.9 0 2.7l-4.5 2.5z" />
      <path fill="#4285F4" d="M16.8 15.8 13 12 3.6 21.6c.5.5 1.3.6 2.2.1l11-5.9z" />
      <path fill="#34A853" d="M16.8 8.2 5.8 2.3c-.9-.5-1.7-.4-2.2.1L13 12l3.8-3.8z" />
    </svg>
  );
}

export default function MobileAppLandingPage() {
  const perks = [
    {
      icon: Coins,
      title: "Redeem Store Coins",
      description: "1 Store Coin = ₹1. Store Coins can be earned and redeemed exclusively inside the Zica Bella mobile app.",
    },
    {
      icon: Zap,
      title: "Priority Drop Access",
      description: "Get push notifications 30 minutes before high-heat seasonal collections and limited archive drops go live.",
    },
    {
      icon: ShieldCheck,
      title: "1-Tap Exchanges & Returns",
      description: "Initiate instant returns or door-to-door exchanges in seconds without phone calls or paper forms.",
    },
    {
      icon: Sparkles,
      title: "Native Speed & Biometrics",
      description: "Ultra-fast browsing, FaceID/Fingerprint authentication, and instant 1-tap checkout via Apple Pay & UPI.",
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col justify-between selection:bg-amber-500/20">
      {/* Background ambient lighting */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-amber-500/5 blur-[120px]" />
        <div className="absolute bottom-1/4 left-1/3 -translate-x-1/2 w-[400px] h-[400px] rounded-full bg-foreground/5 blur-[100px]" />
      </div>

      <main className="relative z-10 max-w-4xl mx-auto px-4 py-16 sm:py-24 flex flex-col items-center text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-500 text-[10px] font-bold uppercase tracking-widest mb-6">
          <Coins className="w-3.5 h-3.5" />
          <span>Mobile App Exclusive Perks</span>
        </div>

        {/* Title */}
        <h1 className="text-3xl sm:text-5xl font-black tracking-tight uppercase leading-[1.1] max-w-2xl">
          Zica Bella on iOS & Android
        </h1>
        <p className="mt-4 text-sm sm:text-base text-foreground/60 max-w-xl font-light leading-relaxed">
          Unlock your Store Coins, experience lightning-fast checkout, and access exclusive streetwear drops right from your pocket.
        </p>

        {/* App Store CTAs */}
        <div className="mt-8 flex flex-col sm:flex-row items-stretch gap-3 w-full max-w-lg">
          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:flex-1 py-3.5 pl-4 pr-3 rounded-2xl border border-foreground/15 bg-foreground/[0.06] hover:bg-foreground/[0.1] hover:border-foreground/25 text-foreground transition-all flex items-center gap-3 shadow-[0_0_24px_-8px_rgba(245,158,11,0.15)] hover:scale-[1.02]"
          >
            <AppleLogo className="w-7 h-7 shrink-0" />
            <span className="flex-1 text-left leading-tight">
              <span className="block text-[9px] font-semibold uppercase tracking-wider text-foreground/55">Download on the</span>
              <span className="block text-sm font-bold tracking-tight">App Store</span>
            </span>
            <ChevronRight className="w-4 h-4 text-foreground/40 shrink-0" />
          </a>
          <a
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full sm:flex-1 py-3.5 pl-4 pr-3 rounded-2xl border border-foreground/15 bg-foreground/[0.06] hover:bg-foreground/[0.1] hover:border-foreground/25 text-foreground transition-all flex items-center gap-3 shadow-[0_0_24px_-8px_rgba(245,158,11,0.15)] hover:scale-[1.02]"
          >
            <GooglePlayLogo className="w-7 h-7 shrink-0" />
            <span className="flex-1 text-left leading-tight">
              <span className="block text-[9px] font-semibold uppercase tracking-wider text-foreground/55">Get it on</span>
              <span className="block text-sm font-bold tracking-tight">Play Store</span>
            </span>
            <ChevronRight className="w-4 h-4 text-foreground/40 shrink-0" />
          </a>
        </div>

        {/* Store Coin Feature Banner */}
        <div className="w-full mt-12 p-6 rounded-3xl border border-amber-500/20 bg-amber-500/[0.04] backdrop-blur-md text-left flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/15 flex items-center justify-center text-amber-500 shrink-0">
              <Coins className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">How Store Coins Work</h2>
              <p className="text-xs text-foreground/60 mt-0.5">
                Every 1 Store Coin = ₹1. View your balance on our website and redeem seamlessly upon checkout in the mobile app.
              </p>
            </div>
          </div>
          <Link
            href="/checkout"
            className="text-xs text-amber-500 font-bold hover:underline inline-flex items-center gap-1 shrink-0"
          >
            <span>Back to Checkout</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* App Perks Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full mt-8">
          {perks.map((p) => {
            const Icon = p.icon;
            return (
              <div
                key={p.title}
                className="p-5 rounded-3xl border border-foreground/5 bg-foreground/[0.02] text-left flex flex-col gap-2 transition-all hover:border-foreground/15"
              >
                <div className="w-9 h-9 rounded-xl bg-foreground/5 flex items-center justify-center text-foreground">
                  <Icon className="w-4.5 h-4.5" />
                </div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-foreground mt-1">{p.title}</h3>
                <p className="text-[11px] text-foreground/60 leading-relaxed">{p.description}</p>
              </div>
            );
          })}
        </div>

        {/* Install / Download Information */}
        <div id="install" className="w-full mt-12 pt-10 border-t border-foreground/10 text-left">
          <h2 className="text-xs font-bold uppercase tracking-widest text-foreground/50 mb-4">Availability</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl border border-foreground/10 bg-foreground/[0.02]">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span className="text-xs font-bold">iOS (Apple iPhone)</span>
              </div>
              <p className="text-[11px] text-foreground/60 leading-relaxed">
                Available on the Apple App Store for iOS 16+. Tap &ldquo;App Store&rdquo; above to download, or search &ldquo;Zica Bella&rdquo; in the App Store.
              </p>
            </div>
            <div className="p-4 rounded-2xl border border-foreground/10 bg-foreground/[0.02]">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span className="text-xs font-bold">Android (Google Play)</span>
              </div>
              <p className="text-[11px] text-foreground/60 leading-relaxed">
                Available for Android 10+. Built for seamless UPI payments, high-refresh rate animations, and instant courier notifications.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-foreground/5 py-6 text-center text-[10px] text-foreground/40 font-light">
        <p>&copy; {new Date().getFullYear()} ZICA BELLA. All rights reserved.</p>
      </footer>
    </div>
  );
}
