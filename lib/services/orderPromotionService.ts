import prisma from "@/lib/db";

export async function promoteMasterOrderToWebStoreOrder(mOrder: Record<string, unknown>) {
  // Guard: Do not promote cancelled, failed, or voided orders
  const orderStatus = ((mOrder.status as string) || '').toLowerCase();
  const paymentSt = ((mOrder.paymentStatus as string) || '').toLowerCase();
  const rejectedStatuses = ['cancelled', 'canceled', 'voided'];
  const rejectedPaymentStatuses = ['cancelled', 'canceled', 'failed', 'payment_failed', 'voided'];

  if (rejectedStatuses.includes(orderStatus) || rejectedPaymentStatuses.includes(paymentSt)) {
    console.log(`[orderPromotionService] Skipping promotion for order ${mOrder.id}: status=${orderStatus}, paymentStatus=${paymentSt}`);
    return null;
  }

  let shippingAddr: Record<string, unknown> = {};
  try {
    shippingAddr = typeof mOrder.shippingAddress === 'string' ? JSON.parse(mOrder.shippingAddress as string) : ((mOrder.shippingAddress as Record<string, unknown>) || {});
  } catch {}

  const rawMethod = ((mOrder.paymentMethod as string) || '').toLowerCase();
  const tagsLower = ((mOrder.tags as string) || '').toLowerCase();
  const noteLower = ((mOrder.note as string) || '').toLowerCase();
  const isCod = rawMethod === 'cod' || tagsLower.includes('cod') || noteLower.includes('cod order') || noteLower.includes('upfront fee paid');

  const orderId = mOrder.id as string;
  const orderNum = (mOrder.internalOrderNumber as string) || (mOrder.shopifyOrderName as string) || `#${orderId.slice(-6).toUpperCase()}`;
  const rzpOrderId = (mOrder.razorpayOrderId as string) || null;
  const rzpPayId = (mOrder.razorpayPaymentId as string) || null;
  const customer = mOrder.customer as Record<string, unknown> | null;

  const existing = await prisma.webStoreOrder.findFirst({
    where: {
      OR: [
        { orderNumber: orderNum },
        ...(rzpOrderId ? [{ razorpayOrderId: rzpOrderId }] : []),
        ...(rzpPayId ? [{ razorpayPaymentId: rzpPayId }] : []),
      ]
    }
  });

  if (existing) {
    return existing;
  }

  const items = Array.isArray(mOrder.items) ? (mOrder.items as Record<string, unknown>[]).map((i) => ({
    product_id: (i.productId as string) || "",
    variant_id: (i.variantId as string) || "",
    title: (i.title as string) || "Item",
    image_url: (i.image as string) || "",
    quantity: Number(i.quantity || 1),
    price: Number(i.price || 0),
    size: (i.size as string) || ""
  })) : [];

  try {
    return await prisma.webStoreOrder.create({
      data: {
        orderNumber: orderNum,
        customerName: (customer?.name as string) || "Customer",
        customerEmail: (customer?.email as string) || "",
        customerPhone: (customer?.phone as string) || "",
        shippingAddress: shippingAddr,
        items: items,
        subtotal: Number(mOrder.subtotalPrice || mOrder.totalPrice || 0),
        shippingCharge: 0,
        discountCode: (mOrder.discountCode as string) || null,
        discountAmount: Number(mOrder.discountAmount || 0),
        totalAmount: Number(mOrder.totalPrice || 0),
        paymentStatus: (mOrder.paymentStatus as string) === "partially_paid" ? "partially_paid" : isCod ? "cod_upfront_paid" : (mOrder.financialStatus === "paid" || mOrder.paymentStatus === "paid" ? "paid" : "paid"),
        paymentMethod: isCod ? "cod" : ((mOrder.paymentMethod as string) || "razorpay"),
        razorpayOrderId: rzpOrderId,
        razorpayPaymentId: rzpPayId,
        codUpfrontPaid: isCod ? 99 : 0,
        codUpfrontPaymentId: isCod ? rzpPayId : null,
        fulfillmentStatus: (mOrder.fulfillmentStatus as string) || "unfulfilled",
        notes: (mOrder.note as string) || `Reconciled from master Order: ${orderId}`,
        source: "web",
        createdAt: (mOrder.createdAt as Date) || new Date(),
        paymentFailureReason: (mOrder.paymentFailureReason as string) || null,
      }
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[orderPromotionService] Error creating WebStoreOrder for ${orderNum}:`, msg);
    return await prisma.webStoreOrder.findFirst({
      where: {
        OR: [
          { orderNumber: orderNum },
          ...(rzpOrderId ? [{ razorpayOrderId: rzpOrderId }] : []),
          ...(rzpPayId ? [{ razorpayPaymentId: rzpPayId }] : []),
        ]
      }
    });
  }
}
