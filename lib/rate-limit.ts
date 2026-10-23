import prisma from "./db";

// In-memory fallback store
const inMemoryStore = new Map<string, { count: number; resetAt: number }>();

// Clean up in-memory store every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    inMemoryStore.forEach((val, key) => {
      if (now > val.resetAt) inMemoryStore.delete(key);
    });
  }, 5 * 60 * 1000);
}

// In-memory Rate Limiter fallback
function inMemoryRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetAfter: number } {
  const now = Date.now();
  const entry = inMemoryStore.get(key);

  if (!entry || now > entry.resetAt) {
    const resetAt = now + windowMs;
    inMemoryStore.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: maxRequests - 1, resetAfter: Math.ceil(windowMs / 1000) };
  }

  entry.count += 1;
  const remaining = Math.max(0, maxRequests - entry.count);
  const resetAfter = Math.ceil(Math.max(0, entry.resetAt - now) / 1000);
  return { allowed: entry.count <= maxRequests, remaining, resetAfter };
}

// Initialize the database table if it doesn't exist (runs lazily once)
let isDbTableInitialized = false;
async function initializeDbTable() {
  if (isDbTableInitialized) return true;
  try {
    // Check if we are running in prisma build phase or mock client
    if ((prisma as any)._isMock) {
      return false;
    }
    
    // Create the RateLimitLog table if it doesn't exist.
    // This SQL statement works on PostgreSQL. If on SQLite, it will also work for standard types.
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "RateLimitLog" (
        "id" SERIAL PRIMARY KEY,
        "key" VARCHAR(255) NOT NULL,
        "timestamp" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `).catch(() => {
      // If SERIAL is not supported (e.g. SQLite), try a SQLite-compatible definition
      return prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "RateLimitLog" (
          "id" INTEGER PRIMARY KEY AUTOINCREMENT,
          "key" VARCHAR(255) NOT NULL,
          "timestamp" DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
    });

    // Create index for performance
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_ratelimit_key_timestamp" ON "RateLimitLog" ("key", "timestamp");
    `).catch(() => {});

    isDbTableInitialized = true;
    return true;
  } catch (err) {
    console.warn("[Rate Limit] Database table initialization failed, falling back to in-memory mode:", err);
    return false;
  }
}

/**
 * Sliding Window Rate Limiter using Supabase/PostgreSQL with automatic in-memory fallback.
 * Checks request limits for a given key within a sliding time window.
 * 
 * @param key Unique key to rate limit (e.g. IP + route, user ID + route)
 * @param options configuration options
 */
export async function rateLimit(
  key: string,
  options: { maxRequests?: number; windowMs?: number } = {}
): Promise<{ allowed: boolean; remaining: number; resetAfter: number }> {
  const maxRequests = options.maxRequests ?? 10;
  const windowMs = options.windowMs ?? 60_000;
  const now = new Date();

  // Try DB first
  const dbReady = await initializeDbTable();
  if (dbReady && !(prisma as any)._isMock) {
    try {
      const windowStart = new Date(now.getTime() - windowMs);

      // Clean up old entries for this key only (never wipe other keys' longer windows)
      await prisma.$executeRawUnsafe(
        `DELETE FROM "RateLimitLog" WHERE "key" = $1 AND "timestamp" < $2`,
        key,
        windowStart
      );

      // Count existing requests in the sliding window
      const countResult: any[] = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int as count FROM "RateLimitLog" WHERE "key" = $1 AND "timestamp" >= $2`,
        key,
        windowStart
      );

      const count = countResult[0]?.count ?? 0;

      if (count >= maxRequests) {
        // Find the oldest record in the window to calculate reset time
        const oldestResult: any[] = await prisma.$queryRawUnsafe(
          `SELECT "timestamp" FROM "RateLimitLog" WHERE "key" = $1 AND "timestamp" >= $2 ORDER BY "timestamp" ASC LIMIT 1`,
          key,
          windowStart
        );
        const oldestTime = oldestResult[0]?.timestamp ? new Date(oldestResult[0].timestamp) : windowStart;
        const resetAfterMs = Math.max(0, (oldestTime.getTime() + windowMs) - now.getTime());
        const resetAfter = Math.ceil(resetAfterMs / 1000);

        return {
          allowed: false,
          remaining: 0,
          resetAfter,
        };
      }

      // Log the current request
      await prisma.$executeRawUnsafe(
        `INSERT INTO "RateLimitLog" ("key", "timestamp") VALUES ($1, $2)`,
        key,
        now
      );

      const remaining = Math.max(0, maxRequests - (count + 1));
      return {
        allowed: true,
        remaining,
        resetAfter: Math.ceil(windowMs / 1000),
      };
    } catch (err: any) {
      console.warn("[Rate Limit] DB query failed, falling back to in-memory rate limiting:", err.message);
      // Fallback to in-memory
    }
  }

  // Fallback to in-memory rate limiting
  return inMemoryRateLimit(key, maxRequests, windowMs);
}

import { NextResponse } from "next/server";

/**
 * Higher-level helper to check rate limit for a request.
 * Automatically resolves the client's IP, computes the key, and formats the 429 response if rate limit is exceeded.
 */
export async function checkRateLimit(
  req: Request,
  keyPrefix: string,
  options: { maxRequests?: number; windowMs?: number } = {}
): Promise<{ allowed: boolean; response?: NextResponse }> {
  const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "127.0.0.1";
  const key = `${keyPrefix}:${ip}`;
  const { allowed, resetAfter } = await rateLimit(key, options);

  if (!allowed) {
    return {
      allowed: false,
      response: NextResponse.json(
        { error: "Too many requests. Please try again in a moment." },
        {
          status: 429,
          headers: {
            "Retry-After": String(resetAfter),
            "Access-Control-Allow-Origin": req.headers.get("origin") || "*",
            "Access-Control-Allow-Credentials": "true",
          },
        }
      ),
    };
  }

  return { allowed: true };
}
