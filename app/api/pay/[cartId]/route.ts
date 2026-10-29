import { NextResponse, NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/pay/[cartId] — retired cart-recovery pay link.
 *
 * The previous implementation created a local pending order bound to one
 * Razorpay order and then a separate Razorpay Payment Link whose callback
 * carried a payment-link signature, so the flow could never complete: the
 * success page rejected the callback, the webhook found no order for the
 * link's own order id and created an "Unresolved order" placeholder, and the
 * real pending order stayed pending forever (PAYMENT_AUDIT.md P25). Nothing in
 * the codebase generated these links any more.
 *
 * Old links still in customers' messages now land on the cart, where the
 * normal checkout (server-priced, signature + capture verified) takes over.
 */
/**
 * Public origin for the redirect. Behind the DigitalOcean proxy a route handler's
 * `req.nextUrl.origin` is the container bind address (http://0.0.0.0:8080), so the
 * forwarded host / configured site URL is used instead.
 */
function publicOrigin(req: NextRequest): string {
  const forwardedHost = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0].trim();
  const proto = (req.headers.get("x-forwarded-proto") || "https").split(",")[0].trim();
  if (forwardedHost && !/^(0\.0\.0\.0|127\.0\.0\.1|localhost)(:\d+)?$/.test(forwardedHost)) {
    return `${proto}://${forwardedHost}`;
  }
  return process.env.NEXT_PUBLIC_SITE_URL || "https://zicabella.com";
}

export async function GET(req: NextRequest, { params }: { params: { cartId: string } }) {
  const cartId = String(params?.cartId || "").slice(0, 64);
  console.warn(`[PayLink] Retired pay link opened for cart ${cartId} — redirecting to /cart`);
  const target = new URL("/cart", publicOrigin(req));
  if (cartId) target.searchParams.set("recover", cartId);
  return NextResponse.redirect(target, 302);
}
