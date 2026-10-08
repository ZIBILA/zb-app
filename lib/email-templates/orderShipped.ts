import { baseEmailLayout } from './base';
import { OrderEmailData } from './orderPlaced';

export function orderShippedEmail(
  data: OrderEmailData & { trackingNumber?: string; courier?: string }
): { subject: string; html: string; text: string } {
  const firstName = data.customerName.split(' ')[0] || data.customerName;
  const subject = `Your Zica Bella order is on its way! 🚚`;
  const courierName = data.courier || 'our delivery partner';

  // Build the tracking HTML block
  let trackingBlock = '';
  if (data.trackingNumber) {
    trackingBlock = `
      <div style="background-color: #fcfbf9; border: 1px dashed #C9A96E; border-radius: 6px; padding: 20px; margin: 25px 0; text-align: center;">
        <p style="margin: 0 0 10px 0; color: #666666; font-size: 14px;">Courier Service: <strong style="color: #000000;">${courierName}</strong></p>
        <p style="margin: 0 0 5px 0; color: #666666; font-size: 14px;">Tracking Number</p>
        <h3 style="margin: 0; font-family: monospace; font-size: 22px; color: #C9A96E; letter-spacing: 2px;">
          ${data.trackingNumber}
        </h3>
      </div>
    `;
  }

  // Determine CTA Link
  // Prefer Shiprocket public tracking when an AWB is present
  const trackingUrl = data.trackingNumber 
    ? `https://shiprocket.co/tracking/${data.trackingNumber}`
    : `https://zicabella.com/orders/${data.orderId}`;

  // HTML Content
  const htmlContent = `
    <h2 style="font-family: Georgia, serif; font-size: 24px; font-weight: 300; color: #000000; margin-top: 0; margin-bottom: 20px; border-bottom: 1px solid #C9A96E; padding-bottom: 10px;">
      Your order has been shipped
    </h2>
    
    <p style="margin: 0 0 20px 0;">Hi ${firstName},</p>
    
    <p style="margin: 0 0 25px 0;">
      Exciting news! Your Zica Bella order <strong>#${data.orderId}</strong> has been shipped via <strong>${courierName}</strong> and is currently on its way to your wardrobe.
    </p>

    ${trackingBlock}

    <div style="text-align: center; margin: 35px 0;">
      <a href="${trackingUrl}" style="display: inline-block; background-color: #C9A96E; color: #000000; text-decoration: none; padding: 14px 35px; border-radius: 4px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; font-size: 13px; box-shadow: 0 4px 12px rgba(201, 169, 110, 0.3);">
        Track Shipment
      </a>
    </div>

    <p style="margin: 0 0 5px 0; font-style: italic; color: #555555; text-align: center;">
      Sit tight — your pieces are headed your way.
    </p>
    <p style="margin: 0; color: #888888; text-align: center; font-size: 13px;">
      With love,<br/>The Zica Bella Team
    </p>
  `;

  // Plain-Text Fallback
  const textContent = `
Your order has been shipped!
Hi ${firstName},

Exciting news! Your Zica Bella order #${data.orderId} has been shipped via ${courierName} and is currently on its way to you.

${data.trackingNumber ? `Courier: ${courierName}\nTracking Number: ${data.trackingNumber}\n` : ''}
Track shipment here: ${trackingUrl}

Sit tight — your pieces are headed your way.

With love,
The Zica Bella Team
  `.trim();

  return {
    subject,
    html: baseEmailLayout(htmlContent, `Order #${data.orderId} Shipped`),
    text: textContent,
  };
}
