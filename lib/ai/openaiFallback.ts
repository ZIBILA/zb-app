/**
 * OpenAI fallback for Zica AI (Developer Brief #12): used only when Claude fails (outage, credits,
 * rate limits), so customers still get an answer. Server-side only — the key never reaches the browser.
 *
 * Env: OPENAI_API_KEY (required to enable), OPENAI_ZICA_MODEL (optional, default below).
 */

const CALL_TIMEOUT_MS = 30_000;
const DEFAULT_MODEL = 'gpt-4o-mini';

export function isOpenAiFallbackConfigured(): boolean {
  const key = (process.env['OPENAI_API_KEY'] || '').trim();
  return key.startsWith('sk-') && key.length > 40;
}

export async function callOpenAiChat(opts: {
  systemPrompt: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  maxTokens: number;
}): Promise<string> {
  const apiKey = (process.env['OPENAI_API_KEY'] || '').trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env['OPENAI_ZICA_MODEL'] || DEFAULT_MODEL,
      max_tokens: opts.maxTokens,
      messages: [{ role: 'system', content: opts.systemPrompt }, ...opts.messages],
    }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err: any = new Error(`OpenAI ${res.status}: ${data?.error?.message || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('OpenAI returned an empty response');
  return text.trim();
}
