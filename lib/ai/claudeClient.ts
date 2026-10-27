/**
 * lib/ai/claudeClient.ts
 * Consolidated Anthropic Claude client with:
 * - Singleton client with key resolution (env → DB)
 * - Retry logic: 404→next model, 429/529→exponential backoff, 401→throw immediately
 * - AbortSignal.timeout on every call
 * - Hard cap on agentic tool-use loops (MAX_TOOL_LOOPS)
 */

import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import prisma from '@/lib/db';
import { getModelChain, type ModelEntry } from './models';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum tool-use round-trips before forcing end_turn */
export const MAX_TOOL_LOOPS = 8;

/** Timeout per single Claude API call (ms) */
const CALL_TIMEOUT_MS = 30_000;

/** Max retries for rate-limit / overloaded (per model) */
const MAX_RATE_LIMIT_RETRIES = 3;

/** Base delay for exponential backoff (ms) */
const BACKOFF_BASE_MS = 250;

// ---------------------------------------------------------------------------
// Client singleton
// ---------------------------------------------------------------------------

let _client: Anthropic | null = null;
let _resolvedKey: string | null = null;
let _resolvedSource: 'env' | 'dotenv' | 'db' | null = null;

/** Strip quotes/whitespace — .env and shell `source` often leave these attached. */
function normalizeApiKey(raw: string | undefined | null): string {
  if (!raw) return '';
  let k = String(raw).trim();
  if (
    (k.startsWith('"') && k.endsWith('"')) ||
    (k.startsWith("'") && k.endsWith("'"))
  ) {
    k = k.slice(1, -1).trim();
  }
  return k;
}

/**
 * Reject placeholder / example keys that shells often export and that Next
 * will prefer over `.env.local` (existing process.env wins over dotenv).
 * Real Anthropic keys are much longer than `sk-ant-api03-xxxx…`.
 */
function isUsableAnthropicKey(key: string): boolean {
  if (!key.startsWith('sk-ant-')) return false;
  if (key.length < 80) return false;
  const lower = key.toLowerCase();
  if (lower.includes('xxxx') || lower.includes('placeholder') || lower.includes('your_')) {
    return false;
  }
  return true;
}

function readProcessEnvApiKey(): string {
  // Bracket access avoids Next/webpack static inlining of process.env.FOO as undefined.
  return normalizeApiKey(
    process.env['ANTHROPIC_API_KEY'] || process.env['CLAUDE_API_KEY']
  );
}

/** Read key directly from .env.local when process.env holds a stale placeholder. */
function readDotEnvLocalApiKey(): string {
  try {
    const filePath = path.join(process.cwd(), '.env.local');
    if (!fs.existsSync(filePath)) return '';
    const text = fs.readFileSync(filePath, 'utf8');
    const wanted = ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'];
    const found: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith('#') || !s.includes('=')) continue;
      const eq = s.indexOf('=');
      const k = s.slice(0, eq).trim();
      if (!wanted.includes(k)) continue;
      found[k] = normalizeApiKey(s.slice(eq + 1));
    }
    return found.ANTHROPIC_API_KEY || found.CLAUDE_API_KEY || '';
  } catch (err) {
    console.warn('[ClaudeClient] Could not read .env.local:', err);
    return '';
  }
}

/**
 * Resolve the Anthropic API key.  Priority:
 * 1. Real ANTHROPIC_API_KEY / CLAUDE_API_KEY in process.env
 * 2. Same keys from `.env.local` (bypasses placeholder shell exports Next won't override)
 * 3. Shop.claudeApiKey from DB
 */
async function resolveApiKey(): Promise<string> {
  if (_resolvedKey) return _resolvedKey;

  const processKey = readProcessEnvApiKey();
  if (isUsableAnthropicKey(processKey)) {
    _resolvedKey = processKey;
    _resolvedSource = 'env';
    return processKey;
  }
  if (processKey) {
    console.warn(
      `[ClaudeClient] Ignoring unusable process.env key (len=${processKey.length}, last4=...${processKey.slice(-4)}). ` +
        `Next prefers shell exports over .env.local — unset ANTHROPIC_API_KEY/CLAUDE_API_KEY or use a clean shell.`
    );
  }

  const fileKey = readDotEnvLocalApiKey();
  if (isUsableAnthropicKey(fileKey)) {
    _resolvedKey = fileKey;
    _resolvedSource = 'dotenv';
    // So the Anthropic SDK's own env fallback cannot pick the placeholder.
    process.env['ANTHROPIC_API_KEY'] = fileKey;
    return fileKey;
  }

  try {
    const shop = await prisma.shop.findFirst({
      select: { claudeApiKey: true },
    });
    const dbKey = normalizeApiKey(shop?.claudeApiKey);
    if (isUsableAnthropicKey(dbKey)) {
      _resolvedKey = dbKey;
      _resolvedSource = 'db';
      process.env['ANTHROPIC_API_KEY'] = dbKey;
      console.warn(
        `[ClaudeClient] Using Shop.claudeApiKey from DB. last4=...${dbKey.slice(-4)}`
      );
      return dbKey;
    }
  } catch (err) {
    console.error('[ClaudeClient] Failed to fetch key from DB:', err);
  }

  throw new Error('[ClaudeClient] No valid Anthropic API key configured');
}

/** Reset cached client — used when key changes via admin UI */
export function resetClient(): void {
  _client = null;
  _resolvedKey = null;
  _resolvedSource = null;
}

