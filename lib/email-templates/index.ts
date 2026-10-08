import { baseTemplate } from './base';
import prisma from '@/lib/db';
import { EmailTemplate } from '@prisma/client';
import fs from 'fs';
import path from 'path';

export function orderConfirmationTemplate(data: {
  customerName: string;
  orderId: string;
  orderDate: string;
  items: { name: string; size: string; qty: number; price: string }[];
  subtotal: string;
  shipping: string;
  total: string;
  shippingAddress: string;
  trackingUrl?: string;
}) {
  const itemsHtml = data.items
    .map(
      (item) => `
    <div class="product-row">
      <div style="flex: 1;">
        <div style="font-weight: 600;">${item.name}</div>
        <div style="font-size: 13px; color: #888888;">Size: ${item.size} × ${item.qty}</div>
      </div>
      <div style="font-weight: 600;">${item.price}</div>
    </div>
  `
    )
    .join('');

  const content = `
    <h1>Order Confirmed</h1>
    <p>Hi ${data.customerName},</p>
    <p>Thank you for your order! We're getting it ready for you.</p>
    
    <div class="highlight-box">
      <strong>Order ID:</strong> ${data.orderId}<br/>
      <strong>Date:</strong> ${data.orderDate}
    </div>

    <h3>Items Ordered</h3>
    ${itemsHtml}

    <table class="info-table" style="margin-top: 20px;">
      <tr><td>Subtotal</td><td>${data.subtotal}</td></tr>
      <tr><td>Shipping</td><td>${data.shipping}</td></tr>
      <tr><td style="font-weight: 700; color: #000000;">Total</td><td style="font-weight: 700; color: #000000;">${data.total}</td></tr>
    </table>

    <h3>Shipping Address</h3>
    <p style="white-space: pre-line;">${data.shippingAddress}</p>

    <div style="text-align: center;">
      <a href="https://zicabella.com/account/orders" class="cta-btn">View Order Status</a>
    </div>
  `;

  return baseTemplate(content, `Your Zica Bella order ${data.orderId} is confirmed!`);
}

export function orderShippedTemplate(data: {
  customerName: string;
  orderId: string;
  trackingNumber: string;
  trackingUrl: string;
  carrier: string;
  estimatedDelivery: string;
}) {
  const content = `
    <h1>Your Order is on its Way!</h1>
    <p>Hi ${data.customerName},</p>
    <p>Great news! Your order <strong>${data.orderId}</strong> has been shipped and is heading to you.</p>
    
    <div class="highlight-box">
      <span class="status-badge badge-shipped">Shipped</span><br/><br/>
      <strong>Carrier:</strong> ${data.carrier}<br/>
      <strong>Tracking Number:</strong> ${data.trackingNumber}<br/>
      <strong>Estimated Delivery:</strong> ${data.estimatedDelivery}
    </div>

    <div style="text-align: center;">
      <a href="${data.trackingUrl}" class="cta-btn">Track Your Package</a>
    </div>

    <p style="font-size: 13px; color: #888888; margin-top: 30px;">
      Note: It may take up to 24 hours for the tracking information to update on the carrier's website.
    </p>
  `;

  return baseTemplate(content, `Order ${data.orderId} has been shipped!`);
}

export function orderDeliveredTemplate(data: {
  customerName: string;
  orderId: string;
  reviewUrl: string;
}) {
  const content = `
    <h1>Order Delivered</h1>
    <p>Hi ${data.customerName},</p>
    <p>Your Zica Bella order <strong>${data.orderId}</strong> has been delivered. We hope you love your new items!</p>
    
    <div class="highlight-box" style="text-align: center;">
      <span class="status-badge badge-delivered">Delivered</span>
    </div>

    <p>How was your experience? We'd love to hear your thoughts.</p>

    <div style="text-align: center;">
      <a href="${data.reviewUrl}" class="cta-btn">Leave a Review</a>
    </div>

    <p>Tag us in your photos <strong>@zicabella</strong> for a chance to be featured!</p>
  `;

  return baseTemplate(content, `Your order ${data.orderId} has been delivered!`);
}

