"use client";

import { useState } from "react";
import NextImage from "next/image";
import { handleImageError } from "./ImagePlaceholder";

interface AspectFitImageProps {
  src: string;
  alt: string;
  /** Ratio (w/h) reserved before the image loads. Match the usual upload format to avoid any shift. */
  defaultRatio: number;
  /** Optional CSS max-height (e.g. "85vh"). When the frame is capped, the image is letterboxed, never cropped. */
  maxHeight?: string;
  sizes?: string;
  priority?: boolean;
  className?: string;
}

/**
 * Renders a CMS banner at its own aspect ratio so the full artwork is always visible.
 * A sale banner uploaded as 4:5 shows as 4:5 — no cover-cropping, no zoom.
 */
export default function AspectFitImage({
  src,
  alt,
  defaultRatio,
  maxHeight,
  sizes = "100vw",
  priority = false,
  className = "",
}: AspectFitImageProps) {
  const [ratio, setRatio] = useState(defaultRatio);

  return (
    <div
      className={`relative w-full overflow-hidden bg-black ${className}`}
      style={{ aspectRatio: String(ratio), maxHeight }}
    >
      {maxHeight && (
        // Blurred fill behind the letterbox when the height cap kicks in (desktop with a portrait banner)
        <NextImage
          src={src}
          alt=""
          aria-hidden
          fill
          sizes={sizes}
          quality={30}
          className="object-cover scale-110 blur-2xl opacity-60"
        />
      )}
      <NextImage
        src={src}
        alt={alt}
        fill
        sizes={sizes}
        quality={85}
        priority={priority}
        className="object-contain"
        onError={handleImageError}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            setRatio(img.naturalWidth / img.naturalHeight);
          }
        }}
      />
    </div>
  );
}
