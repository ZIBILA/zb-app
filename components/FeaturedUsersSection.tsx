"use client";

import { useState, useEffect } from "react";
import NextImage from "next/image";
import { Star, Upload, Instagram } from "lucide-react";

interface FeaturedUser {
  id: string;
  name: string;
  imageUrl: string;
  instagramUrl?: string | null;
  styleDescription: string | null;
  reviews: { id: string; rating: number }[];
}

export default function FeaturedUsersSection({ 
  showCommunity = true, 
  title = "FEATURED LOOKS", 
  subtitle = "COMMUNITY",
  allFeatured = false,
  onUploadClick,
}: { 
  showCommunity?: boolean;
  title?: string;
  subtitle?: string;
  allFeatured?: boolean;
  onUploadClick?: () => void;
}) {
  const [users, setUsers] = useState<FeaturedUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!showCommunity) {
      setLoading(false);
      return;
    }
    const url = allFeatured ? "/api/featured-users" : "/api/featured-users?isTopFeatured=true";
    fetch(url)
      .then(res => res.json())
      .then(data => {
        if (data.users) {
          const arr = [...data.users];
          for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
          }
          setUsers(arr);
        }
      })
      .finally(() => setLoading(false));
  }, [showCommunity, allFeatured]);

  if (!showCommunity) return null;

  if (loading) {
    return (
      <section className="mt-2 mb-4 px-2 overflow-hidden min-h-[300px]">
        <div className="text-center mb-5 animate-pulse">
          <div className="h-2 w-16 bg-foreground/5 rounded mx-auto mb-2" />
          <div className="h-4 w-32 bg-foreground/5 rounded mx-auto" />
        </div>
        <div className="flex gap-2 md:gap-3 overflow-x-hidden pb-4 animate-pulse">
          {[1, 2, 3].map(i => (
            <div 
              key={i} 
              className="w-[calc((100vw-36px)/3)] md:w-[calc((100%-24px)/3)] md:max-w-[360px] shrink-0 aspect-[9/20] rounded-xl bg-foreground/[0.03]" 
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="mt-2 mb-4 px-2 overflow-hidden min-h-[300px]">
      <div className="text-center mb-5">
        <h2 className="font-heading text-[7.5px] md:text-[8.5px] tracking-[0.4em] text-muted-foreground/30 mb-1 uppercase" style={{ fontFamily: "'HeadingPro', sans-serif" }}>{subtitle}</h2>
        <p className="font-heading text-[13px] md:text-[15px] tracking-[0.22em] text-foreground uppercase opacity-80 font-medium" style={{ fontFamily: "'HeadingPro', sans-serif" }}>{title}</p>
      </div>

      <div className="relative group">
        <div className="flex gap-2 md:gap-3 overflow-x-auto pb-6 hide-scrollbar snap-x px-3 -mx-3 items-start">
          {/* Upload / Add Yours Card */}
          {onUploadClick && (
            <div 
              className="w-[calc((100vw-36px)/3)] md:w-[calc((100%-24px)/3)] md:max-w-[360px] md:flex-1 shrink-0 snap-center group cursor-pointer flex flex-col gap-1.5"
              onClick={onUploadClick}
            >
              <div className="relative aspect-[9/20] rounded-xl overflow-hidden bg-foreground/[0.01] border border-dashed border-foreground/10 flex flex-col items-center justify-center transition-all duration-300 hover:border-foreground/25">
                <div className="w-9 h-9 rounded-full bg-foreground/5 flex items-center justify-center mb-1">
                  <Upload className="w-4 h-4 text-foreground/40" />
                </div>
                <p className="text-[5.5px] md:text-[7.5px] text-foreground/25 font-medium tracking-wide">
                  Publish Look
                </p>
              </div>
              <div className="text-center">
                <span className="text-[7.5px] md:text-[8.5px] font-medium text-foreground/40 tracking-[0.18em] uppercase select-none">
                  Add Yours
                </span>
              </div>
            </div>
          )}

          {users.length > 0 ? (
            users.map((user) => {
              const avgRating = user.reviews.length > 0 
                ? user.reviews.reduce((acc: any, r: any) => acc + r.rating, 0) / user.reviews.length 
                : 5;

              return (
                <div 
                  key={user.id} 
                  className={`w-[calc((100vw-36px)/3)] md:w-[calc((100%-24px)/3)] md:max-w-[360px] md:flex-1 shrink-0 snap-center group flex flex-col gap-1.5 ${user.instagramUrl ? 'cursor-pointer' : ''}`}
                  onClick={() => {
                     if (user.instagramUrl) {
                        window.open(user.instagramUrl, '_blank', 'noopener,noreferrer');
                     }
                  }}
                >
                  <div className="relative aspect-[9/20] rounded-xl overflow-hidden bg-foreground/[0.01]">
                    <NextImage 
                      src={user.imageUrl || "/zb-logo-220px.png"} 
                      alt={user.name} 
                      fill 
                      sizes="(max-width: 768px) 33vw, 360px"
                      className="object-cover"
                      loading="lazy"
                    />
                  </div>
                  
                  {/* Clean, plain, minimal name text below card */}
                  <div className="text-center">
                    <span className="text-[7.5px] md:text-[8.5px] font-medium text-foreground/40 tracking-[0.18em] uppercase select-none inline-flex items-center gap-1">
                      {user.name}
                      {user.instagramUrl && (
                        <Instagram className="w-2 h-2 text-foreground/25 shrink-0" />
                      )}
                    </span>
                  </div>
                </div>
              );
            })
          ) : !onUploadClick ? (
            <div className="w-full flex flex-col items-center justify-center py-10 opacity-30">
              <Star className="w-8 h-8 mb-3" />
              <p className="text-[10px] font-bold uppercase tracking-[0.2em]">Collective Forming</p>
            </div>
          ) : null}
        </div>
        
      </div>
    </section>
  );
}
