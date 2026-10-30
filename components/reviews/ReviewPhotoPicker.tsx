'use client';

import { useRef, useState } from 'react';
import { Camera, Loader2, X } from 'lucide-react';

export const MAX_REVIEW_PHOTOS = 5;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/**
 * Customer photo uploader for reviews. Each image goes to /api/upload; the hosted URLs are passed up
 * and sent with the review. Photos are shown on the product page only after the review is approved.
 */
export default function ReviewPhotoPicker({
  photos,
  onChange,
  variant = 'light',
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
  variant?: 'light' | 'dark';
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    const room = MAX_REVIEW_PHOTOS - photos.length;
    const picked = Array.from(files).slice(0, room);
    if (files.length > room) setError(`You can add up to ${MAX_REVIEW_PHOTOS} photos.`);

    setUploading(true);
    const uploaded: string[] = [];
    for (const file of picked) {
      if (file.size > MAX_PHOTO_BYTES) {
        setError('Each photo must be under 8 MB.');
        continue;
      }
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/upload', { method: 'POST', body: form });
        const data = await res.json();
        // Only hosted images can be attached (the API rejects inline fallbacks).
        if (res.ok && typeof data.url === 'string' && data.url.startsWith('https://')) uploaded.push(data.url);
        else setError(data.error || 'A photo could not be uploaded.');
      } catch {
        setError('A photo could not be uploaded.');
      }
    }
    onChange([...photos, ...uploaded]);
    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const muted = variant === 'dark' ? 'text-neutral-400 border-white/10' : 'text-foreground/40 border-foreground/[0.08]';

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2">
        {photos.map((src) => (
          <div key={src} className="relative w-14 h-14 rounded-lg overflow-hidden border border-foreground/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="Your photo" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => onChange(photos.filter((p) => p !== src))}
              className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/60 text-white"
              aria-label="Remove photo"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        {photos.length < MAX_REVIEW_PHOTOS && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className={`w-14 h-14 rounded-lg border border-dashed flex flex-col items-center justify-center gap-0.5 text-[8px] font-bold uppercase ${muted}`}
          >
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
            {uploading ? '' : 'Photo'}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {error && <p className="text-[8px] text-red-400">{error}</p>}
    </div>
  );
}
