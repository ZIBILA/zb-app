import { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Star, ShieldCheck, Sparkles, ShoppingBag, ArrowRight } from "lucide-react";
import prisma from "@/lib/db";
import { getStoreAggregateRating } from "@/lib/reviews/getProductAggregateRating";

export const revalidate = 60; // Cache for 60 seconds

export const metadata: Metadata = {
  title: { absolute: "Customer Reviews & Ratings | Zica Bella" },
  description: "Read verified customer reviews and ratings for Zica Bella luxury fashion, apparel, and accessories.",
};

type ProductDetail = {
  id: string;
  title: string;
  slug: string;
  images: any;
};

export default async function StorefrontReviewsPage() {
  const [storeRating, reviews] = await Promise.all([
    getStoreAggregateRating(),
    prisma.productReview.findMany({
      where: { status: "VISIBLE" },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
  ]);

  // Batch fetch products for reviews
  const productIds = Array.from(new Set(reviews.map((r: any) => r.productId)));
  const products: ProductDetail[] = productIds.length > 0
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, title: true, slug: true, images: true },
      })
    : [];

  const productMap = new Map<string, ProductDetail>(products.map((p: ProductDetail) => [p.id, p]));

  const ratingValue = storeRating?.value || 4.9;
  const ratingCount = storeRating?.count || reviews.length;

  return (
    <div className="min-h-screen bg-background text-foreground py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-10">
        {/* Header / Hero */}
        <div className="text-center space-y-4 max-w-2xl mx-auto">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <Sparkles className="w-3 h-3" />
            Verified Customer Feedback
          </span>
          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-foreground">
            What Our Customers Say
          </h1>
          <p className="text-xs sm:text-sm text-foreground/60 leading-relaxed">
            Real feedback from verified buyers who experience Zica Bella’s quality, design, and craftsmanship.
          </p>

          {/* Rating Summary Card */}
          <div className="inline-flex items-center gap-4 p-4 rounded-2xl bg-foreground/[0.02] border border-foreground/10 backdrop-blur-md">
            <div className="text-3xl font-extrabold text-amber-400 font-mono">
              {ratingValue.toFixed(1)}
            </div>
            <div className="text-left space-y-0.5">
              <div className="flex gap-1 text-amber-400">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star key={star} className="w-4 h-4 fill-amber-400" />
                ))}
              </div>
              <p className="text-[11px] text-foreground/50 font-medium">
                Based on {ratingCount} verified product reviews
              </p>
            </div>
          </div>
        </div>

        {/* Reviews Grid */}
        {reviews.length === 0 ? (
          <div className="text-center py-16 p-6 rounded-2xl bg-foreground/[0.02] border border-foreground/10 space-y-3">
            <ShoppingBag className="w-10 h-10 text-foreground/30 mx-auto" />
            <h3 className="text-sm font-bold">No Reviews Yet</h3>
            <p className="text-xs text-foreground/50">Be the first to share your experience with Zica Bella!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {reviews.map((review: any) => {
              const product = productMap.get(review.productId);
              const parsedImages = typeof product?.images === "string" ? JSON.parse(product.images) : product?.images || [];
              const thumbnail = Array.isArray(parsedImages) && parsedImages.length > 0 ? parsedImages[0] : null;

              return (
                <div
                  key={review.id}
                  className="p-5 rounded-2xl bg-foreground/[0.02] border border-foreground/10 flex flex-col justify-between space-y-4 hover:border-foreground/20 transition-all group"
                >
                  <div className="space-y-3">
                    {/* Stars and Verified */}
                    <div className="flex items-center justify-between">
                      <div className="flex gap-0.5">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star
                            key={star}
                            className={`w-3.5 h-3.5 ${
                              star <= review.rating ? "text-amber-400 fill-amber-400" : "text-foreground/10"
                            }`}
                          />
                        ))}
                      </div>

                      {review.verifiedPurchase && (
                        <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                          <ShieldCheck className="w-3 h-3" />
                          Verified Buyer
                        </span>
                      )}
                    </div>

                    {/* Review Title & Body */}
                    {review.title && (
                      <h3 className="text-xs font-bold text-foreground">{review.title}</h3>
                    )}
                    <p className="text-xs text-foreground/70 leading-relaxed italic">
                      "{review.body}"
                    </p>
                  </div>

                  {/* Product footer */}
                  {product && (
                    <Link
                      href={`/products/${product.slug}`}
                      className="pt-3 border-t border-foreground/10 flex items-center justify-between gap-3 text-xs group-hover:text-amber-500 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {thumbnail && (
                          <div className="w-8 h-8 rounded-lg overflow-hidden relative shrink-0 border border-foreground/10">
                            <Image src={thumbnail} alt={product.title} fill className="object-cover" />
                          </div>
                        )}
                        <span className="font-semibold truncate">{product.title}</span>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 shrink-0 opacity-50 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
