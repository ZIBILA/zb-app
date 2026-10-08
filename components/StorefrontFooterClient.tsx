"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { 
  Instagram, 
  Youtube, 
  Info, 
  RotateCcw, 
  Mail, 
  FileText, 
  Truck, 
  Lock, 
  HelpCircle, 
  RefreshCw, 
  MapPin, 
  CreditCard, 
  ChevronDown, 
  ChevronUp,
  Globe,
  Check
} from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence, useTransform, useMotionValue } from "framer-motion";
import { toast } from "sonner";
import ThreeDLogo from "./ThreeDLogo";
import LazyVideo from "./LazyVideo";
import { useMetaEvents } from "@/hooks/useMetaEvents";
import { useSnapEvents } from "@/hooks/useSnapEvents";
import { useOpenAiEvents } from "@/hooks/useOpenAiEvents";
import { useCountry } from "@/lib/country-context";

interface Policy {
  handle: string;
  title: string;
}

interface Shop {
  domain: string;
  instagramUrl?: string;
  appleUrl?: string;
  spotifyUrl?: string;
  youtubeUrl?: string;
  footerLogo3dUrl?: string;
  footerVideo?: string;
}

interface SocialLink {
  id: string;
  platform: string;
  label: string;
  url: string;
  placements: string[];
}

interface StorefrontFooterClientProps {
  shop: Shop | null;
  policies: Policy[];
  socialLinks?: SocialLink[];
}