export function orderCancelledTemplate(data: {
  customerName: string;
  orderId: string;
  reason: string;
  refundAmount?: string;
  refundTimeline?: string;
}) {
  const content = `
    <h1>Order Cancelled</h1>
    <p>Hi ${data.customerName},</p>
    <p>Your order <strong>${data.orderId}</strong> has been cancelled.</p>
    
    <div class="highlight-box">
      <span class="status-badge badge-cancelled">Cancelled</span><br/><br/>
      <strong>Reason:</strong> ${data.reason}
      ${data.refundAmount ? `<br/><strong>Refund Amount:</strong> ${data.refundAmount}` : ''}
      ${data.refundTimeline ? `<br/><strong>Refund Timeline:</strong> ${data.refundTimeline}` : ''}
    </div>

    <p>If you have any questions regarding this cancellation, please reply to this email or contact our support team.</p>

    <div style="text-align: center;">
      <a href="https://zicabella.com" class="cta-btn">Continue Shopping</a>
    </div>
  `;

  return baseTemplate(content, `Order ${data.orderId} has been cancelled.`);
}

export function returnUpdateTemplate(data: {
  customerName: string;
  orderId: string;
  returnStatus: string;
  refundAmount?: string;
  message: string;
}) {
  const content = `
    <h1>Return Update</h1>
    <p>Hi ${data.customerName},</p>
    <p>We have an update regarding your return for order <strong>${data.orderId}</strong>.</p>
    
    <div class="highlight-box">
      <strong>Current Status:</strong> ${data.returnStatus}<br/>
      ${data.refundAmount ? `<strong>Refund Amount:</strong> ${data.refundAmount}` : ''}
    </div>

    <p>${data.message}</p>

    <div style="text-align: center;">
      <a href="https://zicabella.com/account/orders" class="cta-btn">View Return Details</a>
    </div>
  `;

  return baseTemplate(content, `Update on your return for order ${data.orderId}`);
}

export function lowStockAlertTemplate(data: {
  recipientName: string;
  products: { name: string; sku: string; currentStock: number; threshold: number }[];
}) {
  const productsHtml = data.products
    .map(
      (p) => `
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;">
        <strong>${p.name}</strong><br/><span style="font-size: 12px; color: #888888;">SKU: ${p.sku}</span>
      </td>
      <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0; text-align: right; color: #c62828; font-weight: 700;">
        ${p.currentStock} left
      </td>
    </tr>
  `
    )
    .join('');

  const content = `
    <h1>Low Stock Alert</h1>
    <p>Hi ${data.recipientName},</p>
    <p>The following products are running low and have fallen below the threshold (${data.products[0]?.threshold} units).</p>
    
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
      <thead>
        <tr style="text-align: left; font-size: 12px; color: #888888; text-transform: uppercase;">
          <th style="padding-bottom: 10px;">Product</th>
          <th style="padding-bottom: 10px; text-align: right;">Inventory</th>
        </tr>
      </thead>
      <tbody>
        ${productsHtml}
      </tbody>
    </table>

    <div style="text-align: center;">
      <a href="https://app.zicabella.com/inventory" class="cta-btn">Update Stock</a>
    </div>
  `;

  return baseTemplate(content, `Low stock alert for ${data.products.length} products`);
}

export function newOrderAdminTemplate(data: {
  orderId: string;
  customerName: string;
  customerEmail: string;
  totalAmount: string;
  items: { name: string; qty: number }[];
  orderUrl: string;
}) {
  const itemsHtml = data.items.map((i) => `<li>${i.name} × ${i.qty}</li>`).join('');

  const content = `
    <h1>New Order Received</h1>
    <p>A new order <strong>${data.orderId}</strong> has been placed.</p>
    
    <div class="highlight-box">
      <strong>Customer:</strong> ${data.customerName} (${data.customerEmail})<br/>
      <strong>Total:</strong> ${data.totalAmount}
    </div>

    <h3>Items</h3>
    <ul>${itemsHtml}</ul>

    <div style="text-align: center;">
      <a href="${data.orderUrl}" class="cta-btn">View in Dashboard</a>
    </div>
  `;

  return baseTemplate(content, `New Order ${data.orderId} - ${data.totalAmount}`);
}

