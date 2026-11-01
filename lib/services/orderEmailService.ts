import { sendEmail } from '@/lib/mailer';
import { deliverOnce, isDeliverableEmail, normalizeOrderRef, type CustomerEventType } from '@/lib/notifications/customer-events';
import { 
  orderPlacedEmail, 
  orderShippedEmail, 
  orderDeliveredEmail,
  orderCancelledTemplate,
  renderDBTemplate
} from '@/lib/email-templates';

let _fetchProductById: ((id: string) => Promise<any>) | null = null;
async function getFetchProductById() {
  if (!_fetchProductById) {
    const mod = await import('@/lib/shopify-admin');
    _fetchProductById = mod.fetchProductById;
  }
  return _fetchProductById;
}

export interface OrderData {
  customerName: string;
  customerEmail: string;
  orderId: string;
  items: Array<{
    name: string;
    size?: string;
    quantity: number;
    price: number;
    image?: string;
    product_id?: number | string | null;
    variant_title?: string | null;
  }>;
  total: number;
  currency?: string;
  orderDate?: string;
  paymentMethod?: string;
  subtotal?: number;
  shipping?: number;
  discount?: number;
  shippingAddress?: string;
}

async function getItemsHtml(items: OrderData['items'], currencySymbol: string): Promise<string> {
  const fetchProduct = await getFetchProductById();

  const rows = await Promise.all(items.map(async (item) => {
    let imageUrl = item.image || '';
    
    // Attempt to fetch product image from Shopify if not already set
    if (!imageUrl) {
      try {
        if (item.product_id) {
          const product = await fetchProduct(String(item.product_id));
          imageUrl = product?.images?.[0]?.src ?? '';
        }
      } catch {
        imageUrl = '';
      }
    }

    const imgBlock = imageUrl
      ? `<img src="${imageUrl}" width="88" height="88" alt="${item.name}" style="display:block; border-radius:1px; object-fit:cover; background:#1a1a1a;" />`
      : `<div style="width:88px; height:88px; background:#1a1a1a; border-radius:1px;"></div>`;

    const variantLine = item.variant_title || item.size || '';

    return `
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:16px;">
      <tr>
        <td width="88" valign="top" style="padding-right:16px;">${imgBlock}</td>
        <td valign="middle" style="color:rgba(255,255,255,0.55); font-family:'DM Mono','Courier New',monospace;">
          <p style="margin:0 0 4px; font-size:11px; font-weight:400; color:rgba(255,255,255,0.85); letter-spacing:0.5px;">${item.name}</p>
          <p style="margin:0 0 4px; font-size:10px; font-weight:300; color:rgba(255,255,255,0.4);">${variantLine}</p>
          <p style="margin:0; font-size:10px; font-weight:300; color:rgba(255,255,255,0.4);">Qty: ${item.quantity} &nbsp;·&nbsp; ${currencySymbol}${item.price}</p>
        </td>
      </tr>
    </table>
    <div style="height:1px; background:rgba(255,255,255,0.05); margin-bottom:16px;"></div>`;
  }));

  return rows.join('');
}

async function sendDynamicEmail(
  trigger: string,
  order: OrderData,
  fallbackSubject: string,
  fallbackHtml: string,
  fallbackText: string,
  extraVars: Record<string, any> = {}
) {
  const currencySymbols: Record<string, string> = {
    INR: '₹', USD: '$', GBP: '£', CAD: '$', AUD: '$', AED: 'د.إ', EUR: '€'
  };
  const currencyCode = order.currency || 'INR';
  const currencySymbol = currencySymbols[currencyCode] || '₹';
  const orderDateStr = order.orderDate || new Date().toLocaleDateString('en-IN', { dateStyle: 'long' });
  const itemsHtml = await getItemsHtml(order.items, currencySymbol);

  const variantsSummary = order.items
    .map(i => [i.name, i.variant_title || i.size].filter(Boolean).join(' - '))
    .filter(Boolean)
    .join(' | ') || 'N/A';

  const variables = {
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    orderId: order.orderId,
    total: `${currencySymbol}${order.total} ${currencyCode}`,
    totalPrice: `${currencySymbol}${order.total} ${currencyCode}`,
    amount: `${currencySymbol}${order.total}`,
    price: `${currencySymbol}${order.total}`,
    currency: currencyCode,
    orderDate: orderDateStr,
    itemsHtml: itemsHtml,
    items: itemsHtml,
    products: itemsHtml,
    variants: variantsSummary,
    paymentMethod: order.paymentMethod || 'Prepaid',
    orderStatusUrl: `https://zicabella.com/orders/${order.orderId}`,
    subtotal: order.subtotal !== undefined ? `${currencySymbol}${order.subtotal}` : `${currencySymbol}${order.total}`,
    shipping: order.shipping !== undefined ? `${currencySymbol}${order.shipping}` : `${currencySymbol}0`,
    discount: order.discount !== undefined ? `${currencySymbol}${order.discount}` : `${currencySymbol}0`,
    shippingAddress: order.shippingAddress || 'N/A',
    ...extraVars
  };

  const { subject, html } = await renderDBTemplate(trigger, variables, () => fallbackHtml);

  const send = () =>
    sendEmail({
      to: order.customerEmail,
      subject: subject || fallbackSubject,
      html: html,
      text: html === fallbackHtml ? fallbackText : 'Please view this email in a modern email client.',
    });

  // Lifecycle emails go out once per order (shared with the event scanner and manual status updates).
  const eventType = LIFECYCLE_EVENT_BY_TRIGGER[trigger];
  if (!eventType) return send();
  if (!isDeliverableEmail(order.customerEmail)) return;
  const result = await deliverOnce({
    eventKey: `order:${normalizeOrderRef(order.orderId)}:${eventType}`,
    eventType,
    channel: 'email',
    recipient: order.customerEmail,
    send,
  });
  if (result === 'failed') throw new Error(`${trigger} email failed for order ${order.orderId}`);
}

