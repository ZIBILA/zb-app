import React from 'react';

/** Matches the full-screen chat layout in page.tsx (conversation area + pinned composer). */
export default function SupportLoading() {
  return (
    <div className="flex flex-col h-[100dvh] bg-background pt-[72px] md:pt-[76px]">
      <div className="flex-1 flex items-center justify-center">
        <div className="w-12 h-12 rounded-2xl bg-foreground/[0.06] animate-pulse" />
      </div>
      <div className="shrink-0 pb-[max(env(safe-area-inset-bottom),12px)]">
        <div className="max-w-3xl mx-auto w-full px-4 md:px-6">
          <div className="h-[54px] rounded-[26px] bg-foreground/[0.05] border border-foreground/10 animate-pulse" />
          <div className="h-[27px]" />
        </div>
      </div>
    </div>
  );
}