export function productionUpdateTemplate(data: {
  vendorName: string;
  taskId: string;
  productName: string;
  fromStage: string;
  toStage: string;
  notes?: string;
  dashboardUrl: string;
}) {
  const content = `
    <h1>Production Update</h1>
    <p>Hi ${data.vendorName},</p>
    <p>The production stage for <strong>${data.productName}</strong> (Task: ${data.taskId}) has been updated.</p>
    
    <div class="highlight-box">
      <strong>Previous Stage:</strong> ${data.fromStage}<br/>
      <strong>New Stage:</strong> <span style="color: #1a56db; font-weight: 700;">${data.toStage}</span>
    </div>

    ${data.notes ? `<p><strong>Notes:</strong> ${data.notes}</p>` : ''}

    <div style="text-align: center;">
      <a href="${data.dashboardUrl}" class="cta-btn">View Task</a>
    </div>
  `;

  return baseTemplate(content, `Production Update: ${data.productName} is now in ${data.toStage}`);
}

export function welcomeEmailTemplate(data: {
  customerName: string;
  appDownloadUrl?: string;
}) {
  const content = `
    <h1>Welcome to Zica Bella</h1>
    <p>Hi ${data.customerName},</p>
    <p>Welcome to the Zica Bella community! We're thrilled to have you with us.</p>
    
    <p>Zica Bella is more than just clothing; it's a movement. Explore our latest collections and find your unique style.</p>

    ${
      data.appDownloadUrl
        ? `
      <div class="highlight-box" style="text-align: center;">
        <p>Get the full experience on our mobile app.</p>
        <a href="${data.appDownloadUrl}" class="cta-btn">Download App</a>
      </div>
    `
        : ''
    }

    <p>Use code <strong>WELCOME10</strong> for 10% off your first order.</p>

    <div style="text-align: center;">
      <a href="https://zicabella.com" class="cta-btn">Start Exploring</a>
    </div>
  `;

  return baseTemplate(content, `Welcome to Zica Bella, ${data.customerName}!`);
}

export function passwordResetTemplate(data: {
  customerName: string;
  resetUrl: string;
  expiresIn: string;
}) {
  const content = `
    <h1>Reset Your Password</h1>
    <p>Hi ${data.customerName},</p>
    <p>We received a request to reset your password for your Zica Bella account. Click the button below to set a new password.</p>
    
    <div style="text-align: center;">
      <a href="${data.resetUrl}" class="cta-btn">Reset Password</a>
    </div>

    <p style="font-size: 13px; color: #888888;">
      This link will expire in ${data.expiresIn}. If you didn't request a password reset, you can safely ignore this email.
    </p>
  `;

  return baseTemplate(content, `Reset your Zica Bella password`);
}

export function marketingTemplate(data: {
  headline: string;
  subheadline: string;
  bodyText: string;
  ctaLabel: string;
  ctaUrl: string;
  imageUrl?: string;
  footerNote?: string;
}) {
  const content = `
    ${data.imageUrl ? `<img src="${data.imageUrl}" style="width: 100%; border-radius: 8px; margin-bottom: 28px;" />` : ''}
    <h1>${data.headline}</h1>
    <h3 style="color: #666666;">${data.subheadline}</h3>
    <p>${data.bodyText}</p>
    
    <div style="text-align: center;">
      <a href="${data.ctaUrl}" class="cta-btn">${data.ctaLabel}</a>
    </div>

    ${data.footerNote ? `<p style="font-size: 12px; color: #888888; text-align: center; margin-top: 40px;">${data.footerNote}</p>` : ''}
  `;

  return baseTemplate(content, data.headline);
}

export function vendorOnboardingTemplate(data: {
  vendorName: string;
  loginUrl: string;
  supportEmail: string;
}) {
  const content = `
    <h1>Welcome, ${data.vendorName}</h1>
    <p>Welcome to the Zica Bella vendor network. We're excited to partner with you.</p>
    
    <p>You can now access your vendor dashboard to manage production tasks and view orders.</p>

    <div style="text-align: center;">
      <a href="${data.loginUrl}" class="cta-btn">Access Dashboard</a>
    </div>

    <div class="highlight-box">
      <strong>Support:</strong> If you have any questions, please reach out to us at ${data.supportEmail}.
    </div>
  `;

  return baseTemplate(content, `Welcome to Zica Bella Vendor Network`);
}