export default function StorefrontFooterClient({ shop, policies, socialLinks }: StorefrontFooterClientProps) {
  const { countryCode, setCountry, activeCountries, globalStoreEnabled } = useCountry();
  const { trackSubscribe } = useMetaEvents();
  const { trackSubscribe: trackSnapSubscribe } = useSnapEvents();
  const { trackLeadCreated: trackOaiLeadCreated } = useOpenAiEvents();
  // Mobile accordion states
  const [shopOpen, setShopOpen] = useState(false);
  const [customerCareOpen, setCustomerCareOpen] = useState(true); // Default open as shown in reference image
  const [supportOpen, setSupportOpen] = useState(false);
  const [shipToOpen, setShipToOpen] = useState(false);

  // Newsletter state
  const [email, setEmail] = useState("");

  // Stable scroll-progress that ignores in-app browser toolbar-triggered
  // viewport resizes (50-150px height-only changes).
  const revealContainerRef = useRef<HTMLDivElement>(null);
  const scrollYProgress = useMotionValue(0);
  const cachedFooterLayout = useRef<{ top: number; height: number; winW: number; winH: number } | null>(null);

  const measureFooterLayout = useCallback(() => {
    const el = revealContainerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    cachedFooterLayout.current = {
      top: rect.top + scrollTop,
      height: rect.height,
      winW: window.innerWidth,
      winH: window.innerHeight,
    };
  }, []);

  useEffect(() => {
    measureFooterLayout();

    const onScroll = () => {
      const layout = cachedFooterLayout.current;
      if (!layout) return;
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const winH = window.innerHeight;
      // offset: ["start end", "end end"] means:
      //   progress 0 = element top reaches viewport bottom
      //   progress 1 = element bottom reaches viewport bottom
      const start = layout.top - winH; // element top at viewport bottom
      const end = layout.top + layout.height - winH; // element bottom at viewport bottom
      const range = end - start;
      if (range <= 0) return;
      const progress = Math.min(1, Math.max(0, (scrollTop - start) / range));
      scrollYProgress.set(progress);
    };

    const onResize = () => {
      const prev = cachedFooterLayout.current;
      if (!prev) {
        measureFooterLayout();
        return;
      }
      const newW = window.innerWidth;
      const newH = window.innerHeight;
      const dW = Math.abs(newW - prev.winW);
      const dH = Math.abs(newH - prev.winH);
      // Ignore height-only changes in the 40-160px range (toolbar toggle)
      if (dW < 2 && dH >= 40 && dH <= 160) return;
      measureFooterLayout();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    onScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [measureFooterLayout, scrollYProgress]);

  const revealY = useTransform(scrollYProgress, [0, 1], [-55, 0]);
  const revealOpacity = useTransform(scrollYProgress, [0, 1], [0, 1]);

  const [subscribing, setSubscribing] = useState(false);
  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (!value || subscribing) return;
    setSubscribing(true);
    try {
      // Persist first. Tracking fires ONLY after the backend confirmed the save.
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        toast.error(
          data?.error === "invalid_email" ? "Please enter a valid email address." : "Couldn't subscribe right now. Please try again."
        );
        return;
      }
      if (data.created) {
        // Subscribe is a non-monetary newsletter signup — pass estimated lead value
        // for Meta's value-based optimization. Currency is INR.
        trackSubscribe(value, 'Newsletter Signup');
        trackSnapSubscribe(value);
        trackOaiLeadCreated(value);
      }
      toast.success(data.created ? "Thank you for joining our newsletter!" : "You're already subscribed.", {
        description: data.created ? "You have successfully subscribed to the Zica Bella newsletter." : undefined,
      });
      setEmail("");
    } catch {
      toast.error("Couldn't subscribe right now. Please try again.");
    } finally {
      setSubscribing(false);
    }
  };

  // Helper to find policies dynamically
  const findPolicyPath = (keyword: string, fallback: string) => {
    const match = policies.find(
      (p) => p.title.toLowerCase().includes(keyword) || p.handle.toLowerCase().includes(keyword)
    );
    return match ? `/policies/${match.handle}` : fallback;
  };

  // Shorten policy titles for bottom lists
  const shortenPolicyTitle = (title: string) => {
    const t = title.toLowerCase();
    if (t.includes("privacy")) return "Privacy";
    if (t.includes("terms") || t.includes("condition")) return "Terms";
    if (t.includes("refund") || t.includes("return") || t.includes("cancellation")) return "Returns";
    if (t.includes("shipping") || t.includes("delivery")) return "Shipping";
    return title.replace(/Policy/gi, "").trim();
  };

  // Fallbacks for URLs
  const instagramUrl = shop?.instagramUrl || "https://www.instagram.com/zica.bella";
  const spotifyUrl = shop?.spotifyUrl || "https://open.spotify.com";
  const appleUrl = shop?.appleUrl || "https://music.apple.com";
  const youtubeUrl = shop?.youtubeUrl || "https://www.youtube.com/@Zicabella";

  const defaultSocialLinks = [
    { url: instagramUrl, platform: "instagram", label: "Instagram" },
    { url: appleUrl,     platform: "apple",     label: "Apple Music" },
    { url: spotifyUrl,   platform: "spotify",   label: "Spotify" },
    { url: youtubeUrl,   platform: "youtube",   label: "YouTube" },
  ];

  const activeSocialLinks = socialLinks && socialLinks.length > 0
    ? socialLinks
        .filter((link: any) => link.placements?.includes("footer") && link.url)
        .map((link: any) => ({
          url: link.url,
          platform: link.platform,
          label: link.label
        }))
    : defaultSocialLinks;

  const getSocialIcon = (platform: string) => {
    switch (platform.toLowerCase()) {
      case "instagram":
        return Instagram;
      case "youtube":
        return Youtube;
      case "spotify":
        return SpotifyIcon;
      case "apple":
        return Music2Icon;
      case "tiktok":
        return TikTokIcon;
      case "twitter":
      case "x":
        return XIcon;
      case "pinterest":
        return PinterestIcon;
      case "snapchat":
        return SnapchatIcon;
      case "whatsapp":
        return WhatsAppIcon;
      default:
        return Globe;
    }
  };

  return (
    <footer className="w-full relative z-10 bg-white dark:bg-black" aria-label="Storefront Footer">
      {/* Top accent line */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent" />

      {/* ─── DESKTOP (md+) ─── */}
      <div className="hidden md:block max-w-7xl mx-auto px-8 py-24">
        <div className="grid grid-cols-12 gap-8 items-start">
          
          {/* Brand Info (3 Columns) */}
          <div className="col-span-3 space-y-6">
            <div className="flex flex-col items-start gap-4">
              <ThreeDLogo src={shop?.footerLogo3dUrl} size={36} />
              <h2 className="font-rocaston text-[9px] tracking-[0.18em] text-foreground font-light uppercase leading-none">ZICABELLA</h2>
            </div>

            <p className="text-[10px] font-normal text-foreground/35 leading-[2] tracking-wider max-w-xs">
              Redefining everyday boldness through meticulous engineering, premium textiles, and modern architectural standards. Designed in Italy, crafted in India.
            </p>

            {/* Footer video - clean layout */}
            {shop?.footerVideo && (
              <div className="relative w-full aspect-[21/9] rounded-2xl overflow-hidden group border border-foreground/[0.04] shadow-md bg-foreground/[0.01] max-w-xs">
                <LazyVideo src={shop.footerVideo} className="absolute inset-0 w-full h-full object-cover opacity-30 group-hover:opacity-50 transition-opacity duration-1000" />
              </div>
            )}
          </div>

          {/* Discover Column (2 Columns) */}
          <div className="col-span-2 space-y-4 pt-2">
            <h3 className="text-[8.5px] font-bold uppercase tracking-[0.25em] text-foreground/25">Discover</h3>
            <ul className="space-y-3">
              {[
                { href: "/search", label: "Catalog" },
                { href: "/collections", label: "Collections" },
                { href: "/blogs", label: "Journal" },
                { href: "/wishlist", label: "Wishlist" },
              ].map(link => (
                <li key={link.href}>
                  <Link href={link.href} className="text-[9.5px] font-normal tracking-[0.12em] uppercase text-foreground/45 hover:text-foreground transition-all duration-300 hover:translate-x-0.5 inline-block">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Account Column (2 Columns) */}
          <div className="col-span-2 space-y-4 pt-2">
            <h3 className="text-[8.5px] font-bold uppercase tracking-[0.25em] text-foreground/25">Account</h3>
            <ul className="space-y-3">
              {[
                { href: "/profile", label: "Profile" },
                { href: "/orders", label: "Orders" },
                { href: "/cart", label: "Bag" },
                { href: "/support", label: "Support" },
              ].map(link => (
                <li key={link.href}>
                  <Link href={link.href} className="text-[9.5px] font-normal tracking-[0.12em] uppercase text-foreground/45 hover:text-foreground transition-all duration-300 hover:translate-x-0.5 inline-block">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Connect Column (2 Columns) */}
          <div className="col-span-2 space-y-4 pt-2 flex flex-col items-start">
            <h3 className="text-[8.5px] font-bold uppercase tracking-[0.25em] text-foreground/25">Connect</h3>
            <div className="flex flex-col gap-2.5 w-full">
              {activeSocialLinks.map(({ url, platform, label }) => {
                const Icon = getSocialIcon(platform);
                return (
                  <a key={label} href={url} target="_blank" rel="noopener noreferrer"
                    className="group flex items-center justify-between text-foreground/45 hover:text-foreground transition-all duration-300 w-full max-w-[140px] py-1 border-b border-foreground/5 hover:border-foreground/10"
                  >
                    <span className="text-[9.5px] font-normal tracking-[0.12em] uppercase">{label}</span>
                    <Icon className="w-3 h-3 opacity-60 group-hover:opacity-100 transition-opacity" />
                  </a>
                );
              })}
            </div>
          </div>

          {/* Stay In The Loop (Newsletter - 3 Columns) */}
          <div className="col-span-3 space-y-4 pt-2 text-left">
            <h3 className="text-[8.5px] font-bold uppercase tracking-[0.25em] text-foreground/25">Stay In The Loop</h3>
            <p className="text-[10px] text-foreground/45 font-light leading-relaxed">
              Join our newsletter for early access to product releases.
            </p>
            <form onSubmit={handleSubscribe} className="flex items-center gap-2.5 w-full pt-2">
              <div className="relative flex-1">
                <input 
                  type="email" 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email" 
                  required
                  className="w-full h-10 bg-transparent border border-gray-200 dark:border-white/[0.08] focus:border-foreground dark:focus:border-white/20 rounded-full px-4 pr-10 text-[10.5px] focus:outline-none placeholder:text-foreground/25 text-foreground transition-colors leading-none"
                />
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-foreground/30 pointer-events-none flex items-center justify-center">
                  <Mail className="w-3 h-3" />
                </div>
              </div>
              <button 
                type="submit"
                disabled={subscribing}
                className="h-10 bg-black dark:bg-white text-white dark:text-black hover:opacity-90 active:scale-95 rounded-full px-4 text-[8.5px] font-bold tracking-[0.15em] uppercase transition-all shrink-0 flex items-center justify-center"
              >
                SUBSCRIBE
              </button>
            </form>
          </div>

        </div>

        {/* Bottom bar with Copyright, Policies & Country Selector */}
        <div className="mt-20 pt-8 border-t border-foreground/[0.04] flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-[8px] font-semibold uppercase tracking-[0.2em] text-foreground/15">
              © {new Date().getFullYear()} ZICABELLA · ALL RIGHTS RESERVED
            </p>
            {policies.map((policy) => (
              <Link 
                key={policy.handle} 
                href={`/policies/${policy.handle}`}
                className="text-[8px] font-bold uppercase tracking-[0.25em] text-foreground/30 hover:text-foreground/80 transition-colors"
              >
                {shortenPolicyTitle(policy.title)}
              </Link>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-6">
            {globalStoreEnabled && activeCountries.length > 0 && (
              <div className="flex items-center gap-2 bg-foreground/[0.03] dark:bg-white/[0.04] border border-foreground/[0.08] dark:border-white/10 hover:border-foreground/20 dark:hover:border-white/20 rounded-full px-3.5 py-1.5 transition-colors">
                <Globe className="w-3.5 h-3.5 text-foreground/40 shrink-0" />
                <span className="text-[8.5px] font-bold uppercase tracking-[0.15em] text-foreground/40 shrink-0">SHIP TO:</span>
                <select
                  value={countryCode}
                  onChange={(e) => setCountry(e.target.value)}
                  className="bg-transparent text-[9.5px] font-medium tracking-wide text-foreground/80 dark:text-white/80 focus:outline-none cursor-pointer pr-1"
                  aria-label="Select Country / Currency"
                >
                  {activeCountries.map((c) => (
                    <option key={c.code} value={c.code} className="bg-background text-foreground text-xs">
                      {c.name} ({c.currencySymbol} {c.currencyCode})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <p className="text-[8px] font-semibold uppercase tracking-[0.2em] text-foreground/15">
              DESIGNED IN ITALY · CRAFTED IN INDIA
            </p>
          </div>
        </div>
      </div>

      {/* ─── MOBILE (below md) ─── */}
      <div className="md:hidden px-5 pt-12 pb-[calc(2.5rem+env(safe-area-inset-bottom,0px))] flex flex-col items-center">
        
        {/* Brand Header: Logo stacked — 3D on top, text below */}
        <div className="flex flex-col items-center gap-8 mb-6 text-center">
          <ThreeDLogo src={shop?.footerLogo3dUrl} size={48} />
          <h2 className="font-rocaston text-[13px] tracking-[0.22em] text-foreground uppercase leading-none font-bold">ZICABELLA</h2>
        </div>

        {/* Premium Minimal Social Row */}
        <div className="flex justify-center gap-4 mb-8">
          {activeSocialLinks.map(({ url, platform, label }, i) => {
            const Icon = getSocialIcon(platform);
            return (
              <a key={`${label}-${i}`} href={url} target="_blank" rel="noopener noreferrer" aria-label={label}
                className="w-8 h-8 rounded-full border border-foreground/[0.08] dark:border-white/10 flex items-center justify-center text-foreground/50 dark:text-white/40 hover:text-foreground dark:hover:text-white transition-all bg-foreground/[0.01] dark:bg-white/[0.01] hover:border-foreground/20 dark:hover:border-white/20 active:scale-90 shadow-none">
                <Icon className="w-4 h-4" />
              </a>
            );
          })}
        </div>

        {/* Accordions & Newsletter Container */}
        <div className="w-full max-w-md space-y-4">
          
          {/* Panel 1: SHOP (Collapsible) */}
          <div className="relative z-10 bg-white dark:bg-[#0c0c0c] border border-gray-100 dark:border-white/[0.04] rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.01)] transition-colors overflow-hidden">
            <button 
              onClick={() => setShopOpen(!shopOpen)}
              className="w-full flex items-center justify-between p-5 text-left focus:outline-none"
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-foreground">
                SHOP
              </span>
              {shopOpen ? <ChevronUp className="w-4 h-4 text-foreground/50" /> : <ChevronDown className="w-4 h-4 text-foreground/50" />}
            </button>
            
            <AnimatePresence initial={false}>
              {shopOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="px-5 pb-5 pt-0">
                    <div className="h-px w-full bg-gray-50 dark:bg-white/[0.02] mb-3" />
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.12em] font-semibold text-foreground/60">
                      <Link href="/collections" className="hover:text-foreground transition-colors">Collections</Link>
                      <Link href="/blogs" className="hover:text-foreground transition-colors">Journal</Link>
                      <Link href="/profile" className="hover:text-foreground transition-colors">Account</Link>
                      <Link href="/support" className="hover:text-foreground transition-colors">Help</Link>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Panel 2: CUSTOMER CARE (Collapsible, Expanded by Default) */}
          <div className="relative z-10 bg-white dark:bg-[#0c0c0c] border border-gray-100 dark:border-white/[0.04] rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.01)] transition-colors overflow-hidden">
            <button 
              onClick={() => setCustomerCareOpen(!customerCareOpen)}
              className="w-full flex items-center justify-between p-5 text-left focus:outline-none"
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-foreground">
                CUSTOMER CARE
              </span>
              {customerCareOpen ? <ChevronUp className="w-4 h-4 text-foreground/50" /> : <ChevronDown className="w-4 h-4 text-foreground/50" />}
            </button>
            
            <AnimatePresence initial={false}>
              {customerCareOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="px-5 pb-5 pt-0">
                    <div className="h-px w-full bg-gray-50 dark:bg-white/[0.02] mb-4" />
                    <div className="grid grid-cols-2 gap-y-4 gap-x-6">
                      {/* Column 1 */}
                      <div className="space-y-4">
                        <Link href={findPolicyPath("about", "/policies/about-us")} className="flex items-center gap-3 group">
                          <div className="w-8 h-8 rounded-full border border-gray-100 dark:border-white/[0.06] flex items-center justify-center text-foreground/60 bg-gray-50/50 dark:bg-white/[0.01] group-hover:text-foreground group-hover:border-foreground/20 dark:group-hover:border-white/20 transition-all shadow-sm">
                            <Info className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-[10px] font-medium tracking-wide text-foreground/70 group-hover:text-foreground transition-colors">
                            About Us
                          </span>
                        </Link>

                        <Link href="/support" className="flex items-center gap-3 group">
                          <div className="w-8 h-8 rounded-full border border-gray-100 dark:border-white/[0.06] flex items-center justify-center text-foreground/60 bg-gray-50/50 dark:bg-white/[0.01] group-hover:text-foreground group-hover:border-foreground/20 dark:group-hover:border-white/20 transition-all shadow-sm">
                            <Mail className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-[10px] font-medium tracking-wide text-foreground/70 group-hover:text-foreground transition-colors">
                            Contact
                          </span>
                        </Link>

                        <Link href={findPolicyPath("contact-information", "/policies/contact-information")} className="flex items-center gap-3 group">
                          <div className="w-8 h-8 rounded-full border border-gray-100 dark:border-white/[0.06] flex items-center justify-center text-foreground/60 bg-gray-50/50 dark:bg-white/[0.01] group-hover:text-foreground group-hover:border-foreground/20 dark:group-hover:border-white/20 transition-all shadow-sm">
                            <MapPin className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-[10px] font-medium tracking-wide text-foreground/70 group-hover:text-foreground transition-colors">
                            Contact Information
                          </span>
                        </Link>

                        <Link href={findPolicyPath("shipping", "/policies/shipping-policy")} className="flex items-center gap-3 group">
                          <div className="w-8 h-8 rounded-full border border-gray-100 dark:border-white/[0.06] flex items-center justify-center text-foreground/60 bg-gray-50/50 dark:bg-white/[0.01] group-hover:text-foreground group-hover:border-foreground/20 dark:group-hover:border-white/20 transition-all shadow-sm">
                            <Truck className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-[10px] font-medium tracking-wide text-foreground/70 group-hover:text-foreground transition-colors">
                            Shipping Policy
                          </span>
                        </Link>
                      </div>

                      {/* Column 2 */}
                      <div className="space-y-4">
                        <Link href="/orders" className="flex items-center gap-3 group">
                          <div className="w-8 h-8 rounded-full border border-gray-100 dark:border-white/[0.06] flex items-center justify-center text-foreground/60 bg-gray-50/50 dark:bg-white/[0.01] group-hover:text-foreground group-hover:border-foreground/20 dark:group-hover:border-white/20 transition-all shadow-sm">
                            <RotateCcw className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-[10px] font-medium tracking-wide text-foreground/70 group-hover:text-foreground transition-colors">
                            Returns
                          </span>
                        </Link>

                        <Link href={findPolicyPath("terms", "/policies/terms-of-service")} className="flex items-center gap-3 group">
                          <div className="w-8 h-8 rounded-full border border-gray-100 dark:border-white/[0.06] flex items-center justify-center text-foreground/60 bg-gray-50/50 dark:bg-white/[0.01] group-hover:text-foreground group-hover:border-foreground/20 dark:group-hover:border-white/20 transition-all shadow-sm">
                            <FileText className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-[10px] font-medium tracking-wide text-foreground/70 group-hover:text-foreground transition-colors">
                            Terms of Service
                          </span>
                        </Link>

                        <Link href={findPolicyPath("privacy", "/policies/privacy-policy")} className="flex items-center gap-3 group">
                          <div className="w-8 h-8 rounded-full border border-gray-100 dark:border-white/[0.06] flex items-center justify-center text-foreground/60 bg-gray-50/50 dark:bg-white/[0.01] group-hover:text-foreground group-hover:border-foreground/20 dark:group-hover:border-white/20 transition-all shadow-sm">
                            <Lock className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-[10px] font-medium tracking-wide text-foreground/70 group-hover:text-foreground transition-colors">
                            Privacy Policy
                          </span>
                        </Link>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Panel 3: SUPPORT (Collapsible) */}
          <div className="relative z-10 bg-white dark:bg-[#0c0c0c] border border-gray-100 dark:border-white/[0.04] rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.01)] transition-colors overflow-hidden">
            <button 
              onClick={() => setSupportOpen(!supportOpen)}
              className="w-full flex items-center justify-between p-5 text-left focus:outline-none"
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-foreground">
                SUPPORT
              </span>
              {supportOpen ? <ChevronUp className="w-4 h-4 text-foreground/50" /> : <ChevronDown className="w-4 h-4 text-foreground/50" />}
            </button>
            
            <AnimatePresence initial={false}>
              {supportOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="px-5 pb-5 pt-0">
                    <div className="h-px w-full bg-gray-50 dark:bg-white/[0.02] mb-4" />
                    <div className="grid grid-cols-2 gap-y-4 gap-x-6">
                      {/* Column 1 */}
                      <div className="space-y-4">
                        <Link href="/faq" className="flex items-center gap-3 group">
                          <div className="w-8 h-8 rounded-full border border-gray-100 dark:border-white/[0.06] flex items-center justify-center text-foreground/60 bg-gray-50/50 dark:bg-white/[0.01] group-hover:text-foreground group-hover:border-foreground/20 dark:group-hover:border-white/20 transition-all shadow-sm">
                            <HelpCircle className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-[10px] font-medium tracking-wide text-foreground/70 group-hover:text-foreground transition-colors">
                            FAQ&apos;s
                          </span>
                        </Link>

                        <Link href="/orders" className="flex items-center gap-3 group">
                          <div className="w-8 h-8 rounded-full border border-gray-100 dark:border-white/[0.06] flex items-center justify-center text-foreground/60 bg-gray-50/50 dark:bg-white/[0.01] group-hover:text-foreground group-hover:border-foreground/20 dark:group-hover:border-white/20 transition-all shadow-sm">
                            <MapPin className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-[10px] font-medium tracking-wide text-foreground/70 group-hover:text-foreground transition-colors">
                            Track Your Order
                          </span>
                        </Link>
                      </div>

                      {/* Column 2 */}
                      <div className="space-y-4">
                        <Link href="/orders" className="flex items-center gap-3 group">
                          <div className="w-8 h-8 rounded-full border border-gray-100 dark:border-white/[0.06] flex items-center justify-center text-foreground/60 bg-gray-50/50 dark:bg-white/[0.01] group-hover:text-foreground group-hover:border-foreground/20 dark:group-hover:border-white/20 transition-all shadow-sm">
                            <RefreshCw className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-[10px] font-medium tracking-wide text-foreground/70 group-hover:text-foreground transition-colors">
                            Return / Exchange
                          </span>
                        </Link>

                        <Link href={findPolicyPath("refund", "/policies/refund-policy")} className="flex items-center gap-3 group">
                          <div className="w-8 h-8 rounded-full border border-gray-100 dark:border-white/[0.06] flex items-center justify-center text-foreground/60 bg-gray-50/50 dark:bg-white/[0.01] group-hover:text-foreground group-hover:border-foreground/20 dark:group-hover:border-white/20 transition-all shadow-sm">
                            <CreditCard className="w-3.5 h-3.5" />
                          </div>
                          <span className="text-[10px] font-medium tracking-wide text-foreground/70 group-hover:text-foreground transition-colors">
                            Refund / Exchange Policy
                          </span>
                        </Link>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Panel 4: SHIP TO (Collapsible Country Selector Accordion) */}
          {globalStoreEnabled && activeCountries.length > 0 && (
            <div className="relative z-10 bg-white dark:bg-[#0c0c0c] border border-gray-100 dark:border-white/[0.04] rounded-[20px] shadow-[0_2px_8px_rgba(0,0,0,0.01)] transition-colors overflow-hidden">
              <button 
                onClick={() => setShipToOpen(!shipToOpen)}
                className="w-full flex items-center justify-between p-5 text-left focus:outline-none"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-foreground">
                    SHIP TO
                  </span>
                  {(() => {
                    const active = activeCountries.find((c) => c.code === countryCode);
                    return active ? (
                      <span className="text-[8.5px] font-medium tracking-wider text-foreground/40 bg-foreground/[0.04] dark:bg-white/[0.06] border border-foreground/[0.06] dark:border-white/[0.08] px-2 py-0.5 rounded-full">
                        {active.name} ({active.currencySymbol})
                      </span>
                    ) : null;
                  })()}
                </div>
                {shipToOpen ? <ChevronUp className="w-4 h-4 text-foreground/50" /> : <ChevronDown className="w-4 h-4 text-foreground/50" />}
              </button>
              
              <AnimatePresence initial={false}>
                {shipToOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-5 pt-0">
                      <div className="h-px w-full bg-gray-50 dark:bg-white/[0.02] mb-4" />
                      <div className="grid grid-cols-1 gap-2.5">
                        {activeCountries.map((c) => {
                          const isSelected = c.code === countryCode;
                          return (
                            <button
                              key={c.code}
                              type="button"
                              onClick={() => setCountry(c.code)}
                              className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all text-left group ${
                                isSelected
                                  ? "border-foreground/20 bg-foreground/[0.04] dark:bg-white/[0.06]"
                                  : "border-gray-100 dark:border-white/[0.06] bg-gray-50/50 dark:bg-white/[0.01] hover:border-foreground/20 dark:hover:border-white/20"
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <div className={`w-8 h-8 rounded-full border flex items-center justify-center transition-all shadow-sm ${
                                  isSelected
                                    ? "border-foreground/30 bg-foreground text-background dark:bg-white dark:text-black"
                                    : "border-gray-100 dark:border-white/[0.06] text-foreground/60 bg-white dark:bg-[#121212] group-hover:text-foreground group-hover:border-foreground/20 dark:group-hover:border-white/20"
                                }`}>
                                  <Globe className="w-3.5 h-3.5" />
                                </div>
                                <div className="flex flex-col">
                                  <span className={`text-[10px] font-medium tracking-wide transition-colors ${
                                    isSelected ? "text-foreground font-semibold" : "text-foreground/70 group-hover:text-foreground"
                                  }`}>
                                    {c.name}
                                  </span>
                                  <span className="text-[8.5px] font-mono text-foreground/40">
                                    {c.currencySymbol} {c.currencyCode}
                                  </span>
                                </div>
                              </div>
                              {isSelected && (
                                <Check className="w-4 h-4 text-foreground dark:text-white shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Panel 5: STAY IN THE LOOP (Static Card) */}
          <div ref={revealContainerRef} className="relative w-full">
            <motion.div
              style={{ y: revealY, opacity: revealOpacity }}
              className="relative z-0 bg-white dark:bg-[#0c0c0c] border border-gray-100 dark:border-white/[0.04] rounded-[20px] p-5 shadow-[0_2px_8px_rgba(0,0,0,0.01)] text-left"
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.25em] text-foreground block mb-1">
                STAY IN THE LOOP
              </span>
              <p className="text-[10.5px] text-foreground/45 font-light mb-4 leading-none">
                Join our newsletter.
              </p>
              
              <form onSubmit={handleSubscribe} className="flex items-center gap-2.5 w-full">
                <div className="relative flex-1">
                  <input 
                    type="email" 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email" 
                    required
                    className="w-full h-11 bg-transparent border border-gray-200 dark:border-white/[0.08] focus:border-foreground dark:focus:border-white/20 rounded-full px-5 pr-11 text-[11px] focus:outline-none placeholder:text-foreground/25 text-foreground transition-colors leading-none"
                  />
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-foreground/30 pointer-events-none flex items-center justify-center">
                    <Mail className="w-3.5 h-3.5" />
                  </div>
                </div>
                <button 
                  type="submit"
                disabled={subscribing}
                  className="h-11 bg-black dark:bg-white text-white dark:text-black hover:opacity-90 active:scale-95 rounded-full px-5 text-[9px] font-bold tracking-[0.2em] uppercase transition-all shrink-0 flex items-center justify-center"
                >
                  SUBSCRIBE
                </button>
              </form>
            </motion.div>
          </div>

        </div>

        {/* Mobile / Desktop Bottom Footer Copyright */}
        <div className="w-full max-w-md flex justify-center items-center gap-3 text-[7.5px] tracking-[0.12em] font-semibold text-foreground/25 px-1.5 mt-8">
          <div className="flex items-center gap-2">
            <span>© {new Date().getFullYear()} ZICABELLA</span>
            <span>•</span>
            <span>CRAFTED IN INDIA</span>
          </div>
        </div>

      </div>
    </footer>
  );
}

// Custom Spotify SVG Icon
function SpotifyIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.565.387-.86.207-2.377-1.454-5.37-1.783-8.894-.982-.336.075-.668-.135-.744-.47-.077-.337.136-.669.472-.745 3.858-.88 7.15-.503 9.82 1.13.297.182.39.567.206.86zm1.226-2.724c-.226.367-.707.487-1.074.26-2.72-1.672-6.87-2.157-10.077-1.182-.413.125-.847-.107-.972-.52-.125-.413.108-.847.52-.972 3.673-1.114 8.243-.57 11.343 1.34.367.227.487.708.26 1.075zm.105-2.82c-3.26-1.937-8.644-2.115-11.753-1.17-.5.152-1.025-.133-1.177-.633-.15-.5.134-1.025.633-1.176 3.585-1.09 9.524-.887 13.284 1.346.45.267.6.845.333 1.295-.266.45-.845.6-1.295.333z"/>
    </svg>
  );
}

// Custom Apple Music / Music SVG Icon
function Music2Icon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M19 3H9c-1.1 0-2 .9-2 2v11.5c-.75-.41-1.6-.5-2.5-.24-1.62.48-2.5 2.19-2 3.81.49 1.62 2.2 2.5 3.82 2 .98-.3 1.68-1.11 1.68-2.07V9h8v4.5c-.75-.41-1.6-.5-2.5-.24-1.62.48-2.5 2.19-2 3.81.49 1.62 2.2 2.5 3.82 2 .98-.3 1.68-1.11 1.68-2.07V5c0-1.1-.9-2-2-2z"/>
    </svg>
  );
}

// Custom TikTok SVG Icon
function TikTokIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.17-2.86-.74-3.95-1.72-.1.08-.21.17-.3.26-.01 2.82.01 5.64-.01 8.46-.09 1.83-.75 3.73-2.07 4.96-1.57 1.48-3.9 2.06-5.96 1.81-2.19-.24-4.32-1.69-5.16-3.76-.98-2.33-.53-5.26 1.18-7.07 1.41-1.51 3.63-2.2 5.66-1.89v4.03c-1.07-.22-2.29.07-3.04.88-.78.83-.93 2.15-.4 3.12.56 1.05 1.78 1.67 2.95 1.54 1.1-.09 2.02-.99 2.12-2.1.04-1.92.01-3.85.02-5.77.01-4.04-.01-8.07.01-12.11z"/>
    </svg>
  );
}

// Custom X / Twitter SVG Icon
function XIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  );
}

// Custom Pinterest SVG Icon
function PinterestIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2C6.48 2 2 6.48 2 12c0 4.27 2.68 7.91 6.46 9.33-.09-.8-.17-2.03.03-2.9.19-.82 1.2-5.18 1.2-5.18s-.3-.62-.3-1.54c0-1.44.84-2.52 1.88-2.52.88 0 1.31.67 1.31 1.47 0 1.25-.8 3.12-1.21 4.85-.24 1.04.53 1.89 1.55 1.89 1.87 0 3.3-1.97 3.3-4.8 0-2.5-1.8-4.26-4.38-4.26-2.98 0-4.73 2.24-4.73 4.55 0 .9.35 1.87.78 2.39.09.1.1.19.07.3l-.29 1.19c-.05.2-.16.24-.37.14-1.39-.65-2.26-2.67-2.26-4.3 0-3.5 2.54-6.7 7.32-6.7 3.84 0 6.83 2.74 6.83 6.4 0 3.82-2.4 6.9-5.74 6.9-1.12 0-2.18-.58-2.54-1.27l-.69 2.63c-.25.96-.93 2.16-1.39 2.9C10.02 21.87 11 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2z"/>
    </svg>
  );
}

// Custom Snapchat SVG Icon
function SnapchatIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2c-3.79 0-6 2.5-6 4.96 0 1.59.85 2.92 1.63 3.63.26.24.45.54.34.92-.09.32-.42.92-1 .92-.3 0-.61-.17-.92-.17-.55 0-.91.53-.91.95 0 .39.29.62.62.77.72.33 1.48.33 2.24.33 1.23 0 2.26-.67 3.22-1.32.48-.33.95-.65 1.46-.65.29 0 .58.11.83.33 1.15 1.01 2.95 1.64 4.54 1.64.76 0 1.52 0 2.24-.33.33-.15.62-.38.62-.77 0-.42-.36-.95-.91-.95-.31 0-.62.17-.92.17-.58 0-.91-.6-1-.92-.11-.38.08-.68.34-.92.78-.71 1.63-2.04 1.63-3.63C18 4.5 15.79 2 12 2zm0 1.5c3 0 4.5 2 4.5 3.46 0 1.52-1 2.91-2.02 3.6-.54.37-1 .82-.87 1.52.09.47.53 1.08 1.39 1.08.38 0 .86-.2 1.23-.2.27 0 .27.35.08.43-.88.4-1.74.45-2.61.45-1.04 0-1.89-.5-2.73-1.07-.63-.44-1.26-.87-1.98-.87-.31 0-.62.08-.9.27-1.3 1.14-3 1.67-4.73 1.67-.87 0-1.73-.05-2.61-.45-.19-.08-.19-.43.08-.43.37 0 .85.2 1.23.2.86 0 1.3-.61 1.39-1.08.13-.7-.33-1.15-.87-1.52C5.5 8.96 4.5 7.57 4.5 6.96 4.5 5.5 6 3.5 9 3.5c1.17 0 2.12.56 3 .56.88 0 1.83-.56 3-.56z"/>
    </svg>
  );
}

// Custom WhatsApp SVG Icon
function WhatsAppIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.248 8.477 3.517 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.724-1.458L0 24zm6.59-4.846c1.62.962 3.21 1.47 5.366 1.472 5.434 0 9.858-4.417 9.861-9.848.002-2.63-1.02-5.101-2.88-6.961C17.078 1.957 14.6 1.936 12.004 1.936c-5.438 0-9.863 4.418-9.866 9.85-.001 1.942.493 3.834 1.43 5.513l-.955 3.49 3.58-.936zm11.367-7.25c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.669.149-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
    </svg>
  );
}
