"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] p-6 text-center">
      <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center border border-red-500/20 mb-4">
        <AlertCircle className="w-6 h-6 text-red-500" />
      </div>
      <h2 className="text-sm font-semibold text-foreground mb-2">Something went wrong</h2>
      <p className="text-xs text-foreground/60 mb-6 max-w-xs">{error.message || "An unexpected error occurred in settings."}</p>
      <button
        onClick={() => reset()}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-foreground text-background text-xs font-semibold hover:bg-gray-100 transition-all"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Try again
      </button>
    </div>
  );
}
