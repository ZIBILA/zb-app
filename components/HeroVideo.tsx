"use client";

import { useState, useRef, useEffect } from "react";
import { VolumeX, Volume2 } from "lucide-react";

/** Bundled local asset — used only if the primary URL fails to load (e.g. missing .mp4 on localhost/dev). */
const LOCAL_WEBM_FALLBACK = "/zb-video-heroo.webm";

function guessVideoType(url: string): string | undefined {
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".mp4")) return "video/mp4";
  if (path.endsWith(".webm")) return "video/webm";
  if (path.endsWith(".ogg") || path.endsWith(".ogv")) return "video/ogg";
  return undefined;
}

interface HeroVideoProps {
  src: string;
  mobileSrc?: string;
  /** Tried only if `src` fails. Defaults to the local .webm so localhost/dev still work when the .mp4 is absent. */
  fallbackSrc?: string;
  poster?: string;
  showControlOnly?: boolean;
}

export default function HeroVideo({
  src,
  mobileSrc,
  fallbackSrc = LOCAL_WEBM_FALLBACK,
  poster,
  showControlOnly = false,
}: HeroVideoProps) {
  const [isMuted, setIsMuted] = useState(true);
  const [isInView, setIsInView] = useState(false);
  // null until hydrated. The server (and the first client render) emit the <video> with the poster
  // only, so the poster is the LCP image, mobile never downloads the desktop file, and there is no
  // hydration mismatch. The right source is attached right after hydration.
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mounted = isMobile !== null;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mediaQuery.addEventListener("change", handler);
    // Attach the video only once the page has finished loading (the poster is shown meanwhile), so
    // the multi-MB file never competes with the LCP image, fonts and JS on a slow connection.
    const arm = () => setIsMobile(mediaQuery.matches);
    if (document.readyState === "complete") arm();
    else window.addEventListener("load", arm, { once: true });
    return () => {
      mediaQuery.removeEventListener("change", handler);
      window.removeEventListener("load", arm);
    };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const el = videoRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsInView(entry.isIntersecting),
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [mounted, isMobile]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (isInView) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, [isInView, isMobile]);

  const toggle = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const activeSrc = mounted ? ((isMobile && mobileSrc) ? mobileSrc : src) : null;
  // Primary first (prod settings / CDN keep winning). Local .webm is only reached if primary 404s / can't play.
  const sources = activeSrc
    ? [activeSrc, fallbackSrc].filter((url, i, arr): url is string => Boolean(url) && arr.indexOf(url) === i)
    : [];

  return (
    <div 
      className="absolute inset-0 w-full h-full cursor-pointer group/hero"
      onClick={toggle}
    >
      {!showControlOnly && (
        <video
          ref={videoRef}
          key={sources.join("|") || "poster-only"}
          autoPlay
          muted
          loop
          playsInline
          preload={mounted ? "auto" : "none"}
          poster={poster || undefined}
          className="w-full h-full object-cover transition-all duration-700"
        >
          {sources.map((url) => {
            const type = guessVideoType(url);
            return type ? (
              <source key={url} src={url} type={type} />
            ) : (
              <source key={url} src={url} />
            );
          })}
        </video>
      )}
      
      {/* Absolute minimal mute icon */}
      <button
        className="absolute bottom-6 right-6 z-50 flex items-center justify-center p-2 text-white/40 hover:text-white active:scale-90 transition-all drop-shadow-lg"
        aria-label={isMuted ? "Unmute" : "Mute"}
      >
        {isMuted ? (
          <VolumeX className="w-3 h-3" />
        ) : (
          <Volume2 className="w-3 h-3" />
        )}
      </button>

      {/* Visual Indicator Overlay */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-active/hero:opacity-100 transition-opacity">
        <div className="p-4 rounded-full bg-black/10 backdrop-blur-sm border border-white/5">
          {isMuted ? <VolumeX className="w-4 h-4 text-white/40" /> : <Volume2 className="w-4 h-4 text-white/70" />}
        </div>
      </div>
    </div>
  );
}
