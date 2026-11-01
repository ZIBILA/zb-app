"use client";

import { useEffect, useRef } from "react";

/**
 * Full-screen hero whose height never changes while scrolling.
 *
 * CSS gives it 100lvh (the largest viewport — constant in Safari/Chrome as the toolbar
 * shows/hides). In-app browsers (Instagram, Facebook) resize the whole webview instead,
 * which changes every viewport unit and shoves all content below the hero up and down
 * mid-scroll. So once mounted we pin the resolved height in px and only re-measure when
 * the width changes (rotation / window resize), never on toolbar-driven height changes.
 */
export default function StableHeroSection({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lockedWidth = 0;

    const lock = () => {
      el.style.height = "";
      el.style.height = `${el.getBoundingClientRect().height}px`;
      lockedWidth = window.innerWidth;
    };

    const onResize = () => {
      if (Math.abs(window.innerWidth - lockedWidth) > 1) lock();
    };

    lock();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <section ref={ref} className={className}>
      {children}
    </section>
  );
}
