"use client";

import { motion, useTransform, useSpring, useMotionValue } from "framer-motion";
import { useRef, useState, useEffect, useCallback } from "react";
import NextImage from "next/image";
import Link from "next/link";
import { handleImageError } from "./ImagePlaceholder";
import AspectFitImage from "./AspectFitImage";

interface FlipbookProps {
  imgUrl?: string;
  videoUrl?: string;
  imgUrlMobile?: string;
  videoUrlMobile?: string;
  tag?: string;
  title?: string;
  desc?: string;
  link?: string;
}

export default function FlipbookSection({ imgUrl, videoUrl, imgUrlMobile, videoUrlMobile, tag, title, desc, link }: FlipbookProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoDesktopRef = useRef<HTMLVideoElement>(null);
  const videoMobileRef = useRef<HTMLVideoElement>(null);

  const [mounted, setMounted] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // IntersectionObserver for lazy video loading and play/pause
  useEffect(() => {
    if (!mounted) return;
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { rootMargin: "100px 0px", threshold: 0.05 }
    );

    observer.observe(el);
    return () => observer.unobserve(el);
  }, [mounted]);

  // Play/pause videos based on visibility
  useEffect(() => {
    [videoDesktopRef.current, videoMobileRef.current].forEach(video => {
      if (!video) return;
      if (isVisible) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });
  }, [isVisible]);

  // Stable scroll-progress that ignores in-app browser toolbar-triggered
  // viewport resizes (50-150px height-only changes).
  const scrollYProgress = useMotionValue(0);
  const cachedLayout = useRef<{ top: number; height: number; winW: number; winH: number } | null>(null);

  const measureLayout = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    cachedLayout.current = {
      top: rect.top + scrollTop,
      height: rect.height,
      winW: window.innerWidth,
      winH: window.innerHeight,
    };
  }, []);

  useEffect(() => {
    if (!mounted) return;
    measureLayout();

    const onScroll = () => {
      const layout = cachedLayout.current;
      if (!layout) return;
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      const winH = window.innerHeight;
      // offset: ["start end", "end start"] means:
      //   progress 0 = element top reaches viewport bottom
      //   progress 1 = element bottom reaches viewport top
      const start = layout.top - winH; // element top at viewport bottom
      const end = layout.top + layout.height; // element bottom at viewport top
      const range = end - start;
      if (range <= 0) return;
      const progress = Math.min(1, Math.max(0, (scrollTop - start) / range));
      scrollYProgress.set(progress);
    };

    const onResize = () => {
      const prev = cachedLayout.current;
      if (!prev) {
        measureLayout();
        return;
      }
      const newW = window.innerWidth;
      const newH = window.innerHeight;
      const dW = Math.abs(newW - prev.winW);
      const dH = Math.abs(newH - prev.winH);
      // Ignore height-only changes in the 40-160px range (toolbar toggle)
      if (dW < 2 && dH >= 40 && dH <= 160) return;
      measureLayout();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    // Sections above (carousels, community) finish loading after mount and push this one down;
    // re-measure when the page height changes so the scroll-linked scale doesn't use a stale offset.
    const bodyObserver = new ResizeObserver(() => measureLayout());
    bodyObserver.observe(document.body);
    // Fire once to set initial progress
    onScroll();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      bodyObserver.disconnect();
    };
  }, [mounted, measureLayout, scrollYProgress]);

  const smoothProgress = useSpring(scrollYProgress, { stiffness: 80, damping: 25, restDelta: 0.001 });
  const imageScale = useTransform(smoothProgress, [0, 0.5, 1], [1.05, 1, 1.05]);

  const desktopVideo = videoUrl;
  const desktopImg = imgUrl;
  const mobileVideo = videoUrlMobile || videoUrl;
  const mobileImg = imgUrlMobile || imgUrl;

  if (!desktopImg && !desktopVideo && !mobileImg && !mobileVideo) return null;

  const hasText = tag || title || desc;
  const hasLink = link && link.trim() !== '';
  const linkHref = hasLink ? `/collections/${link}` : undefined;

  // Build semantic attributes for SEO
  const sectionAriaLabel = title ? `${title} - ${tag || 'Featured Collection'}` : 'Featured Collection';

  const textOverlay = (variant: "desktop" | "mobile") =>
    hasText && (
      <>
        <div className={`absolute inset-0 bg-gradient-to-t ${variant === "desktop" ? "from-black/60 via-black/15" : "from-black/65 via-black/20"} to-transparent pointer-events-none z-10`} />
        <div className={`absolute inset-0 z-20 flex items-end ${variant === "desktop" ? "p-12 lg:p-16" : "p-6"}`}>
          <div className={variant === "desktop" ? "max-w-xl space-y-3" : "max-w-md space-y-2"}>
            {variant === "desktop" ? (
              <>
                {tag && <span className="inline-block text-[9px] font-bold text-white/50 uppercase tracking-[0.3em]">{tag}</span>}
                {title && <h3 className="font-heading text-2xl md:text-3xl lg:text-4xl font-black uppercase tracking-[0.06em] text-white leading-none">{title}</h3>}
                {desc && <p className="text-[11px] md:text-[12px] text-white/60 font-normal leading-relaxed tracking-wider max-w-md">{desc}</p>}
              </>
            ) : (
              <>
                {tag && <span className="inline-block text-[8px] font-bold text-white/50 uppercase tracking-[0.3em]">{tag}</span>}
                {title && <h3 className="font-heading text-lg font-black uppercase tracking-[0.06em] text-white leading-none">{title}</h3>}
                {desc && <p className="text-[10px] text-white/55 font-normal leading-relaxed tracking-wider">{desc}</p>}
              </>
            )}
          </div>
        </div>
      </>
    );

  // Videos keep a fixed cinematic frame; images render at their own aspect ratio so banners are never cropped.
  const desktopMedia = desktopVideo ? (
    <motion.div className="absolute inset-0" style={{ scale: imageScale, opacity: 1 }}>
      {mounted ? (
        <video ref={videoDesktopRef} src={desktopVideo} loop muted playsInline preload="none" className="w-full h-full object-cover" />
      ) : desktopImg ? (
        <NextImage src={desktopImg} alt={title || "Feature Section"} fill className="object-cover" sizes="100vw" onError={handleImageError} />
      ) : null}
    </motion.div>
  ) : desktopImg ? (
    <AspectFitImage src={desktopImg} alt={title || "Feature Section"} defaultRatio={21 / 9} maxHeight="85vh" />
  ) : null;

  const mobileMedia = mobileVideo ? (
    <div className="absolute inset-0">
      {mounted ? (
        <video ref={videoMobileRef} src={mobileVideo} loop muted playsInline preload="none" className="w-full h-full object-cover" />
      ) : mobileImg ? (
        <NextImage src={mobileImg} alt={title || "Feature Section"} fill className="object-cover" sizes="100vw" onError={handleImageError} />
      ) : null}
    </div>
  ) : mobileImg ? (
    <AspectFitImage src={mobileImg} alt={title || "Feature Section"} defaultRatio={4 / 5} />
  ) : null;

  const frameBase = "relative block w-full overflow-hidden shadow-2xl border-y border-foreground/[0.03] dark:border-white/[0.04] group";
  const desktopFrame = `${frameBase} ${desktopVideo ? "aspect-[21/9]" : ""} ${hasLink ? "cursor-pointer" : ""}`;
  const mobileFrame = `${frameBase} ${mobileVideo ? "aspect-[3/4.2]" : ""} ${hasLink ? "cursor-pointer" : ""}`;

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden bg-transparent">
      <section aria-label={sectionAriaLabel} itemScope itemType="https://schema.org/CollectionPage">
        {/* Hidden SEO metadata */}
        {hasLink && <meta itemProp="url" content={`/collections/${link}`} />}
        {title && <meta itemProp="name" content={title} />}
        {desc && <meta itemProp="description" content={desc} />}

        {/* ── Desktop View ── */}
        <div className="hidden md:block">
          {hasLink ? (
            <Link href={linkHref!} className={desktopFrame} aria-label={`View ${title || 'featured'} collection`}>
              {desktopMedia}
              {textOverlay("desktop")}
            </Link>
          ) : (
            <div className={desktopFrame}>
              {desktopMedia}
              {textOverlay("desktop")}
            </div>
          )}
        </div>

        {/* ── Mobile View ── */}
        <div className="md:hidden">
          {hasLink ? (
            <Link href={linkHref!} className={mobileFrame} aria-label={`View ${title || 'featured'} collection`}>
              {mobileMedia}
              {textOverlay("mobile")}
            </Link>
          ) : (
            <div className={mobileFrame}>
              {mobileMedia}
              {textOverlay("mobile")}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
