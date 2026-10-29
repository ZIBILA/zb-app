/**
 * Authoritative unit prices (INR) for Shopify variants, with a short in-process
 * cache so the Razorpay pre-create and the completion route can both re-price a
 * cart without a Shopify round trip per step.
 *
 * Missing ids are simply absent from the result; callers decide whether a cart
 * counts as "verified" (every item priced) or falls back.
 */
import { shopifyFetch } from '@/lib/shopify-admin';

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { price: number; ts: number }>();

/** `gid://shopify/ProductVariant/123` → `123`; `123` → `123`. */
export function variantNumericId(value: unknown): string {
  const s = String(value ?? '').trim();
  if (!s) return '';
  const tail = s.split('/').pop() || '';
  return /^\d+$/.test(tail) ? tail : '';
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`variant price lookup timed out after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function fetchVariantPrices(
  variantIds: string[],
  opts: { timeoutMs?: number } = {}
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const now = Date.now();
  const missing: string[] = [];
  for (const raw of variantIds) {
    const id = variantNumericId(raw);
    if (!id) continue;
    const hit = cache.get(id);
    if (hit && now - hit.ts < TTL_MS) out.set(id, hit.price);
    else if (!missing.includes(id)) missing.push(id);
  }
  if (missing.length === 0) return out;

  const timeoutMs = opts.timeoutMs ?? 6000;
  const batchSize = 50;
  for (let i = 0; i < missing.length; i += batchSize) {
    const batch = missing.slice(i, i + batchSize);
    try {
      const data = await withTimeout(
        shopifyFetch<{ variants: Array<{ id: number; price: string }> }>('variants.json', {
          ids: batch.join(','),
          fields: 'id,price',
        }),
        timeoutMs
      );
      for (const v of data?.variants || []) {
        const price = parseFloat(v.price);
        if (Number.isFinite(price)) {
          cache.set(String(v.id), { price, ts: Date.now() });
          out.set(String(v.id), price);
        }
      }
    } catch (err: any) {
      console.warn('[VariantPrices] batch lookup failed:', err?.message || err);
    }
  }
  return out;
}

/** Test hook. */
export function clearVariantPriceCache() {
  cache.clear();
}
