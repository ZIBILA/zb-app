/**
 * Production binding of the native-app Snap PURCHASE (Prisma + live Snap app CAPI).
 * See lib/snap/app-purchase.ts.
 */
import prisma from '@/lib/db';
import { sendSnapAppEvent } from '@/lib/snap/app-capi';
import { createSnapAppPurchaseDelivery, type AppRequestContext } from '@/lib/snap/app-purchase';
import { isPrivateIP } from '@/lib/ip-geo';
import { verifyCapture } from '@/lib/snap/purchase-server';

const delivery = createSnapAppPurchaseDelivery({ db: prisma, send: sendSnapAppEvent, verifyCapture });

export const recordSnapAppContext = delivery.recordSnapAppContext;
export const emitSnapAppPurchase = delivery.emitSnapAppPurchase;
export const retryPendingSnapAppPurchases = delivery.retryPendingSnapAppPurchases;

/** IP + user agent of the app's own request (never from the body). */
export function appRequestContext(req: Request, externalId?: string | null): AppRequestContext {
  const ip = req.headers.get('do-connecting-ip')
    || req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || req.headers.get('x-real-ip')
    || undefined;
  return {
    ipAddress: ip && !isPrivateIP(ip) ? ip : undefined,
    userAgent: req.headers.get('user-agent') || undefined,
    externalId: externalId || undefined,
  };
}
