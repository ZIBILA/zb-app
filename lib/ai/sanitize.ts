/**
 * lib/ai/sanitize.ts
 * Data sanitization for customer-facing Claude responses.
 *
 * Uses ALLOW-LIST approach — only explicitly listed fields pass through.
 * All internal fields (cost, vendor, SKU, warehouse, batch IDs) are stripped.
 */

// ---------------------------------------------------------------------------
// Order sanitization — explicit field allow-list
// ---------------------------------------------------------------------------

/** Fields allowed in customer-visible order data */
const ORDER_SAFE_FIELDS = new Set([
  'id',
  'shopifyOrderId',
  'shopifyOrderName',
  'internalOrderNumber',
  'totalPrice',
  'totalAmount',
  'subtotalPrice',
  'subtotal',
  'currency',
  'status',
  'paymentStatus',
  'paymentMethod',
  'codUpfrontPaid',
  'paidAmount',
  'balanceDue',
  'fulfillmentStatus',
  'deliveryStatus',
  'createdAt',
  'updatedAt',
  'items',
  'discountAmount',
  'discountCode',
  'storeCreditAmount',
  'paymentFailureReason',
]);

/** Fields allowed in customer-visible order item data */
const ORDER_ITEM_SAFE_FIELDS = new Set([
  'title',
  'quantity',
  'price',
  'image',
  'size',
]);

/** Fields allowed in shipment data */
const SHIPMENT_SAFE_FIELDS = new Set([
  'trackingNumber',
  'courier',
  'status',
  'trackingUrl',
  'estimatedDelivery',
  'currentLocation',
]);

/** Fields allowed in payment data */
const PAYMENT_SAFE_FIELDS = new Set([
  'amount',
  'type',
  'status',
  'gateway',
  'paymentMethod',
  'codUpfrontPaid',
  'paidAmount',
  'balanceDue',
  'totalAmount',
  'totalPrice',
  'createdAt',
]);

/**
 * Helper to format payment method nicely for AI/customer visibility
 */
export function formatPaymentMethodName(method?: string | null): string {
  if (!method) return 'Prepaid (Razorpay)';
  const normalized = method.toLowerCase().trim();
  if (normalized === 'cod') return 'Cash on Delivery (COD)';
  if (normalized === 'store_credit') return '100% Store Credit';
  if (normalized === 'razorpay' || normalized === 'prepaid' || normalized === 'upi' || normalized === 'card') {
    return 'Prepaid (Razorpay)';
  }
  return method;
}

/**
 * Sanitize an order object for customer view.
 * Uses allow-list: only listed fields pass through.
 */
export function sanitizeOrderForCustomer(order: any): Record<string, any> {
  if (!order) return {};

  const safe: Record<string, any> = {};

  for (const field of ORDER_SAFE_FIELDS) {
    if (order[field] !== undefined) {
      safe[field] = order[field];
    }
  }

  // Sanitize nested items
  if (Array.isArray(order.items)) {
    safe.items = order.items.map((item: any) => {
      const safeItem: Record<string, any> = {};
      for (const field of ORDER_ITEM_SAFE_FIELDS) {
        if (item[field] !== undefined) {
          safeItem[field] = item[field];
        }
      }
      return safeItem;
    });
  }

  // Normalize payment method and amount calculations
  const rawMethod = (order.paymentMethod || order.payment_method || '').toLowerCase().trim();
  const isCOD = rawMethod === 'cod';

  safe.paymentMethodRaw = order.paymentMethod || 'razorpay';
  safe.paymentMethod = formatPaymentMethodName(order.paymentMethod);

  const total = Number(order.totalPrice ?? order.totalAmount ?? 0);
  const codUpfront = Number(order.codUpfrontPaid ?? 0);

  if (isCOD) {
    const pStatus = (order.paymentStatus || '').toLowerCase();
    if (pStatus === 'paid') {
      safe.paidAmount = total;
      safe.balanceDue = 0;
    } else {
      // Standard upfront paid or pending COD order
      safe.codUpfrontPaid = codUpfront > 0 ? codUpfront : 99;
      safe.paidAmount = safe.codUpfrontPaid;
      safe.balanceDue = Math.max(0, total - safe.paidAmount);
    }
  } else {
    // Prepaid or Store Credit order
    const pStatus = (order.paymentStatus || '').toLowerCase();
    if (pStatus === 'paid' || pStatus === 'approved' || pStatus === 'completed') {
      safe.paidAmount = total;
      safe.balanceDue = 0;
    } else {
      safe.paidAmount = 0;
      safe.balanceDue = total;
    }
  }

  // Map status to customer-facing text
  safe.status = mapInternalStatus(order.status);
  safe.paymentStatus = mapPaymentStatus(order.paymentStatus, isCOD, safe.codUpfrontPaid);
  safe.deliveryStatus = mapDeliveryStatus(order.deliveryStatus);

  return safe;
}

