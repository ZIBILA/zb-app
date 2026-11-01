/**
 * Delivery-status progression for campaign recipients.
 *
 * Meta can repeat a webhook or deliver statuses out of order, so a recipient
 * only moves forward (sent -> delivered -> read) and each campaign counter is
 * bumped once per recipient. "sent" is counted when we send, never on the webhook.
 */
const RANK = { queued: 0, sending: 0, sent: 1, delivered: 2, read: 3 };

export function planRecipientStatusUpdate(prevStatus, nextStatus) {
  const none = { apply: false, inc: { delivered: 0, read: 0, failed: 0 } };
  if (prevStatus === 'failed' && nextStatus !== 'failed') return none;

  if (nextStatus === 'failed') {
    if (prevStatus === 'failed' || prevStatus === 'read') return none;
    return { apply: true, inc: { delivered: 0, read: 0, failed: 1 } };
  }

  if (!(nextStatus in RANK)) return none;
  const prev = RANK[prevStatus] ?? 0;
  const next = RANK[nextStatus];
  if (next <= prev) return none;

  return {
    apply: true,
    inc: {
      // a "read" that arrives without a "delivered" still implies delivery
      delivered: next >= 2 && prev < 2 ? 1 : 0,
      read: next >= 3 && prev < 3 ? 1 : 0,
      failed: 0,
    },
  };
}
