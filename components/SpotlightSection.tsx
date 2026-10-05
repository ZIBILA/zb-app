"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import NextImage from "next/image";
import { ShopifyProduct } from "@/lib/shopify-admin";
import { fetchStorefrontProducts } from "@/lib/storefront-fetch";

export default function SpotlightSection({ 
  title = "AUTHENTIC STREETWEAR", 
  subtitle = "Luxury Indian streetwear for modern men. Redefining bold everyday style.",
  collection = "tshirts",
  productIds = "",
}: { 
  title?: string; 
  subtitle?: string; 
  collection?: string;
  productIds?: string;
}) {
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const query = productIds && productIds.trim()
      ? `ids=${encodeURIComponent(productIds)}`
      : `pageSize=6&collection=${collection || 'tshirts'}`;

    fetchStorefrontProducts(query)
      .then((list) => setProducts(list))
      .finally(() => setLoading(false));
  }, [collection, productIds]);

  if (loading) {
    return (
      <section className="mt-16 mb-20 px-4 min-h-[400px]">
        <div className="text-center mb-12 animate-pulse">
          <div className="h-6 w-48 bg-foreground/5 rounded mx-auto mb-4" />
          <div className="h-3 w-64 bg-foreground/5 rounded mx-auto" />
        </div>
        <div className="grid grid-cols-3 gap-x-2 gap-y-10 animate-pulse">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-4">
              <div className="aspect-[3/4] w-full rounded-2xl bg-foreground/5" />
              <div className="h-2 w-16 bg-foreground/5 rounded" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="mt-16 mb-20 px-4 min-h-[400px]">
      <div className="text-center mb-12">
        <h2 className="font-heading text-[22px] tracking-[0.2em] text-foreground mb-4 uppercase">{title}</h2>
        <p className="text-[10px] text-muted-foreground max-w-[280px] mx-auto leading-relaxed tracking-wider font-extralight uppercase opacity-40">
          {subtitle}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-x-3 gap-y-12 group/grid">
        {(products.length > 0 ? products : Array(6).fill(null)).slice(0, 6).map((product, idx) => (
          <Link 
            key={product?.id || idx} 
            href={product ? `/products/${product.handle || product.id}` : "#"}
            className="flex flex-col items-center gap-5 group/item active:scale-[0.98] transition-all duration-700"
          >
            <div className="relative aspect-[3/4] w-full rounded-2xl overflow-hidden border border-foreground/[0.06] group-hover/item:border-foreground/20 transition-all duration-700 shadow-sm group-hover/item:shadow-xl">
              {product?.images?.[0]?.src ? (
                <NextImage 
                  src={product.images[0].src} 
                  alt={product.title} 
                  fill 
                  sizes="(max-width: 768px) 33vw, 25vw"
                  quality={75}
                  loading="lazy"
                  className="object-cover group-hover/item:scale-105 transition-all duration-1000 ease-out"
                />
              ) : (
                <div className="w-full h-full bg-foreground/[0.02] flex items-center justify-center">
                  <span className="text-[7px] text-muted-foreground/20 uppercase tracking-[0.3em] font-light">ZB Studio</span>
                </div>
              )}
            </div>
            <div className="flex flex-col items-center gap-1.5 px-1 w-full text-center">
              <span className="text-[8px] font-bold tracking-[0.25em] text-foreground/80 uppercase group-hover/item:text-foreground transition-colors line-clamp-1">
                {product?.title || "ZICA BELLA"}
              </span>
              <div className="h-[1px] w-0 group-hover/item:w-full bg-foreground/20 transition-all duration-700 ease-out" />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
