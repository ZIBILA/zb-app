"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useProductCardCarousel } from "@/hooks/useProductCardCarousel";
import { handleImageError } from "./ImagePlaceholder";

// 1×1 transparent gray pixel — universal blur placeholder fallback
const BLUR_FALLBACK =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN88P/BfwAJhAPk3KFb5QAAAABJRU5ErkJggg==";

interface ProductCardImageProps {
  images: { id: number; src: string }[];
  title: string;
  priority?: boolean;
  isSoldOut: boolean;
  productSlug: string | number;
}

/** Generate a Shopify CDN blur URL (20px wide, lowest quality) */
function blurUrl(src: string): string {
  if (!src || src.startsWith("/") || src.startsWith("data:")) return BLUR_FALLBACK;
  try {
    const u = new URL(src);
    u.searchParams.set("width", "20");
    u.searchParams.set("quality", "10");
    return u.toString();
  } catch {
    return BLUR_FALLBACK;
  }
}

export default function ProductCardImage({
  images,
  title,
  priority = false,
  isSoldOut,
  productSlug,
}: ProductCardImageProps) {
  const imageSrcs = useMemo(
    () => images.filter((i) => i.src).map((i) => i.src),
    [images]
  );
  const count = imageSrcs.length;
  const fallback = "/section-image1.webp";
  const firstSrc = imageSrcs[0] || fallback;
  const hasMultiple = count > 1;

  // ── Hover / timer state (synchronized with carousel index) ──
  const containerRef = useRef<HTMLDivElement>(null);
  const isTouchActive = useRef(false);
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear timer when swipe starts — passed as callback to carousel hook
  const onSwipeStart = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovered(false);
  }, []);

  // ── Carousel hook ──
  const {
    currentIndex,
    isSwiping,
    trackStyle,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onMouseLeave,
    onTransitionEnd,
    goToIndex,
  } = useProductCardCarousel(count, onSwipeStart);

  // Helper to dynamically check if the client device is a mobile/touch interface
  const checkIsMobile = useCallback(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(hover: none)").matches;
  }, []);

  // ── Desktop hover handlers ──
  const handleMouseEnter = useCallback(() => {
    if (!hasMultiple || checkIsMobile() || isTouchActive.current) return;
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovered(true);
    goToIndex(1, false); // Instantly translate underlying track to index 1 under the hood
  }, [hasMultiple, checkIsMobile, goToIndex]);

  const handleMouseLeave = useCallback(() => {
    if (checkIsMobile() || isTouchActive.current) return;
    onMouseLeave(); // also ends any active drag
    if (!hasMultiple) return;
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
      goToIndex(0, false); // Instantly shift underlying track back to 0 under the hood
    }, 2000);
  }, [checkIsMobile, hasMultiple, onMouseLeave, goToIndex]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovered(false);
    onMouseDown(e);
  }, [onMouseDown]);

  const handleMouseUp = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    onMouseUp();
  }, [onMouseUp]);

  // Cleanup hover timers on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  // ── Touch handlers attached via useEffect (non-passive touchmove support) ──
  // Stable refs to avoid re-attaching listeners on every render
  const onTouchStartRef = useRef(onTouchStart);
  const onTouchMoveRef = useRef(onTouchMove);
  const onTouchEndRef = useRef(onTouchEnd);

  useEffect(() => {
    onTouchStartRef.current = onTouchStart;
    onTouchMoveRef.current = onTouchMove;
    onTouchEndRef.current = onTouchEnd;
  }, [onTouchStart, onTouchMove, onTouchEnd]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !hasMultiple) return;

    const handleTouchStart = (e: TouchEvent) => {
      isTouchActive.current = true;
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
      setIsHovered(false);
      onTouchStartRef.current(e);
    };

    const handleTouchMove = (e: TouchEvent) => {
      onTouchMoveRef.current(e);
    };

    const handleTouchEnd = () => {
      onTouchEndRef.current();
    };

    const handleTouchCancel = () => {
      onTouchEndRef.current();
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    el.addEventListener("touchcancel", handleTouchCancel, { passive: true });

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [hasMultiple]); // Only re-attach when hasMultiple changes — handlers use stable refs

  // ── Progressive loading: lazy preload pipeline ──
  const loadedSet = useRef(new Set<number>());
  const [preloadUpTo, setPreloadUpTo] = useState(0);

  const onFirstLoad = useCallback(() => {
    loadedSet.current.add(0);
    if (count >= 2) setPreloadUpTo(1);
  }, [count]);

  // When carousel index changes, preload one ahead
  useEffect(() => {
    if (currentIndex + 1 < count) {
      setPreloadUpTo((prev) => Math.max(prev, currentIndex + 1));
    }
  }, [currentIndex, count]);

  // ── Blur placeholder state per image ──
  const [loadedImages, setLoadedImages] = useState<Set<number>>(new Set());

  const handleImageLoad = useCallback((idx: number) => {
    loadedSet.current.add(idx);
    setLoadedImages((prev) => {
      const next = new Set(prev);
      next.add(idx);
      return next;
    });
    if (idx + 1 < count) {
      setPreloadUpTo((p) => Math.max(p, idx + 1));
    }
  }, [count]);

  const isFallback = firstSrc === fallback;
  const sizesAttr = "(max-width: 768px) 50vw, 25vw";

  // Intercept click to prevent navigation during swipes/drags
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (isSwiping) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [isSwiping]
  );

  return (
    <Link
      href={`/products/${productSlug}`}
      className="block"
      onClick={handleClick}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      aria-label={title}
    >
      <div
        ref={containerRef}
        className="relative w-full rounded-none overflow-hidden mb-1.5 transition-all duration-500 bg-foreground/[0.02] select-none"
        style={{
          aspectRatio: "3 / 5.2",
          contain: "layout style paint",
          touchAction: hasMultiple ? "pan-y pinch-zoom" : "auto",
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseDown={hasMultiple ? handleMouseDown : undefined}
        onMouseMove={hasMultiple ? onMouseMove : undefined}
        onMouseUp={hasMultiple ? handleMouseUp : undefined}
      >
        {hasMultiple ? (
          <>
            {/* ─── Carousel track (base layer) ─── */}
            <div
              className="absolute inset-0 z-[1] flex"
              style={trackStyle}
              onTransitionEnd={onTransitionEnd}
            >
              {imageSrcs.map((src, idx) => {
                const shouldRender = idx <= preloadUpTo || idx === currentIndex;
                return (
                  <div
                    key={idx}
                    className="relative flex-shrink-0 w-full h-full"
                    style={{ minWidth: "100%" }}
                  >
                    {/* Blur placeholder layer */}
                    {shouldRender && !loadedImages.has(idx) && (
                      <img
                        src={blurUrl(src)}
                        alt=""
                        aria-hidden
                        draggable={false}
                        className="absolute inset-0 w-full h-full object-cover"
                        style={{
                          filter: "blur(8px)",
                          transform: "scale(1.05)",
                          transition: "filter 400ms ease, transform 400ms ease",
                        }}
                      />
                    )}
                    {shouldRender ? (
                      <Image
                        src={src}
                        alt={`${title} - image ${idx + 1}`}
                        fill
                        loading={idx === 0 && priority ? undefined : "lazy"}
                        priority={idx === 0 && priority}
                        quality={75}
                        sizes={sizesAttr}
                        placeholder={isFallback ? undefined : "blur"}
                        blurDataURL={isFallback ? undefined : blurUrl(src)}
                        draggable={false}
                        onError={handleImageError}
                        onLoad={
                          idx === 0 ? onFirstLoad : () => handleImageLoad(idx)
                        }
                        className="object-cover select-none"
                        style={{
                          ...(isSoldOut ? { filter: "grayscale(0.4)" } : {}),
                        }}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* ─── Premium Hover Zoom Overlay ─── */}
            {imageSrcs[1] && (
              <div
                className="absolute inset-0 z-[2] pointer-events-none overflow-hidden"
                style={{
                  opacity: isHovered && !isSwiping ? 1 : 0,
                  transform: isHovered && !isSwiping ? "scale(1.03)" : "scale(1)",
                  transition: isSwiping
                    ? "none"
                    : "opacity 400ms cubic-bezier(0.16, 1, 0.3, 1), transform 400ms cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              >
                <Image
                  src={imageSrcs[1]}
                  alt={`${title} - alternate view`}
                  fill
                  loading="lazy"
                  quality={75}
                  sizes={sizesAttr}
                  placeholder="blur"
                  blurDataURL={blurUrl(imageSrcs[1])}
                  onError={handleImageError}
                  className="object-cover"
                  style={isSoldOut ? { filter: "grayscale(0.4)" } : {}}
                />
              </div>
            )}
          </>
        ) : (
          /* ─── Single-image path (no carousel, no hover) ─── */
          <div className="absolute inset-0 z-[1]">
            {/* Blur placeholder */}
            {!loadedImages.has(0) && firstSrc !== fallback && (
              <img
                src={blurUrl(firstSrc)}
                alt=""
                aria-hidden
                draggable={false}
                className="absolute inset-0 w-full h-full object-cover"
                style={{
                  filter: "blur(8px)",
                  transform: "scale(1.05)",
                  transition: "filter 400ms ease, transform 400ms ease",
                }}
              />
            )}
            <Image
              src={firstSrc}
              alt={title}
              fill
              priority={priority}
              quality={75}
              sizes={sizesAttr}
              placeholder={isFallback ? undefined : "blur"}
              blurDataURL={isFallback ? undefined : blurUrl(firstSrc)}
              onError={handleImageError}
              onLoad={onFirstLoad}
              className={`object-cover transition-all duration-800 ease-out ${!isSoldOut ? "group-hover:scale-[1.03]" : ""}`}
              style={
                isSoldOut
                  ? { filter: "grayscale(0.4)" }
                  : {}
              }
            />
          </div>
        )}

        {/* ─── Hover subtle overlay (preserved from original) ─── */}
        {!isSoldOut && (
          <div
            className="absolute inset-0 z-[3] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
            style={{
              background:
                "linear-gradient(180deg, transparent 60%, rgba(0,0,0,0.1) 100%)",
            }}
          />
        )}

        {/* Dots removed — clean minimal design */}
      </div>
    </Link>
  );
}
