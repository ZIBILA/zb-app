import { NextRequest, NextResponse } from 'next/server';
import { sendMail } from '@/lib/mailer';
import { orderConfirmationTemplate, newOrderAdminTemplate } from '@/lib/email-templates';
import { logEmail } from '@/lib/log-email';
import { verifyShopifyWebhook } from '@/lib/shopify-webhooks';
import { storefrontUrl } from '@/lib/storefront-url';

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const hmac = req.headers.get('x-shopify-hmac-sha256');

    if (!hmac || !verifyShopifyWebhook(body, hmac)) {
      return NextResponse.json({ error: 'Invalid HMAC signature' }, { status: 401 });
    }

    const order = JSON.parse(body);
    const customerEmail = order.email || order.contact_email;
    
    if (!customerEmail) {
      return NextResponse.json({ error: 'No customer email found' }, { status: 400 });
    }

    // 1. Send Order Confirmation to Customer via DB Template or Fallback
    const { renderDBTemplate, orderConfirmationTemplate } = await import('@/lib/email-templates');

    const customerName = `${order.customer?.first_name || 'Customer'} ${order.customer?.last_name || ''}`.trim();
    const formattedItems = (order.line_items || []).map((item: any) => ({
      name: item.title,
      size: item.variant_title || 'N/A',
      qty: item.quantity,
      price: `${order.currency} ${item.price}`,
    }));

    const itemsHtml = formattedItems
      .map(
        (i: any) => `
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:16px;">
        <tr>
          <td valign="middle" style="color:rgba(255,255,255,0.7); font-family:'DM Mono','Courier New',monospace;">
            <p style="margin:0 0 4px; font-size:11px; font-weight:400; color:rgba(255,255,255,0.85);">${i.name}</p>
            <p style="margin:0 0 4px; font-size:10px; color:rgba(255,255,255,0.4);">Variant: ${i.size}</p>
            <p style="margin:0; font-size:10px; color:rgba(255,255,255,0.4);">Qty: ${i.qty} &nbsp;·&nbsp; ${i.price}</p>
          </td>
        </tr>
      </table>`
      )
      .join('');

    const emailVars = {
      customerName,
      customerEmail,
      orderId: order.name,
      orderDate: new Date(order.created_at || Date.now()).toLocaleDateString('en-IN', { dateStyle: 'long' }),
      itemsHtml,
      items: itemsHtml,
      products: itemsHtml,
      subtotal: `${order.currency} ${order.subtotal_price || order.total_price}`,
      shipping: `${order.currency} ${order.total_shipping_price_set?.shop_money?.amount || '0.00'}`,
      discount: `${order.currency} ${order.total_discounts || '0.00'}`,
      total: `${order.currency} ${order.total_price}`,
      totalPrice: `${order.currency} ${order.total_price}`,
      amount: `${order.currency} ${order.total_price}`,
      price: `${order.currency} ${order.total_price}`,
      shippingAddress: `${order.shipping_address?.address1 || ''}, ${order.shipping_address?.city || ''}, ${order.shipping_address?.province || ''} ${order.shipping_address?.zip || ''}, ${order.shipping_address?.country || 'India'}`.replace(/^[\s,]+|[\s,]+$/g, ''),
      paymentMethod: order.gateway || 'Prepaid',
      orderStatusUrl: `https://zicabella.com/orders/${order.name}`,
    };

    const fallbackFn = () => orderConfirmationTemplate({
      customerName,
      orderId: order.name,
      orderDate: emailVars.orderDate,
      items: formattedItems,
      subtotal: emailVars.subtotal,
      shipping: emailVars.shipping,
      total: emailVars.total,
      shippingAddress: emailVars.shippingAddress,
    });

    const rendered = await renderDBTemplate('ORDER_CONFIRMATION', emailVars, fallbackFn);

    const customerMail = await sendMail({
      to: customerEmail,
      subject: rendered.subject || `Order Confirmation - ${order.name}`,
      html: rendered.html,
    });

    await logEmail({
      recipientEmail: customerEmail,
      recipientName: customerName,
      subject: rendered.subject || `Order Confirmation - ${order.name}`,
      templateName: 'ORDER_CONFIRMATION',
      triggerEvent: 'orders/create',
      referenceId: order.id ? order.id.toString() : order.name,
      status: customerMail.messageId ? 'sent' : 'failed',
      messageId: customerMail.messageId,
    });


    // 2. Send New Order Alert to Admin
    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'admin@zicabella.com';
    const adminHtml = newOrderAdminTemplate({
      orderId: order.name,
      customerName: `${order.customer?.first_name} ${order.customer?.last_name}`,
      customerEmail: customerEmail,
      totalAmount: `${order.currency} ${order.total_price}`,
      items: order.line_items.map((item: any) => ({
        name: item.title,
        qty: item.quantity,
      })),
      orderUrl: storefrontUrl(`/orders/${order.id}`),
    });

    const adminMail = await sendMail({
      to: adminEmail,
      subject: `New Order Received - ${order.name}`,
      html: adminHtml,
    });

    await logEmail({
      recipientEmail: adminEmail,
      subject: `New Order Received - ${order.name}`,
      templateName: 'newOrderAdmin',
      triggerEvent: 'orders/create',
      referenceId: order.id.toString(),
      status: adminMail.messageId ? 'sent' : 'failed',
      messageId: adminMail.messageId,
      sentBy: 'system-admin-alert',
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Order Confirmation Email Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