const LIFECYCLE_EVENT_BY_TRIGGER: Record<string, CustomerEventType | undefined> = {
  ORDER_CONFIRMATION: 'ORDER_CONFIRMED',
  ORDER_SHIPPED: 'ORDER_SHIPPED',
  ORDER_DELIVERED: 'ORDER_DELIVERED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
};

/**
 * Sends a premium order confirmation email to the customer
 */
export async function sendOrderConfirmationEmail(order: OrderData): Promise<void> {
  try {
    console.log(`[OrderEmailService] Building confirmation email for Order #${order.orderId}`);
    
    const fallback = orderPlacedEmail({
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      orderId: order.orderId,
      items: order.items,
      total: order.total,
      currency: order.currency || 'INR',
      orderDate: order.orderDate,
      subtotal: order.subtotal,
      shipping: order.shipping,
      discount: order.discount,
      shippingAddress: order.shippingAddress,
      paymentMethod: order.paymentMethod,
    });

    await sendDynamicEmail('ORDER_CONFIRMATION', order, fallback.subject, fallback.html, fallback.text);

    console.log(`[OrderEmailService] Order confirmation email successfully sent for Order #${order.orderId}`);
  } catch (error) {
    console.error(`[OrderEmailService] Failed to send order confirmation email for Order #${order.orderId}:`, error);
  }
}

/**
 * Sends a COD order confirmation email to the customer
 */
export async function sendOrderCodConfirmationEmail(order: OrderData): Promise<void> {
  try {
    console.log(`[OrderEmailService] Building COD confirmation email for Order #${order.orderId}`);
    
    const fallback = orderPlacedEmail({
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      orderId: order.orderId,
      items: order.items,
      total: order.total,
      currency: order.currency || 'INR',
      orderDate: order.orderDate,
      subtotal: order.subtotal,
      shipping: order.shipping,
      discount: order.discount,
      shippingAddress: order.shippingAddress,
      paymentMethod: order.paymentMethod || 'COD',
    });

    fallback.subject = `COD Order Confirmed — #${order.orderId} | Zica Bella`;
    fallback.text = `Your Cash on Delivery order has been placed successfully.\n\n` + fallback.text;

    await sendDynamicEmail('ORDER_CONFIRMATION', order, fallback.subject, fallback.html, fallback.text);

    console.log(`[OrderEmailService] COD confirmation email successfully sent for Order #${order.orderId}`);
  } catch (error) {
    console.error(`[OrderEmailService] Failed to send COD confirmation email for Order #${order.orderId}:`, error);
  }
}

/**
 * Sends a shipping notification email to the customer with courier and tracking info
 */
export async function sendOrderShippedEmail(
  order: OrderData & { trackingNumber?: string; courier?: string }
): Promise<void> {
  try {
    console.log(`[OrderEmailService] Building shipping email for Order #${order.orderId}`);
    
    const fallback = orderShippedEmail({
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      orderId: order.orderId,
      items: order.items,
      total: order.total,
      currency: order.currency || 'INR',
      orderDate: order.orderDate,
      trackingNumber: order.trackingNumber,
      courier: order.courier,
    });

    await sendDynamicEmail('ORDER_SHIPPED', order, fallback.subject, fallback.html, fallback.text, {
      trackingNumber: order.trackingNumber || 'N/A',
      courier: order.courier || 'Standard Shipping',
      carrier: order.courier || 'Standard Shipping',
      trackingUrl: order.trackingNumber ? `https://zicabella.com/track?id=${order.trackingNumber}` : 'https://zicabella.com/account/orders'
    });

    console.log(`[OrderEmailService] Shipping notification email successfully sent for Order #${order.orderId}`);
  } catch (error) {
    console.error(`[OrderEmailService] Failed to send shipping notification email for Order #${order.orderId}:`, error);
  }
}

/**
 * Sends a delivery confirmation and review request email to the customer
 */
export async function sendOrderDeliveredEmail(order: OrderData): Promise<void> {
  try {
    console.log(`[OrderEmailService] Building delivery email for Order #${order.orderId}`);
    
    const fallback = orderDeliveredEmail({
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      orderId: order.orderId,
      items: order.items,
      total: order.total,
      currency: order.currency || 'INR',
      orderDate: order.orderDate,
    });

    await sendDynamicEmail('ORDER_DELIVERED', order, fallback.subject, fallback.html, fallback.text);

    console.log(`[OrderEmailService] Delivery email successfully sent for Order #${order.orderId}`);
  } catch (error) {
    console.error(`[OrderEmailService] Failed to send delivery email for Order #${order.orderId}:`, error);
  }
}

/**
 * Sends an order cancellation email to the customer
 */
export async function sendOrderCancelledEmail(order: OrderData): Promise<void> {
  try {
    console.log(`[OrderEmailService] Building cancellation email for Order #${order.orderId}`);
    
    const fallbackHtml = orderCancelledTemplate({
      customerName: order.customerName,
      orderId: order.orderId,
      reason: 'Requested by customer or out of stock',
    });

    const fallbackSubject = `Order Cancelled — #${order.orderId} | Zica Bella`;
    const fallbackText = `Your order #${order.orderId} has been cancelled.`;

    await sendDynamicEmail('ORDER_CANCELLED', order, fallbackSubject, fallbackHtml, fallbackText, {
      reason: 'Requested by customer or out of stock'
    });

    console.log(`[OrderEmailService] Cancellation email successfully sent for Order #${order.orderId}`);
  } catch (error) {
    console.error(`[OrderEmailService] Failed to send cancellation email for Order #${order.orderId}:`, error);
  }
}
