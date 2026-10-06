/**
 * Maps internal/Shopify order and delivery statuses to clean, user-friendly labels.
 * If status is not in the recognized list, it defaults to "Processing".
 */
export function getOrderStatusLabel(status: string | null | undefined): string {
  if (!status) return "Processing";
  
  const normalized = status.trim().toLowerCase();

  switch (normalized) {
    // Order Placed
    case 'confirmed':
    case 'placed':
    case 'open':
      return 'Order Placed';

    // Processing
    case 'processing':
    case 'in_progress':
    case 'ready_for_production':
    case 'cutting':
    case 'stitching':
    case 'printing':
    case 'embroidery':
    case 'wash':
    case 'returned (internal)':
    case 'quality_check':
      return 'Processing';

    // Ready for Dispatch
    case 'ready_for_dispatch':
    case 'ready for dispatch':
      return 'Ready for Dispatch';

    // Shipped / Out for Delivery
    case 'shipped':
    case 'out_for_delivery':
    case 'fulfillment: in_transit':
      return 'Shipped / Out for Delivery';

    // Delivered
    case 'delivered':
    case 'fulfillment: delivered':
      return 'Delivered';

    // Return / Exchange Requested
    case 'return_requested':
    case 'exchange_requested':
    case 'return/exchange':
    case 'return_initiated':
    case 'exchange_initiated':
      return 'Return / Exchange Requested';

    case 'return_approved':
      return 'Return Approved';

    case 'exchange_approved':
      return 'Exchange Approved';

    case 'returned':
      return 'Returned';

    case 'exchanged':
      return 'Exchanged';

    // Cancelled
    case 'cancelled':
    case 'canceled':
      return 'Cancelled';

    default:
      return 'Processing';
  }
}

/**
 * Gets the order's position in the user-facing progress journey.
 * Returns a number from 0 to 4 representing:
 * 0: Order Placed
 * 1: Processing
 * 2: Ready for Dispatch
 * 3: Shipped / Out for Delivery
 * 4: Delivered
 * Returns -1 for Cancelled or Return / Exchange states where the progress bar should be hidden.
 */
export function getOrderStatusProgressStep(statusOrLabel: string | null | undefined): number {
  if (!statusOrLabel) return 1;

  // If statusOrLabel is a raw status, convert it to a label first
  const label = statusOrLabel.includes(' ') || statusOrLabel.includes('/') 
    ? statusOrLabel 
    : getOrderStatusLabel(statusOrLabel);
  
  if (
    label === 'Cancelled' ||
    label === 'Cancelled by Zica Bella' ||
    label === 'Return Requested' ||
    label === 'Exchange Requested' ||
    label === 'Return / Exchange Requested' ||
    label === 'Return Approved' ||
    label === 'Exchange Approved' ||
    label === 'Refund Pending' ||
    label === 'Pickup Scheduled' ||
    label === 'Return Item Received' ||
    label === 'Exchange Item Received' ||
    label === 'Returned' ||
    label === 'Exchanged'
  ) {
    return -1;
  }
  
  switch (label) {
    case 'Order Placed':
      return 0;
    case 'Processing':
      return 1;
    case 'Ready for Dispatch':
      return 2;
    case 'Shipped / Out for Delivery':
      return 3;
    case 'Delivered':
      return 4;
    default:
      return 1; // Default to Processing
  }
}

/**
 * Resolves the precise, active status label of an order by analyzing
 * both its delivery status and any associated return/exchange requests.
 */
export function resolveOrderDisplayStatus(order: any): string {
  if (!order) return "Processing";
  
  const mainStatus = String(order.status || order.rawStatus || '').toLowerCase();
  const deliveryStatus = String(order.deliveryStatus || '').toLowerCase();
  const fulfillmentStatus = String(order.fulfillmentStatus || '').toLowerCase();
  const cancelledBy = String(order.cancelledBy || '').toLowerCase();
  
  // 1. Check Cancelled (order / delivery / fulfillment — admin cancel must surface here)
  if (
    mainStatus.includes('cancel') ||
    deliveryStatus.includes('cancel') ||
    fulfillmentStatus.includes('cancel')
  ) {
    if (cancelledBy === 'admin') return 'Cancelled by Zica Bella';
    return 'Cancelled';
  }

  // 2. Check Active Exchange Requests
  const activeExchange = order.exchangeRequests?.find((e: any) => e.status !== 'cancelled' && e.status !== 'rejected');
  if (activeExchange) {
    const exchangeStatus = String(activeExchange.status).toLowerCase();
    switch (exchangeStatus) {
      case 'pending_approval':
        return 'Exchange Requested';
      case 'approved':
      case 'exchange_approved':
        return 'Exchange Approved';
      case 'received':
      case 'qc_passed':
        return 'Exchange Item Received';
      case 'new_order_created':
        return 'Exchanged';
      default:
        return 'Exchange Requested';
    }
  }

  // 3. Check Active Return Requests
  const activeReturn = order.returnRequests?.find((r: any) => r.status !== 'cancelled' && r.status !== 'rejected');
  if (activeReturn) {
    const returnStatus = String(activeReturn.status).toLowerCase();
    switch (returnStatus) {
      case 'pending_approval':
        return 'Return Requested';
      case 'approved':
        return 'Return Approved';
      case 'refund_pending':
        return 'Refund Pending';
      case 'pickup_scheduled':
        return 'Pickup Scheduled';
      case 'received':
        return 'Return Item Received';
      case 'refunded':
        return 'Returned';
      default:
        return 'Return Requested';
    }
  }

  // 4. Fallback to main order status mapping if it's already a return/exchange status
  if (
    mainStatus.includes('return') ||
    mainStatus.includes('exchange') ||
    mainStatus === 'returned' ||
    mainStatus === 'exchanged'
  ) {
    return getOrderStatusLabel(order.status);
  }

  // 5. Normal Order Status Flow
  return getOrderStatusLabel(order.deliveryStatus || order.status);
}

