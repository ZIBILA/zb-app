/**
 * Production binding of the Meta Purchase delivery (Prisma + live Meta CAPI).
 * See lib/meta/purchase.ts for the logic.
 */
import prisma from '@/lib/db';
import { sendCapiEvent, metaCapiConfigError } from '@/lib/metaCapi';
import { createMetaPurchaseDelivery } from '@/lib/meta/purchase';

export { metaContextFromRequest } from '@/lib/meta/purchase';
export type { MetaClickContext } from '@/lib/meta/purchase';

const delivery = createMetaPurchaseDelivery({ db: prisma, send: sendCapiEvent, configError: metaCapiConfigError });

export const emitMetaPurchase = delivery.emitMetaPurchase;
export const recordMetaPurchaseContext = delivery.recordMetaPurchaseContext;
export const retryFailedMetaPurchases = delivery.retryFailedMetaPurchases;
