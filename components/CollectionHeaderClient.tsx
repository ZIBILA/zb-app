"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import Image from "next/image";
import { motion } from "framer-motion";

interface CollectionHeaderClientProps {
  currentHandle: string;
  currentTitle: string;
  allCollections: any[];
  currentImage?: string;
}

// Same spring physics as homepage carousel
const SPRING = {
  type: "spring" as const,
  stiffness: 380,
  damping: 38,
  mass: 0.7,
  restDelta: 0.001,
};

export default function CollectionHeaderClient({ 
  currentHandle, 
  currentTitle, 
  allCollections,
  currentImage
}: CollectionHeaderClientProps) {
  const dragStartX = useRef(0);
  const dragStartTime = useRef(0);
  const isDragging = useRef(false);
  const hasMoved = useRef(false);

  const currentIndex = allCollections.findIndex(c => c.handle === currentHandle);
  const [index, setIndex] = useState(Math.max(0, currentIndex));
  const total = allCollections.length;

  useEffect(() => {
    const idx = allCollections.findIndex(c => c.handle === currentHandle);
    if (idx >= 0) setIndex(idx);
  }, [currentHandle, allCollections]);

  const go = useCallback(
    (dir: 1 | -1) => {
      setIndex((i) => (i + dir + total) % total);
    },
    [total]
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    dragStartX.current = e.clientX;
    dragStartTime.current = Date.now();
    isDragging.current = true;
    hasMoved.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    if (Math.abs(e.clientX - dragStartX.current) > 6) hasMoved.current = true;
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;

    const dx = e.clientX - dragStartX.current;
    const dt = Date.now() - dragStartTime.current;
    const velocity = Math.abs(dx) / Math.max(dt, 1);
    const threshold = velocity > 0.4 ? 18 : 50;

    if (Math.abs(dx) > threshold) {
      go(dx < 0 ? 1 : -1);
    }
  };

  if (!total) return null;

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="relative w-full select-none touch-pan-y cursor-grab active:cursor-grabbing"
      style={{ touchAction: "pan-y" }}
    >
      {/* Compact stack for collection page header */}
      <div className="relative w-full flex items-center justify-center" style={{ height: "130px" }}>
        <div className="relative w-full h-full flex items-center justify-center pointer-events-none">
          {allCollections.map((col: any, i: number) => {
            let diff = i - index;
            if (diff > total / 2) diff -= total;
            if (diff < -total / 2) diff += total;

            if (Math.abs(diff) > 3) return null;

            const absDiff = Math.abs(diff);
            const isActive = absDiff < 0.1;
            const translateX = diff * 14;
            const scale = isActive ? 1 : Math.max(0.9, 1 - absDiff * 0.04);
            const opacity = Math.max(0, 1 - absDiff * 0.2);

            return (
              <motion.div
                key={col.handle}
                initial={false}
                animate={{ x: translateX, scale, opacity }}
                transition={SPRING}
                className="absolute select-none pointer-events-none will-change-transform"
                style={{
                  width: "min(76vw, 340px)",
                  aspectRatio: "21 / 9",
                  zIndex: 20 - Math.round(absDiff),
                  backfaceVisibility: "hidden",
                  borderRadius: "1rem",
                  overflow: "hidden",
                  boxShadow: isActive
                    ? "0 12px 30px -6px rgba(0,0,0,0.4), 0 0 0 0.5px rgba(255,255,255,0.1)"
                    : `0 6px 16px -4px rgba(0,0,0,${Math.max(0.08, 0.25 - absDiff * 0.06)})`,
                }}
              >
                <Link
                  href={`/collections/${col.handle}`}
                  className="block w-full h-full relative pointer-events-auto"
                  prefetch={false}
                >
                  {col.image?.src ? (
                    <Image
                      src={col.image.src}
                      alt={col.title}
                      fill
                      className={`object-cover transition-transform duration-2000 ease-out ${isActive ? "scale-105" : "scale-100"}`}
                      sizes="(max-width: 768px) 80vw, 360px"
                      priority={isActive}
                    />
                  ) : (
                    <div className="w-full h-full bg-foreground/[0.05] flex items-center justify-center">
                      <span className="text-[5px] font-black uppercase tracking-widest opacity-10">
                        {col.title}
                      </span>
                    </div>
                  )}

                  {/* Dark overlay */}
                  <div className={`absolute inset-0 transition-all duration-700 ${isActive ? "bg-black/25" : "bg-black/45"}`} />

                  {/* Title */}
                  {isActive && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <motion.h1
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.35, delay: 0.08 }}
                        className="text-[10px] font-normal uppercase tracking-[0.12em] text-white/90 text-center drop-shadow-sm"
                        style={{ fontFamily: "'HeadingPro', sans-serif" }}
                      >
                        {col.title}
                      </motion.h1>
                    </div>
                  )}
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Dot indicators */}
      {total > 1 && (
        <div className="flex justify-center gap-1 mt-2">
          {allCollections.map((_: any, i: number) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              className={`rounded-full transition-all duration-500 ease-out ${
                i === index
                  ? "w-4 h-[3px] bg-foreground/40"
                  : "w-[3px] h-[3px] bg-foreground/10 hover:bg-foreground/20"
              }`}
              aria-label={`Go to collection ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
