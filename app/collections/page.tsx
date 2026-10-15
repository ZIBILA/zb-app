import { fetchEnabledCollections } from "@/lib/shopify-admin";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import Image from "next/image";
import { Metadata } from "next";

export const revalidate = 300; // ISR: revalidate every 5 minutes

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://zicabella.com";

export const metadata: Metadata = {
  title: { absolute: "Subculture Collections & Limited Drops | Zica Bella® | Streetwear Archives" },
  description: "Explore Zica Bella's curated limited-edition streetwear drops and subculture collections. Discover boxy drop-shoulder oversized tees, double-yarn loopback hoodies, and custom acid-wash denims. Crafted in India, worn with intent.",
  keywords: "zica bella collections, luxury streetwear India, streetwear drops, oversized t-shirts online, premium blanks, limited capsule drops, heavyweight hoodies, streetwear brand india, subculture design",
  alternates: { canonical: `${siteUrl}/collections` },
  openGraph: {
    title: "Subculture Collections & Limited Drops | Zica Bella®",
    description: "Explore Zica Bella's curated limited-edition streetwear drops and subculture collections. Discover boxy drop-shoulder oversized tees, double-yarn loopback hoodies, and custom acid-wash denims.",
    url: `${siteUrl}/collections`,
    images: [
      {
        url: `${siteUrl}/og-image.jpg`,
        alt: "Zica Bella Collections",
      }
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Subculture Collections & Limited Drops | Zica Bella®",
    description: "Explore Zica Bella's curated limited-edition streetwear drops and subculture collections. Discover boxy drop-shoulder oversized tees, double-yarn loopback hoodies, and custom acid-wash denims.",
    images: [`${siteUrl}/og-image.jpg`],
  }
};

export default async function CollectionsPage() {
  const collections = await fetchEnabledCollections('page');

  return (
    <div className="min-h-screen bg-background pt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-32">
        {/* Header Section */}
        <div className="mb-px">
          <div className="space-y-4">
            <h1 className="text-3xl font-bold tracking-[0.2em] uppercase text-foreground/90 font-heading" style={{ fontFamily: "'HeadingPro', sans-serif" }}>
              Collections
            </h1>
            <div className="h-[1px] w-16 bg-foreground/10 rounded-full" />
            <p className="text-[9px] text-foreground/50 dark:text-foreground/30 font-medium uppercase tracking-[0.2em] leading-relaxed">
              Curated luxury series
            </p>
          </div>
        </div>

        {/* Collections Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 md:gap-12 mt-12">
          {collections.map((collection, idx) => (
            <Link 
              key={collection.id} 
              href={`/collections/${collection.handle}`}
              className="group relative block aspect-[16/10] rounded-[2rem] overflow-hidden transition-all duration-700 hover:scale-[1.01] active:scale-[0.99] border border-white/5 shadow-2xl"
            >
              {/* Background Image */}
              {collection.image?.src ? (
                <Image
                  src={collection.image.src}
                  alt={collection.title}
                  fill
                  className="object-cover transition-transform duration-1000 group-hover:scale-105"
                  sizes="100vw"
                  priority={idx < 2}
                  quality={100}
                />
              ) : (
                <div className="w-full h-full bg-foreground/[0.03]" />
              )}

              {/* Minimal Glass Overlay */}
              <div className="absolute inset-x-0 bottom-0 p-8 z-10">
                <div 
                  className="rounded-[1.5rem] p-5 overflow-hidden"
                  style={{
                    background: "rgba(0, 0, 0, 0.45)",
                    backdropFilter: "blur(12px) saturate(180%)",
                    WebkitBackdropFilter: "blur(12px) saturate(180%)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                  }}
                >
                  <div className="flex justify-between items-center">
                    <h2 className="text-[10px] font-bold tracking-[0.3em] uppercase text-white/95 font-heading" style={{ fontFamily: "'HeadingPro', sans-serif" }}>
                      {collection.title}
                    </h2>
                    <div className="w-8 h-[1px] bg-white/30 group-hover:w-12 transition-all duration-700" />
                  </div>
                </div>
              </div>

              {/* Subtle Gradient Scrim */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-80 group-hover:opacity-60 transition-opacity duration-700" />
            </Link>
          ))}
        </div>

        {/* Empty State */}
        {collections.length === 0 && (
          <div className="py-32 text-center space-y-4">
            <p className="text-[10px] uppercase tracking-[0.5em] text-foreground/40 dark:text-foreground/20 font-heading">
              No collections found
            </p>
            <div className="h-[1px] w-12 bg-foreground/5 mx-auto" />
          </div>
        )}
      </div>
    </div>
  );
}
