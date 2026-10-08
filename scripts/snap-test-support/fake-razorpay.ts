/** Test-only stand-in for the `razorpay` SDK (wired via this folder's tsconfig paths). */
export default class FakeRazorpay {
  static validateWebhookSignature(body: string, signature: string, secret: string): boolean {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require('crypto');
    return crypto.createHmac('sha256', secret).update(body).digest('hex') === signature;
  }
  orders = { create: async (o: any) => ({ id: `order_rzp_${Math.random().toString(36).slice(2, 10)}`, ...o }) };
  payments = { fetch: async (id: string) => ({ id, status: 'captured', captured: true, amount: 0, order_id: '' }) };
  constructor(_: any) {}
}
