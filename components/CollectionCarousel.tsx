"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Collection {
  id: string | number;
  title: string;
  handle: string;
  image?: { src: string } | null;
}

const FALLBACKS = [
  "https://images.unsplash.com/photo-1490481651871-ab68de25d43d?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?q=80&w=800&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1509631179647-0177331693ae?q=80&w=800&auto=format&fit=crop",
];

// Fluid Apple-style spring physics for smooth release snap
const SPRING = {
  type: "spring" as const,
  stiffness: 280,
  damping: 30,
  mass: 0.6,
  restDelta: 0.001,
};

const INSTANT = {
  type: "tween" as const,
  duration: 0,
};

/**
 * Wraps rawDiff into the range (-total/2, total/2] so cards always
 * take the shortest visual path around the ring.
 */
function wrapDiff(rawDiff: number, total: number): number {
  let d = rawDiff % total;
  if (d > total / 2) d -= total;
  if (d <= -total / 2) d += total;
  return d;
}

export default function CollectionCarousel({ collections }: { collections: Collection[] }) {
  const [index, setIndex] = useState(0);
  // rAF-throttled drag offset: ref is updated synchronously per pointermove,
  // state is flushed at most once per animation frame for 60fps smoothness.
  const dragOffsetRef = useRef(0);
  const [dragOffsetForRender, setDragOffsetForRender] = useState(0);
  const rafId = useRef(0);
  const total = collections.length;

  const dragStartX = useRef(0);
  const dragStartY = useRef(0);
  const dragStartTime = useRef(0);
  const isDragging = useRef(false);
  const isHorizontalDrag = useRef<boolean | null>(null);
  const hasMoved = useRef(false);
  const lastWheelTime = useRef(0);

  const go = useCallback(
    (dir: 1 | -1) => {
      setIndex((i) => (i + dir + total) % total);
    },
    [total]
  );

  // Trackpad / Scroll Wheel Swipe for Desktop
  const handleWheel = (e: React.WheelEvent) => {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(delta) < 10) return;

    const now = Date.now();
    if (now - lastWheelTime.current < 250) return;

    lastWheelTime.current = now;
    go(delta > 0 ? 1 : -1);
  };

  // Fluid pointer / touch gesture handling
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if ((e.target as HTMLElement).closest("button")) return;

    dragStartX.current = e.clientX;
    dragStartY.current = e.clientY;
    dragStartTime.current = Date.now();
    isDragging.current = true;
    hasMoved.current = false;
    isHorizontalDrag.current = null;
    dragOffsetRef.current = 0;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return;

    const dx = e.clientX - dragStartX.current;
    const dy = e.clientY - dragStartY.current;

    // Disambiguate vertical page scroll vs horizontal carousel drag
    if (isHorizontalDrag.current === null) {
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        isHorizontalDrag.current = Math.abs(dx) > Math.abs(dy);
      }
    }

    if (isHorizontalDrag.current) {
      if (Math.abs(dx) > 6) {
        hasMoved.current = true;
      }
      // Write to ref synchronously (zero overhead), schedule rAF flush
      dragOffsetRef.current = dx;
      if (!rafId.current) {
        rafId.current = requestAnimationFrame(() => {
          setDragOffsetForRender(dragOffsetRef.current);
          rafId.current = 0;
        });
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;

    // Cancel any pending rAF before committing final state
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = 0;
    }

    const dx = e.clientX - dragStartX.current;
    const dt = Date.now() - dragStartTime.current;
    const velocity = Math.abs(dx) / Math.max(dt, 1);
    const threshold = velocity > 0.35 ? 25 : 70;

    if (isHorizontalDrag.current && Math.abs(dx) > threshold) {
      go(dx < 0 ? 1 : -1);
    }

    dragOffsetRef.current = 0;
    setDragOffsetForRender(0);
    isHorizontalDrag.current = null;
  };

  // Clean up rAF on unmount
  useEffect(() => {
    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, []);

  if (!total) return null;

  // How many neighbor cards to render on each side
  const renderRadius = Math.min(3, Math.floor(total / 2));

  return (
    <>
      {/* ─── DESKTOP VIEW (md and up) ─── */}
      <div className="hidden md:block relative w-full select-none py-2">
        <div
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="relative w-full flex items-center justify-center cursor-grab active:cursor-grabbing overflow-hidden"
          style={{ height: "min(72vh, 560px)", touchAction: "pan-y" }}
        >
          {/* Stage for desktop cards */}
          <div className="relative w-full h-full flex items-center justify-center pointer-events-none">
            {collections.map((col, i) => {
              const rawDiff = i - index - dragOffsetForRender / 360;
              const diff = wrapDiff(rawDiff, total);

              if (Math.abs(diff) > renderRadius + 0.5) return null;

              return (
                <DesktopStackedCard
                  key={`desk-${col.id}`}
                  collection={col}
                  diff={diff}
                  isDragging={isDragging.current}
                  fallback={FALLBACKS[i % FALLBACKS.length]}
                  hasMoved={hasMoved}
                  onSelect={() => setIndex(i)}
                />
              );
            })}
          </div>

          {/* Minimal Desktop Chevrons for swipe / slide navigation */}
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              go(-1);
            }}
            className="absolute left-4 lg:left-12 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full border border-foreground/10 bg-background/80 dark:bg-black/80 backdrop-blur-md text-foreground hover:text-foreground hover:scale-110 active:scale-95 transition-all flex items-center justify-center z-50 shadow-xl cursor-pointer pointer-events-auto"
            aria-label="Previous Collection"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              go(1);
            }}
            className="absolute right-4 lg:right-12 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full border border-foreground/10 bg-background/80 dark:bg-black/80 backdrop-blur-md text-foreground hover:text-foreground hover:scale-110 active:scale-95 transition-all flex items-center justify-center z-50 shadow-xl cursor-pointer pointer-events-auto"
            aria-label="Next Collection"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* ─── MOBILE VIEW (sm and below) ─── */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="md:hidden relative w-full select-none touch-pan-y cursor-grab active:cursor-grabbing"
        style={{ touchAction: "pan-y" }}
      >
        {/* Stack container */}
        <div className="relative w-full flex items-center justify-center" style={{ height: "min(72vh, 560px)" }}>
          <div className="relative w-full h-full flex items-center justify-center pointer-events-none">
            {collections.map((col, i) => {
              const rawDiff = i - index - dragOffsetForRender / 280;
              const diff = wrapDiff(rawDiff, total);

              // Only render nearby cards
              if (Math.abs(diff) > renderRadius + 0.5) return null;

              return (
                <StackedCard
                  key={col.id}
                  collection={col}
                  diff={diff}
                  isDragging={isDragging.current}
                  fallback={FALLBACKS[i % FALLBACKS.length]}
                  hasMoved={hasMoved}
                  onSelect={() => setIndex(i)}
                />
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

function StackedCard({
  collection,
  diff,
  isDragging,
  fallback,
  hasMoved,
  onSelect,
}: {
  collection: Collection;
  diff: number;
  isDragging: boolean;
  fallback: string;
  hasMoved: React.MutableRefObject<boolean>;
  onSelect: () => void;
}) {
  const router = useRouter();
  const [imgSrc, setImgSrc] = useState(collection.image?.src || fallback);
  const absDiff = Math.abs(diff);
  const isActive = absDiff < 0.1;

  // Tight stack: side cards offset by small px amount, scale down slightly
  const translateX = diff * 18;
  const scale = isActive ? 1 : Math.max(0.9, 1 - absDiff * 0.04);
  const opacity = Math.max(0.2, 1 - absDiff * 0.12);

  const collectionHref = collection.handle ? `/collections/${collection.handle}` : "/collections";

  const handleCardClick = (e: React.MouseEvent) => {
    if (hasMoved.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (isActive) {
      router.push(collectionHref);
    } else {
      e.preventDefault();
      onSelect();
    }
  };

  const cardContent = (
    <div className="w-full h-full relative">
      <Image
        src={imgSrc}
        alt={collection.title}
        fill
        sizes="(max-width: 768px) 85vw, 400px"
        className="object-cover pointer-events-none"
        loading={isActive ? "eager" : "lazy"}
        onError={() => setImgSrc(fallback)}
      />

      {/* Minimal bottom text — only on active card */}
      {isActive && (
        <div
          className="absolute inset-x-0 bottom-0 pb-5 pt-16 flex items-end justify-center pointer-events-none"
          style={{
            background: "linear-gradient(to top, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.08) 50%, transparent 100%)",
          }}
        >
          <motion.span
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="text-[12px] font-normal text-white/90 tracking-[0.08em] drop-shadow-sm"
            style={{ fontFamily: "'HeadingPro', sans-serif" }}
          >
            {collection.title}
          </motion.span>
        </div>
      )}
    </div>
  );

  return (
    <motion.div
      initial={false}
      animate={{
        x: translateX,
        scale,
        opacity,
      }}
      transition={isDragging ? INSTANT : SPRING}
      className="absolute select-none pointer-events-auto cursor-pointer will-change-transform"
      style={{
        width: "min(82vw, 380px)",
        aspectRatio: "3 / 4.2",
        zIndex: 20 - Math.round(absDiff),
        backfaceVisibility: "hidden",
        borderRadius: "1.25rem",
        overflow: "hidden",
        boxShadow: isActive
          ? "0 24px 50px -10px rgba(0, 0, 0, 0.45), 0 0 0 0.5px rgba(255,255,255,0.1)"
          : `0 ${Math.max(4, 14 - absDiff * 4)}px ${Math.max(10, 35 - absDiff * 8)}px -6px rgba(0, 0, 0, ${Math.max(0.1, 0.3 - absDiff * 0.08)})`,
      }}
    >
      {isActive ? (
        <Link href={collectionHref} onClick={handleCardClick} className="block w-full h-full">
          {cardContent}
        </Link>
      ) : (
        <div onClick={handleCardClick} className="w-full h-full">
          {cardContent}
        </div>
      )}
    </motion.div>
  );
}

function DesktopStackedCard({
  collection,
  diff,
  isDragging,
  fallback,
  hasMoved,
  onSelect,
}: {
  collection: Collection;
  diff: number;
  isDragging: boolean;
  fallback: string;
  hasMoved: React.MutableRefObject<boolean>;
  onSelect: () => void;
}) {
  const router = useRouter();
  const [imgSrc, setImgSrc] = useState(collection.image?.src || fallback);
  const absDiff = Math.abs(diff);
  const isActive = absDiff < 0.1;

  // Spread cards across desktop width to utilize wide screen space elegantly
  const translateX = diff * 360;
  const scale = isActive ? 1 : Math.max(0.8, 1 - absDiff * 0.1);
  const opacity = Math.max(0.2, 1 - absDiff * 0.25);

  const collectionHref = collection.handle ? `/collections/${collection.handle}` : "/collections";

  const handleCardClick = (e: React.MouseEvent) => {
    if (hasMoved.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (isActive) {
      router.push(collectionHref);
    } else {
      e.preventDefault();
      onSelect();
    }
  };

  const cardContent = (
    <div className="w-full h-full relative">
      <Image
        src={imgSrc}
        alt={collection.title}
        fill
        sizes="400px"
        className="object-cover pointer-events-none"
        loading={isActive ? "eager" : "lazy"}
        onError={() => setImgSrc(fallback)}
      />

      {/* Gradient overlay */}
      <div className={`absolute inset-0 transition-opacity duration-300 ${isActive ? 'bg-gradient-to-t from-black/60 via-transparent to-transparent' : 'bg-black/25'}`} />

      {/* Title overlay */}
      <div 
        className="absolute inset-x-0 bottom-0 pb-6 pt-16 flex flex-col items-center justify-end pointer-events-none px-4"
        style={{
          background: "linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.15) 60%, transparent 100%)",
        }}
      >
        <motion.span
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className={`text-center uppercase font-bold tracking-[0.12em] drop-shadow-md text-white ${isActive ? 'text-[13px]' : 'text-[11px] opacity-80'}`}
          style={{ fontFamily: "'HeadingPro', sans-serif" }}
        >
          {collection.title}
        </motion.span>
      </div>
    </div>
  );

  return (
    <motion.div
      initial={false}
      animate={{
        x: translateX,
        scale,
        opacity,
      }}
      transition={isDragging ? INSTANT : SPRING}
      className="absolute select-none pointer-events-auto cursor-pointer will-change-transform"
      style={{
        width: "350px",
        aspectRatio: "3 / 4.2",
        zIndex: 30 - Math.round(absDiff * 5),
        backfaceVisibility: "hidden",
        borderRadius: "1.5rem",
        overflow: "hidden",
        boxShadow: isActive
          ? "0 30px 60px -12px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.15)"
          : `0 ${Math.max(6, 16 - absDiff * 4)}px ${Math.max(12, 40 - absDiff * 10)}px -6px rgba(0, 0, 0, ${Math.max(0.12, 0.35 - absDiff * 0.1)})`,
      }}
    >
      {isActive ? (
        <Link href={collectionHref} onClick={handleCardClick} className="block w-full h-full">
          {cardContent}
        </Link>
      ) : (
        <div onClick={handleCardClick} className="w-full h-full">
          {cardContent}
        </div>
      )}
    </motion.div>
  );
}