async function getClient(): Promise<Anthropic> {
  if (_client) return _client;
  const apiKey = await resolveApiKey();
  // Explicit apiKey only — do not rely on SDK env auto-detect (can pick a stale shell export).
  _client = new Anthropic({ apiKey });
  console.log(
    `[ClaudeClient] Client ready source=${_resolvedSource} keyLen=${apiKey.length} last4=...${apiKey.slice(-4)}`
  );
  return _client;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaudeCallOptions {
  systemPrompt: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  /** Override max_tokens (default: model's maxTokens from registry) */
  maxTokens?: number;
  /** Override model chain (default: PRIMARY → FALLBACK) */
  modelChain?: ModelEntry[];
  /** AbortSignal from caller (merged with internal timeout) */
  signal?: AbortSignal;
}

export interface ClaudeCallResult {
  response: Anthropic.Message;
  modelUsed: string;
  fallbackUsed: boolean;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Core call with fallback + retry
// ---------------------------------------------------------------------------

/**
 * Call Claude with automatic model fallback and retry logic.
 *
 * Retry strategy per model in the chain:
 * - 404 (not_found_error)      → skip to next model immediately
 * - 401 (authentication_error) → throw immediately, never retry
 * - 429 / 529 (rate limit)     → exponential backoff, up to MAX_RATE_LIMIT_RETRIES, then next model
 * - Other errors               → throw immediately
 */
export async function callClaude(opts: ClaudeCallOptions): Promise<ClaudeCallResult> {
  const chain = opts.modelChain ?? getModelChain();
  const startTime = Date.now();

  let lastError: Error | null = null;

  for (let modelIdx = 0; modelIdx < chain.length; modelIdx++) {
    const model = chain[modelIdx];
    const isFirstModel = modelIdx === 0;

    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
      try {
        const client = await getClient();

        const maxTokens = opts.maxTokens ?? model.maxTokens;

        // Build request params
        const params: Anthropic.MessageCreateParamsNonStreaming = {
          model: model.id,
          max_tokens: maxTokens,
          system: opts.systemPrompt,
          messages: opts.messages,
        };

        if (opts.tools && opts.tools.length > 0) {
          params.tools = opts.tools;
        }

        const response = await client.messages.create(params, {
          timeout: CALL_TIMEOUT_MS,
          signal: opts.signal,
        });

        // Warn if response was truncated
        if (response.stop_reason === 'max_tokens') {
          console.warn(
            `[ClaudeClient] Response truncated at max_tokens (${maxTokens}) for model ${model.id}`
          );
        }

        return {
          response,
          modelUsed: model.id,
          fallbackUsed: !isFirstModel,
          latencyMs: Date.now() - startTime,
        };
      } catch (error: any) {
        lastError = error;
        const status = error?.status ?? error?.error?.status;
        const errorType = error?.error?.type ?? error?.type;

        // 401 — never retry, bad key
        if (status === 401 || errorType === 'authentication_error') {
          console.error(
            `[ClaudeClient] Auth error — API key rejected by Anthropic (source=${_resolvedSource}, last4=...${(_resolvedKey || '').slice(-4)}). ` +
              `If curl works with .env.local, check Dashboard Shop.claudeApiKey or a stale shell export of ANTHROPIC_API_KEY.`
          );
          resetClient(); // Clear cached key
          throw error;
        }

        // 404 — model not found, skip to next model
        if (status === 404 || errorType === 'not_found_error') {
          console.warn(
            `[ClaudeClient] Model ${model.id} returned 404 — skipping to next model`
          );
          break; // exit retry loop, try next model
        }

        // 429 / 529 — rate limited / overloaded
        if (status === 429 || status === 529 || errorType === 'rate_limit_error') {
          if (attempt < MAX_RATE_LIMIT_RETRIES) {
            const delay = BACKOFF_BASE_MS * Math.pow(4, attempt) + Math.random() * 200;
            console.warn(
              `[ClaudeClient] Rate limited on ${model.id}, retry ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES} in ${Math.round(delay)}ms`
            );
            await sleep(delay);
            continue;
          }
          // Exhausted retries for this model, try next
          console.warn(
            `[ClaudeClient] Rate limit retries exhausted for ${model.id} — trying next model`
          );
          break;
        }

        // Any other error — throw immediately
        throw error;
      }
    }
  }

  // All models exhausted
  console.error('[ClaudeClient] All models in chain exhausted');
  throw lastError ?? new Error('[ClaudeClient] All models exhausted — no response');
}

// ---------------------------------------------------------------------------
// Streaming variant
// ---------------------------------------------------------------------------

export interface ClaudeStreamOptions {
  systemPrompt: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  maxTokens?: number;
  /** Only use the primary model for streaming (no fallback mid-stream) */
  modelId?: string;
}

export async function streamClaude(opts: ClaudeStreamOptions) {
  const client = await getClient();
  const chain = getModelChain();
  const model = opts.modelId ?? chain[0].id;
  const maxTokens = opts.maxTokens ?? chain[0].maxTokens;

  const params: Anthropic.MessageCreateParams = {
    model,
    max_tokens: maxTokens,
    system: opts.systemPrompt,
    messages: opts.messages,
    stream: true,
  };

  if (opts.tools && opts.tools.length > 0) {
    params.tools = opts.tools;
  }

  return client.messages.create(params, {
    timeout: CALL_TIMEOUT_MS * 2, // Streaming needs more time
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simple health check — sends a minimal message and checks for a response.
 * Returns { ok, latencyMs, error? } for each model.
 */
export async function checkModelHealth(
  modelId: string
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const client = await getClient();
    await client.messages.create(
      {
        model: modelId,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say "ok"' }],
      },
      { timeout: 10_000 }
    );
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: error?.message || String(error),
    };
  }
}
