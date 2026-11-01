'use client';

import { useState } from 'react';
import ReviewPhotoPicker from './ReviewPhotoPicker';

interface WriteReviewFormProps {
  productId: string;
  orderId: string;
  productTitle: string;
  existingReview?: {
    rating: number;
    title: string | null;
    body: string;
    createdAt: string;
  } | null;
}

export default function WriteReviewForm({
  productId,
  orderId,
  productTitle,
  existingReview,
}: WriteReviewFormProps) {
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(!!existingReview);
  const [error, setError] = useState<string | null>(null);

  // If review already submitted, show read-only state
  if (submitted && existingReview) {
    return (
      <div className="p-3 rounded-lg border border-foreground/[0.06] bg-foreground/[0.01] space-y-1.5">
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((star) => (
              <span
                key={star}
                className={`text-[11px] ${
                  star <= existingReview.rating
                    ? 'text-amber-400'
                    : 'text-foreground/10'
                }`}
              >
                ★
              </span>
            ))}
          </div>
          <span className="text-[7px] font-bold uppercase tracking-wider text-emerald-500/60">
            Your Review
          </span>
        </div>
        {existingReview.title && (
          <p className="text-[9px] font-semibold text-foreground/60">
            {existingReview.title}
          </p>
        )}
        <p className="text-[8.5px] text-foreground/45 leading-relaxed">
          {existingReview.body}
        </p>
      </div>
    );
  }

  // If just submitted (no pre-existing), show simple confirmation
  if (submitted) {
    return (
      <div className="p-3 rounded-lg border border-emerald-500/10 bg-emerald-500/[0.02] text-center">
        <p className="text-[9px] text-emerald-500/70 font-medium">
          ✓ Thanks! Your review will appear once our team approves it.
        </p>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (rating === 0) {
      setError('Please select a rating');
      return;
    }
    if (body.trim().length < 3) {
      setError('Please write at least a few words');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          orderId,
          rating,
          title: title.trim() || undefined,
          body: body.trim(),
          photos,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to submit review');
        return;
      }

      setSubmitted(true);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-3 rounded-lg border border-foreground/[0.06] bg-foreground/[0.01] space-y-2.5">
      <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-foreground/40">
        Review: {productTitle}
      </p>

      {/* Star Rating */}
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onMouseEnter={() => setHoveredRating(star)}
            onMouseLeave={() => setHoveredRating(0)}
            onClick={() => setRating(star)}
            className={`text-[16px] transition-colors ${
              star <= (hoveredRating || rating)
                ? 'text-amber-400'
                : 'text-foreground/10 hover:text-foreground/20'
            }`}
          >
            ★
          </button>
        ))}
      </div>

      {/* Title (optional) */}
      <input
        type="text"
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={100}
        className="w-full bg-transparent border border-foreground/[0.06] rounded-md px-2.5 py-1.5 text-[9px] text-foreground/70 placeholder:text-foreground/20 focus:outline-none focus:border-foreground/15 transition-colors"
      />

      {/* Body */}
      <textarea
        placeholder="Write your review..."
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={1000}
        rows={3}
        className="w-full bg-transparent border border-foreground/[0.06] rounded-md px-2.5 py-1.5 text-[9px] text-foreground/70 placeholder:text-foreground/20 focus:outline-none focus:border-foreground/15 transition-colors resize-none"
      />

      <ReviewPhotoPicker photos={photos} onChange={setPhotos} />

      {error && (
        <p className="text-[8px] text-red-400">{error}</p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="px-4 py-1.5 bg-foreground text-background text-[8px] font-bold uppercase tracking-[0.2em] rounded-md hover:opacity-90 transition-opacity disabled:opacity-40"
      >
        {isSubmitting ? 'Submitting...' : 'Submit Review'}
      </button>
    </div>
  );
}
