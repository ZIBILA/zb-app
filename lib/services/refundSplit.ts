/**
 * Split a request-level refund total across its return lines so that
 *   sum(lines) === total (to the paisa),
 * proportionally to each line's own refund amount (falling back to an even split).
 *
 * Without this every line would carry the whole request total, which breaks per-line reporting
 * and double-counts if the lines are ever summed.
 */
export function splitRefundAcrossLines<T extends { id: string; refundAmount?: number | null }>(
  lines: T[],
  total: number
): Array<{ id: string; amount: number }> {
  const cents = Math.round(Number(total) * 100);
  if (!lines.length || !Number.isFinite(cents) || cents < 0) return [];

  const weights = lines.map((l) => Math.max(0, Math.round(Number(l.refundAmount || 0) * 100)));
  const weightSum = weights.reduce((a, b) => a + b, 0);

  const out: Array<{ id: string; cents: number }> = lines.map((l, i) => ({
    id: l.id,
    cents:
      weightSum > 0
        ? Math.floor((cents * weights[i]) / weightSum)
        : Math.floor(cents / lines.length),
  }));

  // Hand the rounding remainder to the largest line so the split adds up exactly.
  let remainder = cents - out.reduce((a, b) => a + b.cents, 0);
  const order = out
    .map((o, i) => ({ i, w: weights[i] }))
    .sort((a, b) => b.w - a.w)
    .map((x) => x.i);
  for (let k = 0; remainder > 0; k = (k + 1) % order.length) {
    out[order[k]].cents += 1;
    remainder -= 1;
  }

  return out.map((o) => ({ id: o.id, amount: o.cents / 100 }));
}
