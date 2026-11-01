import { inspect } from 'util';

/**
 * Concise server logs: Error objects become one line ("Name[code]: message"),
 * multi-line messages (e.g. Prisma) are collapsed, long output is truncated.
 * Production only; set LOG_VERBOSE=true to keep the full stack traces.
 */
const MAX_LEN = 400;

function oneLine(text: string, max = MAX_LEN): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}… (+${flat.length - max} chars)` : flat;
}

function formatArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    const code = (arg as any).code ?? (arg as any).twilioCode;
    const cause = (arg as any).cause;
    const base = `${arg.name}${code ? `[${code}]` : ''}: ${arg.message}`;
    return oneLine(cause instanceof Error ? `${base} (cause: ${cause.message})` : base);
  }
  if (typeof arg === 'string') return oneLine(arg);
  if (arg && typeof arg === 'object') {
    return oneLine(inspect(arg, { depth: 2, breakLength: Infinity, compact: true }));
  }
  return arg;
}

let installed = false;

export function installConciseConsole() {
  if (installed) return;
  if (process.env.NODE_ENV !== 'production' || process.env.LOG_VERBOSE === 'true') return;
  installed = true;

  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      try {
        original(...args.map(formatArg));
      } catch {
        original(...args);
      }
    };
  }
}
