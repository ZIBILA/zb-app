"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import NextImage from "next/image";
import { handleImageError } from "./ImagePlaceholder";

interface LazyVideoProps {
  src: string;
  className?: string;
  poster?: string;
  fallbackImage?: string;
}

export default function LazyVideo({ src, className, poster, fallbackImage }: LazyVideoProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Observe visibility of the container (works on both mobile & desktop)
  useEffect(() => {
    if (!mounted) return;
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
        // Once visible for the first time, mark as loaded so we keep the video element
        if (entry.isIntersecting) setHasLoaded(true);
      },
      { rootMargin: "200px 0px", threshold: 0.01 }
    );

    observer.observe(el);
    return () => observer.unobserve(el);
  }, [mounted]);

  // Play / pause based on visibility
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isVisible) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isVisible, hasLoaded]);

  // SSR: show fallback or placeholder
  if (!mounted) {
    if (fallbackImage) {
      return (
        <div className="relative w-full h-full">
          <NextImage
            src={fallbackImage}
            alt="Section Media"
            fill
            className="object-cover"
            onError={handleImageError}
          />
        </div>
      );
    }
    return <div className="w-full h-full bg-foreground/[0.03]" />;
  }

  // One stable tree for mobile and desktop: the fallback image stays mounted underneath and the
  // video is added on top once in view. (Swapping trees here remounted the image and made it flash.)
  return (
    <div ref={containerRef} className="relative w-full h-full">
      {/* Show fallback image behind video while it loads */}
      {fallbackImage && (
        <NextImage
          src={fallbackImage}
          alt="Section Media"
          fill
          className="object-cover"
          onError={handleImageError}
          style={{ zIndex: 0 }}
        />
      )}
      {/* Only mount the video element once the section has been scrolled into view */}
      {hasLoaded && (
        <video
          ref={videoRef}
          src={src}
          className={`${className || ""} relative`}
          poster={poster}
          muted
          loop
          playsInline
          preload="none"
          style={{ zIndex: 1 }}
        />
      )}
      {/* If no fallback and not yet loaded, show a subtle placeholder */}
      {!fallbackImage && !hasLoaded && (
        <div className="w-full h-full bg-foreground/[0.02]" />
      )}
    </div>
  );
}
