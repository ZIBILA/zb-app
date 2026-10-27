/**
 * Production binding of the native-app Snap PURCHASE (Prisma + live Snap app CAPI).
 * See lib/snap/app-purchase.ts.
 */
import prisma from '@/lib/db';
import { sendSnapAppEvent } from '@/lib/snap/app-capi';
import { createSnapAppPurchaseDelivery, type AppRequestContext } from '@/lib/snap/app-purchase';
import { isPrivateIP } from '@/lib/ip-geo';
import { clientIpFromHeaders } from '@/lib/client-ip';
import { verifyCapture } from '@/lib/snap/purchase-server';

const delivery = createSnapAppPurchaseDelivery({ db: prisma, send: sendSnapAppEvent, verifyCapture });

export const recordSnapAppContext = delivery.recordSnapAppContext;
export const emitSnapAppPurchase = delivery.emitSnapAppPurchase;
export const retryPendingSnapAppPurchases = delivery.retryPendingSnapAppPurchases;

/** IP + user agent of the app's own request (never from the body). */
export function appRequestContext(req: Request, externalId?: string | null): AppRequestContext {
  const ip = clientIpFromHeaders(req.headers);
  return {
    ipAddress: ip && !isPrivateIP(ip) ? ip : undefined,
    userAgent: req.headers.get('user-agent') || undefined,
    externalId: externalId || undefined,
  };
}
