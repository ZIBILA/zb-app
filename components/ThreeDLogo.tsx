"use client";

import { useState, useEffect, useRef } from "react";
import NextImage from "next/image";
import Script from "next/script";

export default function ThreeDLogo({ src, size = 48 }: { src?: string; size?: number }) {
  const [mounted, setMounted] = useState(false);
  const [inView, setInView] = useState(false);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Mount after the load event so the 240 KB model-viewer module never competes with the
    // page's own resources (it is also gated on the footer being near the viewport, below).
    const arm = () => setMounted(true);
    if (document.readyState === "complete") arm();
    else window.addEventListener("load", arm, { once: true });
    return () => window.removeEventListener("load", arm);
  }, []);

  useEffect(() => {
    if (!mounted || !containerRef.current) return;

    // If custom element is already registered by a previous instance, load immediately
    if (typeof customElements !== "undefined" && customElements.get("model-viewer")) {
      setInView(true);
      setScriptLoaded(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" }
    );

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [mounted]);

  return (
    <div ref={containerRef} style={{ width: size, height: size }} className="relative shrink-0">
      {mounted && inView && !scriptLoaded && (
        <Script
          type="module"
          src="https://ajax.googleapis.com/ajax/libs/model-viewer/3.3.0/model-viewer.min.js"
          onLoad={() => setScriptLoaded(true)}
        />
      )}

      {mounted && scriptLoaded ? (
        /* @ts-expect-error model-viewer web component */
        <model-viewer
          src={src || "https://cdn.shopify.com/3d/models/e024b09e83a75c03/Zicabella-silver-logo.glb"}
          alt="Zica Bella 3D Logo"
          auto-rotate
          camera-controls
          interaction-prompt="none"
          shadow-intensity="0.5"
          loading="lazy"
          style={{ width: "100%", height: "100%", background: "transparent", touchAction: "none" }}
        />
      ) : (
        <div className="relative w-full h-full dark:invert">
          <NextImage src="/zb-logo-220px.png" alt="Zica Bella Logo" fill className="object-contain" sizes="220px" />
        </div>
      )}
    </div>
  );
}
