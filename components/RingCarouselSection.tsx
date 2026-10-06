"use client";

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { ArrowRight, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";
import NextImage from "next/image";
import { handleImageError } from "./ImagePlaceholder";
import { fetchStorefrontProducts } from "@/lib/storefront-fetch";

export interface RingItem {
  id: string;
  image: string;
  link?: string;
  title?: string;
  price?: string;
  handle?: string;
}

interface RingCarouselSectionProps {
  title?: string;
  itemsConfig?: string;
}

export default function RingCarouselSection({ title, itemsConfig }: RingCarouselSectionProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<RingItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchRings = async () => {
      try {
        let handle = "accessories";
        if (itemsConfig && itemsConfig.trim() !== "" && itemsConfig !== "[]") {
          try {
            const parsed = JSON.parse(itemsConfig);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setItems(parsed);
              setLoading(false);
              return;
            }
          } catch(e) {
            handle = itemsConfig;
          }
        }
        let products = await fetchStorefrontProducts(`collection=${encodeURIComponent(handle)}&limit=12`);
        if (products.length === 0) {
          products = await fetchStorefrontProducts('limit=6');
        }
        if (products.length > 0) {
          const mapped: RingItem[] = products.map((p: any) => ({
            id: p.id?.toString() || `ring-${Math.random()}`,
            image: p.images?.[0]?.src || p.image?.src || "",
            link: `/products/${p.handle || p.id}`,
            title: p.title,
            price: p.variants?.[0]?.price,
            handle: p.handle || p.id?.toString(),
          })).filter((r: RingItem) => r.image);
          if (mapped.length > 0) {
            setItems(mapped.slice(0, 12));
            setLoading(false);
            return;
          }
        }
      } catch (e) {
        console.error("Failed to fetch ring products:", e);
      }
      setLoading(false);
    };

    fetchRings();
  }, [itemsConfig]);

  const scrollLeft = () => scrollRef.current?.scrollBy({ left: -300, behavior: "smooth" });
  const scrollRight = () => scrollRef.current?.scrollBy({ left: 300, behavior: "smooth" });

  if (!loading && items.length === 0) return null;

  return (
    <section className="w-full py-8 md:py-12 relative z-10 overflow-hidden min-h-[200px]">
      {/* Centered Header container to align with standard padding */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex items-end justify-between mb-6">
          <div>
            {title ? (
              <h2 className="text-sm md:text-base font-heading tracking-[0.15em] uppercase text-foreground leading-none">
                {title}
              </h2>
            ) : null}
          </div>
          <div className="flex items-center gap-2.5">
            <div className="hidden md:flex gap-1">
              <button onClick={scrollLeft} className="w-8 h-8 rounded-full border border-foreground/[0.06] flex items-center justify-center text-foreground/25 hover:text-foreground/60 transition-all duration-300 active:scale-90" aria-label="Scroll Left">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button onClick={scrollRight} className="w-8 h-8 rounded-full border border-foreground/[0.06] flex items-center justify-center text-foreground/25 hover:text-foreground/60 transition-all duration-300 active:scale-90" aria-label="Scroll Right">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <Link href="/collections/accessories" className="flex items-center gap-1 text-[8px] uppercase tracking-widest text-foreground/25 hover:text-foreground/50 transition-all font-semibold">
              Explore All <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>

      {/* Carousel Wrapper - Full screen breakout */}
      <div className="w-full mt-2">
        {loading ? (
          <div className="flex items-center justify-center py-20 min-h-[140px]">
            <Loader2 className="w-5 h-5 animate-spin text-foreground/15" />
          </div>
        ) : (
          <div className="relative group">
            {/* Edge fades (desktop only on hover) */}
            <div className="absolute left-0 top-0 bottom-0 w-10 bg-gradient-to-r from-background to-transparent z-20 pointer-events-none opacity-0 md:group-hover:opacity-100 transition-opacity duration-500" />
            <div className="absolute right-0 top-0 bottom-0 w-10 bg-gradient-to-l from-background to-transparent z-20 pointer-events-none opacity-0 md:group-hover:opacity-100 transition-opacity duration-500" />

            <div
              ref={scrollRef}
              className="flex gap-2.5 overflow-x-auto overflow-y-hidden snap-x snap-mandatory touch-pan-x ios-scroll hide-scrollbar"
              style={{ 
                WebkitOverflowScrolling: "touch",
                paddingLeft: 'max(16px, calc((100vw - 1280px) / 2 + 24px))',
                paddingRight: 'max(16px, calc((100vw - 1280px) / 2 + 24px))'
              }}
            >
              {items.map((item, i) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.6, delay: i * 0.03, ease: [0.16, 1, 0.3, 1] }}
                  className="snap-start shrink-0 w-[140px] h-[140px] sm:w-[160px] sm:h-[160px] md:w-[220px] md:h-[220px] lg:w-[260px] lg:h-[260px]"
                >
                  <Link
                    href={`/products/${item.handle || item.id}`}
                    className="group/card block w-full h-full"
                    prefetch={false}
                  >
                    {/* Plain minimal card — image only, rounded-none for streetwear vibe */}
                    <div className="ring-card-hover w-full h-full rounded-none overflow-hidden relative bg-foreground/[0.03] transition-all duration-500">
                      <NextImage
                        src={item.image}
                        alt={item.title || "Accessory"}
                        fill
                        sizes="(max-width: 640px) 140px, (max-width: 768px) 160px, (max-width: 1024px) 220px, 260px"
                        quality={75}
                        loading="lazy"
                        className="ring-card-hover-img object-contain select-none p-3 md:p-5 transition-transform duration-700 ease-out"
                        onError={handleImageError}
                      />
                    </div>
                  </Link>
                </motion.div>
              ))}
              <div className="shrink-0 w-1" />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