/**
 * Sanitize shipment data for customer view.
 */
export function sanitizeShipmentForCustomer(shipment: any): Record<string, any> {
  if (!shipment) return {};
  const safe: Record<string, any> = {};
  for (const field of SHIPMENT_SAFE_FIELDS) {
    if (shipment[field] !== undefined) {
      safe[field] = shipment[field];
    }
  }
  return safe;
}

/**
 * Sanitize payment data for customer view.
 */
export function sanitizePaymentForCustomer(payment: any): Record<string, any> {
  if (!payment) return {};
  const safe: Record<string, any> = {};
  for (const field of PAYMENT_SAFE_FIELDS) {
    if (payment[field] !== undefined) {
      safe[field] = payment[field];
    }
  }

  const rawMethod = (payment.paymentMethod || payment.payment_method || payment.gateway || '').toLowerCase().trim();
  const isCOD = rawMethod === 'cod';
  const total = Number(payment.totalPrice ?? payment.totalAmount ?? payment.amount ?? 0);
  const codUpfront = Number(payment.codUpfrontPaid ?? 0);

  safe.paymentMethod = formatPaymentMethodName(rawMethod);

  if (isCOD) {
    safe.codUpfrontPaid = codUpfront > 0 ? codUpfront : 99;
    safe.paidAmount = safe.codUpfrontPaid;
    safe.balanceDue = Math.max(0, total - safe.paidAmount);
  } else {
    safe.paidAmount = (payment.paymentStatus || payment.status || '').toLowerCase() === 'paid' ? total : 0;
    safe.balanceDue = Math.max(0, total - safe.paidAmount);
  }

  safe.status = mapPaymentStatus(payment.paymentStatus || payment.status, isCOD, safe.codUpfrontPaid);
  return safe;
}

// ---------------------------------------------------------------------------
// Status mapping — internal → customer-facing
// ---------------------------------------------------------------------------

const STATUS_MAP: Record<string, string> = {
  pending: 'Order Placed',
  payment_pending: 'Order Placed (Payment Pending)',
  processing: 'Processing',
  confirmed: 'Processing',
  approved: 'Processing',
  ready_for_dispatch: 'Ready for Dispatch',
  dispatched: 'Shipped',
  shipped: 'Shipped',
  in_transit: 'Out for Delivery',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  return_requested: 'Return Requested',
  exchange_requested: 'Exchange Requested',
  cancelled: 'Cancelled',
  failed: 'Cancelled',
};

export function mapInternalStatus(status: string): string {
  if (!status) return 'Unknown';
  return STATUS_MAP[status.toLowerCase()] ?? status;
}

const PAYMENT_STATUS_MAP: Record<string, string> = {
  paid: 'Paid',
  cod_upfront_paid: 'COD Upfront Paid',
  pending: 'Pending',
  authorized: 'Pending',
  failed: 'Failed',
  refunded: 'Refunded',
  partially_refunded: 'Partially Refunded',
  cancelled: 'Cancelled',
};

export function mapPaymentStatus(status: string, isCOD = false, codUpfront = 0): string {
  if (!status) return 'Unknown';
  const lower = status.toLowerCase();
  if (lower === 'cod_upfront_paid' || (isCOD && (lower === 'paid' || lower === 'pending') && codUpfront > 0)) {
    return `COD Upfront Paid (₹${codUpfront || 99} Paid, Balance Due at Delivery)`;
  }
  return PAYMENT_STATUS_MAP[lower] ?? status;
}

const DELIVERY_STATUS_MAP: Record<string, string> = {
  pending: 'Processing',
  dispatched: 'Shipped',
  shipped: 'Shipped',
  in_transit: 'In Transit',
  out_for_delivery: 'Out for Delivery',
  delivered: 'Delivered',
  rto: 'Returning to Warehouse',
};

export function mapDeliveryStatus(status: string): string {
  if (!status) return 'Processing';
  return DELIVERY_STATUS_MAP[status.toLowerCase()] ?? status;
}

// ---------------------------------------------------------------------------
// Untrusted data wrapping — anti-prompt-injection
// ---------------------------------------------------------------------------

/**
 * Wrap stored data (product titles, order notes, tags) in <untrusted_data> tags
 * to prevent prompt injection from user-controlled fields.
 */
export function wrapUntrustedData(data: string, maxLength = 500): string {
  if (!data) return '';
  // Strip control characters except newlines
  const cleaned = data.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Truncate
  const truncated = cleaned.length > maxLength ? cleaned.slice(0, maxLength) + '…' : cleaned;
  return `<untrusted_data>${truncated}</untrusted_data>`;
}
