"use client";

import { useState, useRef, useEffect } from "react";
import { VolumeX, Volume2 } from "lucide-react";


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
    if (!videoRef.current) return;
    if (isInView) {
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
    }
  }, [isInView]);

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
      {!showControlOnly && (
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={poster || undefined}
          className="w-full h-full object-cover transition-all duration-700"
        >
          {mobileSrc &&
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
          {desktopSources.map((url) => {
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
