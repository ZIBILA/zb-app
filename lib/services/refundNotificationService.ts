import { sendEmail } from '@/lib/mailer';

export interface RefundNotificationPayload {
  returnRequestId?: string;
  exchangeRequestId?: string;
  orderId: string;
  shopifyOrderId?: string | null;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  items: Array<{
    title: string;
    sku?: string | null;
    quantity: number;
    price: number;
    reason?: string | null;
  }>;
  totalRefundAmount: number;
  refundMethod?: string | null;
  reason?: string | null;
  requestType: 'RETURN' | 'EXCHANGE';
}

/**
 * Sends a notification email to developer@zicabella.com whenever a new
 * return or exchange refund request is submitted by a customer.
 */
export async function sendRefundRequestNotification(payload: RefundNotificationPayload): Promise<void> {
  const recipientEmail = 'developer@zicabella.com';
  const {
    returnRequestId,
    exchangeRequestId,
    orderId,
    shopifyOrderId,
    customerName,
    customerEmail,
    customerPhone,
    items,
    totalRefundAmount,
    refundMethod,
    reason,
    requestType,
  } = payload;

  const displayOrderId = shopifyOrderId || orderId;
  const requestId = returnRequestId || exchangeRequestId || 'N/A';
  const methodDisplay = (refundMethod || 'original_method').toUpperCase().replace('_', ' ');

  const itemsHtml = items
    .map(
      (item) => `
      <tr style="border-bottom: 1px solid rgba(255,255,255,0.08);">
        <td style="padding: 10px 12px; color: #ffffff; font-size: 13px; font-weight: 500;">
          ${item.title} ${item.sku ? `<br/><span style="font-size:11px; color:#888;">SKU: ${item.sku}</span>` : ''}
        </td>
        <td style="padding: 10px 12px; color: #aaaaaa; font-size: 13px; text-align: center;">${item.quantity}</td>
        <td style="padding: 10px 12px; color: #ffffff; font-size: 13px; text-align: right; font-weight: 600;">₹${item.price * item.quantity}</td>
      </tr>`
    )
    .join('');

  const adminDashboardUrl = `https://app.zicabella.com/dashboard/refunds`;

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>New ${requestType} Refund Request</title>
  </head>
  <body style="margin:0; padding:0; background-color:#09090b; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#09090b; padding:30px 15px;">
      <tr>
        <td align="center">
          <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color:#18181b; border-radius:12px; border:1px solid #27272a; overflow:hidden;">
            <!-- Header -->
            <tr>
              <td style="background-color:#000000; padding:24px 30px; border-bottom:1px solid #27272a;">
                <h2 style="margin:0; color:#ffffff; font-size:20px; font-weight:700; letter-spacing:1px; text-transform:uppercase;">ZICA BELLA</h2>
                <p style="margin:4px 0 0; color:#a1a1aa; font-size:12px; font-weight:500;">NEW ${requestType} REFUND REQUEST PENDING APPROVAL</p>
              </td>
            </tr>
            <!-- Content -->
            <tr>
              <td style="padding:30px;">
                <div style="background-color:rgba(234,179,8,0.1); border:1px solid rgba(234,179,8,0.3); border-radius:8px; padding:14px 16px; margin-bottom:24px;">
                  <p style="margin:0; color:#fef08a; font-size:13px; font-weight:600;">
                    ⚠️ Action Required: This refund requires QC & explicit approval in the Admin Dashboard. No auto-refund has been processed.
                  </p>
                </div>

                <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom:20px;">
                  <tr>
                    <td width="50%" style="vertical-align:top;">
                      <p style="margin:0 0 4px; color:#71717a; font-size:11px; text-transform:uppercase; font-weight:600;">Order ID</p>
                      <p style="margin:0 0 12px; color:#ffffff; font-size:15px; font-weight:700;">#${displayOrderId}</p>
                      
                      <p style="margin:0 0 4px; color:#71717a; font-size:11px; text-transform:uppercase; font-weight:600;">Request ID</p>
                      <p style="margin:0; color:#a1a1aa; font-size:13px; font-family:monospace;">${requestId}</p>
                    </td>
                    <td width="50%" style="vertical-align:top;">
                      <p style="margin:0 0 4px; color:#71717a; font-size:11px; text-transform:uppercase; font-weight:600;">Customer</p>
                      <p style="margin:0 0 4px; color:#ffffff; font-size:14px; font-weight:600;">${customerName}</p>
                      <p style="margin:0 0 2px; color:#a1a1aa; font-size:12px;">${customerEmail || 'No Email'}</p>
                      <p style="margin:0; color:#a1a1aa; font-size:12px;">${customerPhone || 'No Phone'}</p>
                    </td>
                  </tr>
                </table>

                <!-- Summary Info -->
                <div style="background-color:#09090b; border-radius:8px; border:1px solid #27272a; padding:16px; margin-bottom:24px;">
                  <table width="100%" border="0" cellspacing="0" cellpadding="0">
                    <tr>
                      <td>
                        <span style="color:#71717a; font-size:12px; font-weight:500;">Requested Refund Method:</span><br/>
                        <strong style="color:#ffffff; font-size:14px;">${methodDisplay}</strong>
                      </td>
                      <td align="right">
                        <span style="color:#71717a; font-size:12px; font-weight:500;">Estimated Refund Amount:</span><br/>
                        <strong style="color:#22c55e; font-size:20px; font-weight:800;">₹${totalRefundAmount.toFixed(2)}</strong>
                      </td>
                    </tr>
                  </table>
                  ${reason ? `<div style="margin-top:12px; padding-top:12px; border-top:1px dashed #27272a; color:#a1a1aa; font-size:12px;"><strong>Reason / Notes:</strong> ${reason}</div>` : ''}
                </div>

                <!-- Items Table -->
                <h4 style="margin:0 0 12px; color:#ffffff; font-size:14px; text-transform:uppercase; letter-spacing:0.5px;">Items Included</h4>
                <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#09090b; border:1px solid #27272a; border-radius:8px; border-collapse:collapse; margin-bottom:28px;">
                  <thead>
                    <tr style="background-color:#121215; border-bottom:1px solid #27272a;">
                      <th align="left" style="padding:10px 12px; color:#71717a; font-size:11px; text-transform:uppercase;">Item</th>
                      <th align="center" style="padding:10px 12px; color:#71717a; font-size:11px; text-transform:uppercase;">Qty</th>
                      <th align="right" style="padding:10px 12px; color:#71717a; font-size:11px; text-transform:uppercase;">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${itemsHtml}
                  </tbody>
                </table>

                <!-- CTA Button -->
                <div style="text-align:center; margin-top:30px;">
                  <a href="${adminDashboardUrl}" target="_blank" style="display:inline-block; background-color:#ffffff; color:#000000; font-size:14px; font-weight:700; text-decoration:none; padding:14px 32px; border-radius:8px; letter-spacing:0.5px; box-shadow:0 4px 12px rgba(255,255,255,0.15);">
                    VIEW & APPROVE IN ADMIN DASHBOARD
                  </a>
                </div>
              </td>
            </tr>
            <!-- Footer -->
            <tr>
              <td style="background-color:#09090b; padding:16px 30px; border-top:1px solid #27272a; text-align:center;">
                <p style="margin:0; color:#71717a; font-size:11px;">Zica Bella Admin Automated Refund Security System</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;

  const text = `
  NEW ${requestType} REFUND REQUEST PENDING APPROVAL

  Order ID: #${displayOrderId}
  Request ID: ${requestId}
  Customer: ${customerName} (${customerEmail || 'No email'}, ${customerPhone || 'No phone'})
  Estimated Refund: ₹${totalRefundAmount}
  Requested Method: ${methodDisplay}
  Reason: ${reason || 'N/A'}

  Items:
  ${items.map((i) => `- ${i.title} (${i.sku || 'No SKU'}) x${i.quantity} = ₹${i.price * i.quantity}`).join('\n')}

  Manage and approve this refund in Admin Dashboard:
  ${adminDashboardUrl}
  `;

  try {
    await sendEmail({
      to: recipientEmail,
      subject: `[Refund Request] ${requestType} Refund for Order #${displayOrderId} (₹${totalRefundAmount})`,
      html,
      text,
    });
    console.log(`[RefundNotification] Email sent to ${recipientEmail} for Order #${displayOrderId}`);
  } catch (err: any) {
    console.error(`[RefundNotification] Failed to send email to ${recipientEmail}:`, err?.message || err);
  }
}
