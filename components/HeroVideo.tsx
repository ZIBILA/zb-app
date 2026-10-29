"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { VolumeX, Volume2 } from "lucide-react";


function guessVideoType(url: string): string | undefined {
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".mp4")) return "video/mp4";
  if (path.endsWith(".webm")) return "video/webm";
  if (path.endsWith(".ogg") || path.endsWith(".ogv")) return "video/ogg";
  return undefined;
}

/** Upper bound on how long the video file waits for the page to settle before it starts loading. */
const VIDEO_START_CAP_MS = 4000;

interface HeroVideoProps {
  src: string;
  mobileSrc?: string;
  /** Optional second source, tried only if `src` fails. No bundled default — the CMS owns the hero video. */
  fallbackSrc?: string;
  poster?: string;
  showControlOnly?: boolean;
}

export default function HeroVideo({
  src,
  mobileSrc,
  fallbackSrc,
  poster,
  showControlOnly = false,
}: HeroVideoProps) {
  const [isMuted, setIsMuted] = useState(true);
  const [isInView, setIsInView] = useState(false);
  // The <source> tags are attached only after the page has loaded (or 4 s, whichever is first),
  // so the 4 MB video no longer competes with the poster, CSS, fonts and product images on a
  // phone connection. The poster below is a real responsive <img>, so it is the hero's LCP
  // candidate and paints as soon as it arrives; the video draws over it once it can play.
  const [sourcesReady, setSourcesReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const primarySrc = src;

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => setIsInView(entry.isIntersecting),
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (showControlOnly) return;
    let started = false;
    let idleId: number | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      if (started) return;
      started = true;
      setSourcesReady(true);
    };
    const afterLoad = () => {
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(start, { timeout: 1500 });
      } else {
        idleTimer = setTimeout(start, 200);
      }
    };
    if (document.readyState === "complete") afterLoad();
    else window.addEventListener("load", afterLoad, { once: true });
    const cap = setTimeout(start, VIDEO_START_CAP_MS);
    return () => {
      window.removeEventListener("load", afterLoad);
      if (idleId !== undefined && typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(idleId);
      if (idleTimer) clearTimeout(idleTimer);
      clearTimeout(cap);
    };
  }, [showControlOnly]);

  // Once the sources exist, (re)load so the element picks the media-matched one, then play if visible.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !sourcesReady) return;
    el.load();
    if (isInView) el.play().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcesReady]);

  useEffect(() => {
    if (!videoRef.current || !sourcesReady) return;
    if (isInView) {
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
    }
  }, [isInView, sourcesReady]);

  const toggle = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  // Desktop + mobile sources via media attributes (no JS hydration swap / double download)
  const desktopSources = [primarySrc, fallbackSrc].filter(
    (url, i, arr): url is string => Boolean(url) && arr.indexOf(url) === i
  );
  const mobileSources = mobileSrc
    ? [mobileSrc, ...desktopSources].filter(
        (url, i, arr): url is string => Boolean(url) && arr.indexOf(url) === i
      )
    : desktopSources;

  return (
    <div
      className="absolute inset-0 w-full h-full cursor-pointer group/hero"
      onClick={toggle}
    >
      {!showControlOnly && poster && (
        // Responsive poster: the Shopify CDN serves the width the phone needs instead of the
        // full-size original, and it is preloaded with high priority as the LCP image.
        <Image
          src={poster}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      )}
      {!showControlOnly && (
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          preload="none"
          className="absolute inset-0 w-full h-full object-cover transition-all duration-700"
        >
          {sourcesReady &&
            mobileSrc &&
            mobileSources.map((url) => {
              const type = guessVideoType(url);
              return type ? (
                <source
                  key={`m-${url}`}
                  src={url}
                  type={type}
                  media="(max-width: 768px)"
                />
              ) : (
                <source key={`m-${url}`} src={url} media="(max-width: 768px)" />
              );
            })}
          {sourcesReady &&
            desktopSources.map((url) => {
              const type = guessVideoType(url);
              return type ? (
                <source key={`d-${url}`} src={url} type={type} />
              ) : (
                <source key={`d-${url}`} src={url} />
              );
            })}
        </video>
      )}

      {/* Absolute minimal mute icon */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        className="absolute bottom-6 right-6 z-50 flex items-center justify-center p-2.5 rounded-full bg-black/40 backdrop-blur-md text-white/70 hover:text-white hover:scale-105 active:scale-90 transition-all drop-shadow-lg border border-white/10"
        aria-label={isMuted ? "Unmute" : "Mute"}
      >
        {isMuted ? (
          <VolumeX className="w-3.5 h-3.5" />
        ) : (
          <Volume2 className="w-3.5 h-3.5" />
        )}
      </button>

      {/* Brief center icon flash on press */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-0 group-active/hero:opacity-100 transition-opacity">
        <div className="p-4 rounded-full bg-black/10 backdrop-blur-sm border border-white/5">
          {isMuted ? (
            <VolumeX className="w-4 h-4 text-white/40" />
          ) : (
            <Volume2 className="w-4 h-4 text-white/70" />
          )}
        </div>
      </div>
    </div>
  );
}