export * from './orderPlaced';
export * from './orderShipped';
export * from './orderDelivered';

export async function getAllTemplates(): Promise<EmailTemplate[]> {
  return prisma.emailTemplate.findMany({
    orderBy: { createdAt: 'desc' }
  });
}

export async function getTemplateById(id: string): Promise<EmailTemplate | null> {
  return prisma.emailTemplate.findUnique({
    where: { id }
  });
}

export async function upsertTemplate(template: Partial<EmailTemplate>): Promise<EmailTemplate> {
  if (template.id) {
    return prisma.emailTemplate.update({
      where: { id: template.id },
      data: template as any
    });
  }
  return prisma.emailTemplate.create({
    data: {
      name: template.name || 'New Template',
      category: template.category || 'transactional',
      subject: template.subject || '',
      htmlBody: template.htmlBody || '',
      variables: template.variables || [],
      isActive: template.isActive ?? true,
    }
  });
}

export function extractVariables(html: string): string[] {
  const regex = /\{\{([^}]+)\}\}/g;
  const matches = html.match(regex);
  if (!matches) return [];
  const uniqueVars = Array.from(new Set(matches.map(m => m.slice(2, -2).trim())));
  return uniqueVars;
}

// Normalize legacy lowercase triggers to the standard UPPERCASE format used in DB
const TRIGGER_ALIASES: Record<string, string> = {
  'confirmation': 'ORDER_CONFIRMATION',
  'order_confirmation': 'ORDER_CONFIRMATION',
  'cod_confirmation': 'ORDER_CONFIRMATION',
  'shipped': 'ORDER_SHIPPED',
  'order_shipped': 'ORDER_SHIPPED',
  'delivered': 'ORDER_DELIVERED',
  'order_delivered': 'ORDER_DELIVERED',
  'cancelled': 'ORDER_CANCELLED',
  'order_cancelled': 'ORDER_CANCELLED',
  'payment_failed': 'PAYMENT_FAILED',
  'welcome': 'WELCOME',
  'return_refund': 'RETURN_REFUND',
  'password_reset': 'PASSWORD_RESET',
};

function normalizeTrigger(trigger: string): string {
  const upper = trigger.toUpperCase();
  return TRIGGER_ALIASES[trigger.toLowerCase()] || upper;
}

