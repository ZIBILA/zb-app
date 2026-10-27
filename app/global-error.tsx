'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div className="flex flex-col items-center justify-center min-h-screen text-center p-6 bg-background">
          <h2 className="text-xl font-heading mb-4 text-foreground/80 lowercase tracking-widest">
            A critical error occurred
          </h2>
          <p className="text-[10px] text-muted-foreground uppercase tracking-[0.2em] mb-8 max-w-sm leading-relaxed">
            The application encountered a global error. Please try refreshing or returning home.
          </p>
          {/* Show what failed: full message in development, only the server reference id in production */}
          {process.env.NODE_ENV !== 'production' ? (
            <pre className="mb-8 max-w-2xl whitespace-pre-wrap break-words text-left text-[11px] text-red-600 dark:text-red-400">
              {error?.message}
              {error?.digest ? `\n\ndigest: ${error.digest}` : ''}
            </pre>
          ) : error?.digest ? (
            <p className="mb-8 text-[10px] text-muted-foreground">Reference: {error.digest}</p>
          ) : null}
          <button
            onClick={() => reset()}
            className="px-8 py-4 bg-foreground text-background text-[10px] font-bold uppercase tracking-[0.3em] rounded-full hover:opacity-90 active:scale-95 transition-all shadow-2xl"
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
