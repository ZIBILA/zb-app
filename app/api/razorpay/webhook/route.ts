/**
 * POST /api/razorpay/webhook — alias of /api/webhooks/razorpay.
 *
 * README.md, docs/razorpay-testing.md and the admin Razorpay page told the
 * operator to configure this URL in the Razorpay Dashboard, but the handler
 * lived at /api/webhooks/razorpay (a dashboard configured from the docs got 404
 * for every event). Both paths now reach the same handler.
 */
export { POST, dynamic } from '@/app/api/webhooks/razorpay/route';