export function enrichEmailVariables(rawVars: Record<string, any>): Record<string, any> {
  const vars: Record<string, any> = { ...rawVars };

  // 1. Customer
  const name = vars.customerName || vars.name || vars.recipientName || 'Valued Customer';
  const email = vars.customerEmail || vars.email || vars.recipientEmail || '';
  vars.customerName = name;
  vars.name = name;
  vars.recipientName = name;
  vars.customerEmail = email;
  vars.email = email;

  // 2. Order ID & Date
  const orderId = vars.orderId || vars.id || vars.orderNumber || 'N/A';
  const orderDate = vars.orderDate || new Date().toLocaleDateString('en-IN', { dateStyle: 'long' });
  vars.orderId = orderId;
  vars.id = orderId;
  vars.orderNumber = orderId;
  vars.orderDate = orderDate;

  // 3. Money / Amounts
  const totalVal = vars.totalPrice || vars.total || vars.amount || vars.price || '₹0';
  vars.totalPrice = totalVal;
  vars.total = totalVal;
  vars.amount = totalVal;
  vars.price = totalVal;
  vars.subtotal = vars.subtotal || totalVal;
  vars.shipping = vars.shipping || '₹0';
  vars.discount = vars.discount || '₹0';
  vars.currency = vars.currency || 'INR';

  // 4. Items & Products
  const itemsHtml = vars.itemsHtml || vars.items || vars.products || '';
  vars.itemsHtml = itemsHtml;
  vars.items = itemsHtml;
  vars.products = itemsHtml;
  vars.variants = vars.variants || 'N/A';

  // 5. Payment & Status
  vars.paymentMethod = vars.paymentMethod || 'Prepaid';
  vars.orderStatusUrl = vars.orderStatusUrl || `https://zicabella.com/account/orders`;

  // 6. Shipping / Courier / Tracking
  const courier = vars.courier || vars.carrier || vars.courierName || 'Shiprocket';
  vars.courier = courier;
  vars.carrier = courier;
  vars.courierName = courier;
  vars.trackingNumber = vars.trackingNumber || 'N/A';
  vars.trackingUrl = vars.trackingUrl || `https://zicabella.com/track?id=${vars.trackingNumber}`;

  // 7. Address (Full & Split)
  const fullAddress = vars.shippingAddress || 'N/A';
  vars.shippingAddress = fullAddress;
  if (!vars.shippingAddressLine1 && typeof fullAddress === 'string') {
    const parts = fullAddress.split(',');
    vars.shippingAddressLine1 = parts[0]?.trim() || fullAddress;
    vars.shippingCity = parts[1]?.trim() || 'N/A';
    vars.shippingState = parts[2]?.trim() || 'N/A';
    vars.shippingZip = parts[3]?.trim() || 'N/A';
    vars.shippingCountry = parts[4]?.trim() || 'India';
  }

  // 8. Returns / Refunds
  vars.reason = vars.reason || 'N/A';
  vars.refundAmount = vars.refundAmount || totalVal;
  vars.refundTimeline = vars.refundTimeline || '5-7 business days';
  vars.returnStatus = vars.returnStatus || 'Processed';
  vars.reviewUrl = vars.reviewUrl || `https://zicabella.com/account/orders`;

  // 9. Reset & Auth
  vars.resetUrl = vars.resetUrl || 'https://zicabella.com/reset-password';
  vars.expiresIn = vars.expiresIn || '1 hour';
  vars.appDownloadUrl = vars.appDownloadUrl || 'https://zicabella.com/app';

  return vars;
}

export async function renderDBTemplate(
  trigger: string,
  variables: Record<string, any>,
  fallbackFn: () => string
): Promise<{ subject: string; html: string }> {
  try {
    const normalizedTrigger = normalizeTrigger(trigger);
    if (process.env.EMAIL_DEBUG === '1') {
      console.log(`[renderDBTemplate] Looking up template for trigger: "${trigger}" → normalized: "${normalizedTrigger}"`);
    }

    const template = await prisma.emailTemplate.findFirst({
      where: {
        automationTrigger: normalizedTrigger,
        isActive: true,
      },
    });

    if (!template) {
      console.warn(`[renderDBTemplate] No active DB template found for trigger "${normalizedTrigger}". Using fallback template.`);
      return {
        subject: '',
        html: fallbackFn(),
      };
    }

    if (process.env.EMAIL_DEBUG === '1') {
      console.log(`[renderDBTemplate] ✓ Found DB template "${template.name}" (id: ${template.id}) for trigger "${normalizedTrigger}"`);
    }

    const enrichedVars = enrichEmailVariables(variables);
    let subject = template.subject;
    let html = template.htmlBody;

    // Substitute standard variables in subject and html
    Object.entries(enrichedVars).forEach(([key, val]) => {
      const stringVal = String(val ?? '');
      subject = subject.replaceAll(`{{${key}}}`, stringVal);
      html = html.replaceAll(`{{${key}}}`, stringVal);
    });

    // Strip any unresolved remaining variables
    const remainingRegex = /\{\{([^}]+)\}\}/g;
    subject = subject.replace(remainingRegex, '');
    html = html.replace(remainingRegex, '');

    // Ensure proper DOCTYPE wrapper for email client rendering
    if (html && !html.includes('<!DOCTYPE html>')) {
      html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background:#000;">${html}</body></html>`;
    }

    return { subject, html };
  } catch (error) {
    console.error(`[renderDBTemplate] Error rendering database template for ${trigger}:`, error);
    return {
      subject: '',
      html: fallbackFn(),
    };
  }
}

