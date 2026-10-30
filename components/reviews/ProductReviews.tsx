import { getProductAggregateRating, getProductReviews } from '@/lib/reviews/getProductAggregateRating';

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          className={`text-[10px] ${
            star <= rating
              ? 'text-amber-400'
              : 'text-foreground/10'
          }`}
        >
          ★
        </span>
      ))}
    </div>
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date));
}

export async function ProductReviews({
  productId,
}: {
  productId: string;
}) {
  let aggregate: { value: number; count: number } | undefined;
  let reviews: Awaited<ReturnType<typeof getProductReviews>> = [];

  try {
    [aggregate, reviews] = await Promise.all([
      getProductAggregateRating(productId),
      getProductReviews(productId, { limit: 10 }),
    ]);
  } catch (err) {
    console.error('[ProductReviews] Error fetching reviews:', err);
    return null;
  }

  if (!aggregate || !reviews || reviews.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Customer Reviews"
      className="mt-8 space-y-4"
    >
      {/* Summary */}
      <div className="flex items-center gap-3">
        <h3 className="text-[10px] font-bold uppercase tracking-[0.25em] text-foreground/50">
          Customer Reviews
        </h3>
        <div className="flex items-center gap-1.5">
          <StarRating rating={Math.round(aggregate.value)} />
          <span className="text-[9px] text-foreground/40">
            {aggregate.value} ({aggregate.count}{' '}
            {aggregate.count === 1 ? 'review' : 'reviews'})
          </span>
        </div>
      </div>

      {/* Review List */}
      <div className="space-y-3">
        {reviews.map((review) => (
          <div
            key={review.id}
            itemScope
            itemType="https://schema.org/Review"
            className="p-3.5 rounded-xl border border-foreground/[0.06] bg-foreground/[0.015] backdrop-blur-sm"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div itemProp="reviewRating" itemScope itemType="https://schema.org/Rating">
                  <meta itemProp="ratingValue" content={review.rating.toString()} />
                  <meta itemProp="bestRating" content="5" />
                  <meta itemProp="worstRating" content="1" />
                  <StarRating rating={review.rating} />
                </div>
                <span itemProp="author" itemScope itemType="https://schema.org/Person" className="text-[9px] font-semibold text-foreground/70">
                  <span itemProp="name">Verified Buyer</span>
                </span>
                {review.verifiedPurchase && (
                  <span className="text-[7px] font-bold uppercase tracking-wider text-emerald-500/80 bg-emerald-500/10 px-1.5 py-0.5 rounded-full border border-emerald-500/20">
                    Verified Buyer
                  </span>
                )}
              </div>
              <time itemProp="datePublished" dateTime={new Date(review.createdAt).toISOString()} className="text-[8px] text-foreground/30 font-medium">
                {formatDate(review.createdAt)}
              </time>
            </div>
            {review.title && (
              <p itemProp="name" className="text-[10px] font-bold text-foreground/80 mb-1">
                {review.title}
              </p>
            )}
            <p itemProp="reviewBody" className="text-[9.5px] text-foreground/60 leading-relaxed font-sans">
              {review.body}
            </p>
            {review.photos?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {review.photos.map((src) => (
                  <a key={src} href={src} target="_blank" rel="noopener noreferrer" className="block w-16 h-16 rounded-md overflow-hidden border border-foreground/[0.06]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="Customer photo" loading="lazy" className="w-full h-full object-cover" itemProp="image" />
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
