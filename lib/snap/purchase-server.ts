/**
 * Production binding of the Snap PURCHASE delivery (Prisma + live Snap CAPI).
 * See lib/snap/purchase.ts for the logic.
 */
import prisma from '@/lib/db';
import { sendSnapEvent } from '@/lib/snap-capi';
import { createSnapPurchaseDelivery } from '@/lib/snap/purchase';

export { snapContextFromRequest } from '@/lib/snap/purchase';
export type { SnapClickContext } from '@/lib/snap/purchase';

const delivery = createSnapPurchaseDelivery({ db: prisma, send: sendSnapEvent });

export const emitSnapPurchase = delivery.emitSnapPurchase;
export const recordSnapPurchaseContext = delivery.recordSnapPurchaseContext;
export const retryPendingSnapPurchases = delivery.retryPendingSnapPurchases;
