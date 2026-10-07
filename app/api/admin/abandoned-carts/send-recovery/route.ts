import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { sendAbandonedCart, sendCustomCartRecovery } from "@/lib/whatsapp/templates";
import { SmsService } from "@/lib/services/sms.service";
import { sendMail } from "@/lib/mailer";
import { isOrderValidConverted } from "@/lib/cartValidation";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { cartId, channel, subject, messageBody, templateName } = await req.json();

    if (!cartId || !channel) {
      return NextResponse.json({ error: "Missing cartId or channel" }, { status: 400 });
    }

    const cart = await prisma.cart.findUnique({
      where: { id: cartId },
      include: {
        customer: true,
        items: true,
        convertedOrder: {
          select: {
            id: true,
            status: true,
            paymentStatus: true,
            paymentMethod: true
          }
        }
      }
    });

    if (!cart) {
      return NextResponse.json({ error: "Cart not found" }, { status: 404 });
    }

    // Check 1: Direct cart-to-order link
    if (cart.status === "converted" || (cart.convertedOrder && isOrderValidConverted(cart.convertedOrder))) {
      return NextResponse.json({ error: "Cart is already converted to a completed order. Recovery message blocked." }, { status: 400 });
    }

    // Check 2: Phone/email-based order matching (catches race conditions where
    // checkout completed but cart.convertedOrderId wasn't linked yet)
    const phone = cart.phone || cart.customer?.phone;
    const email = cart.email || cart.customer?.email;
    const name = cart.customer?.name || "Customer";
    const checkoutUrl = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com'}/cart?recover=${cart.id}`;

    try {
      const normPhone = phone ? phone.replace(/\D/g, "").slice(-10) : null;
      if (normPhone && normPhone.length >= 10) {
        const matchedOrder = await prisma.order.findFirst({
          where: {
            createdAt: { gte: new Date(cart.createdAt.getTime() - 60 * 60 * 1000) },
            NOT: [
              { status: { in: ["failed", "FAILED", "payment_failed", "payment_pending", "cancelled", "CANCELLED", "draft", "voided"] } },
              { paymentStatus: { in: ["failed", "FAILED", "payment_failed", "payment_pending", "cancelled", "CANCELLED", "voided"] } }
            ],
            OR: [
              { paymentStatus: { in: ["paid", "cod_upfront_paid", "partially_paid", "refunded", "partially_refunded", "PAID", "SUCCESS", "success", "captured"] } },
              {
                AND: [
                  { paymentMethod: { in: ["COD", "cod", "Cash on Delivery", "cash_on_delivery"] } },
                  { status: { in: ["approved", "open", "fulfilled", "delivered", "shipped", "completed", "processing", "processed", "CONFIRMED", "confirmed", "placed"] } }
                ]
              }
            ],
            AND: [
              {
                OR: [
                  ...(cart.customerId ? [{ customerId: cart.customerId }] : []),
                  { customer: { phone: { contains: normPhone } } },
                  { shippingAddress: { contains: normPhone } },
                  ...(email ? [{ customer: { email: { equals: email, mode: "insensitive" as const } } }] : []),
                  ...(email ? [{ shippingAddress: { contains: email } }] : [])
                ]
              }
            ]
          }
        });

        if (matchedOrder) {
          const { linkCartToOrderSafe } = await import("@/lib/cartConversion");
          await linkCartToOrderSafe(cart.id, matchedOrder.id).catch(() => {});
          return NextResponse.json({
            error: "Customer has already placed a completed order. Recovery message blocked to prevent duplicate messaging."
          }, { status: 400 });
        }
      }
    } catch (reconErr: any) {
      console.warn("[Send Recovery] Pre-send conversion check warning:", reconErr?.message);
    }

    if (channel === "whatsapp") {
      if (!phone) return NextResponse.json({ error: "No phone number available for this cart" }, { status: 400 });
      
      const firstItem = cart.items?.[0] || {};
      const productImageUrl = firstItem.image || '';
      const productName = firstItem.title || '';
      let productHandle = firstItem.handle || '';
      if (!productHandle && firstItem.productId) {
        try {
          const dbProduct = await prisma.product.findUnique({
            where: { shopifyProductId: String(firstItem.productId) }
          });
          if (dbProduct && dbProduct.handle) {
            productHandle = dbProduct.handle;
          }
        } catch (e) {}
      }
      if (!productHandle && productName) {
        productHandle = productName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
      }
      const cartTotal = String(cart.subtotal || '0.00');
      const itemCount = cart.items?.length || 0;

      let result;
      if (templateName) {
        result = await sendCustomCartRecovery({
          phone,
          customerName: name,
          checkoutUrl,
          templateName,
          productImageUrl,
          productName,
          cartTotal,
          itemCount,
          productHandle,
          cartId: cart.id,
          recoveryStage: 1
        });
      } else {
        result = await sendAbandonedCart({
          phone,
          customerName: name,
          checkoutUrl,
          productImageUrl,
          productName,
          cartTotal,
          itemCount,
          productHandle,
          cartId: cart.id
        });
      }

      if (!result.success) {
        return NextResponse.json({ error: result.error || "WhatsApp recovery send failed" }, { status: 500 });
      }

      return NextResponse.json({ success: true, channel: "whatsapp" });

    } else if (channel === "sms") {
      if (!phone) return NextResponse.json({ error: "No phone number available for this cart" }, { status: 400 });

      const text = messageBody || `Hi ${name}, you left items in your cart. Complete your purchase here: ${checkoutUrl}`;
      const result = await SmsService.sendSms(phone, text);

      if (!result || !result.sid) {
        return NextResponse.json({ error: "SMS recovery send failed" }, { status: 500 });
      }

      return NextResponse.json({ success: true, channel: "sms" });

    } else if (channel === "email") {
      if (!email) return NextResponse.json({ error: "No email address available for this cart" }, { status: 400 });

      const firstItem = cart.items?.[0] || {};
      const productImageUrl = firstItem.image || '';
      const productName = firstItem.title || '';
      const itemCount = cart.items?.length || 0;

      let contentHtml = "";
      if (messageBody) {
        contentHtml = messageBody.replace(/\n/g, "<br />");
      } else {
        contentHtml = `
          <p>Hi ${name},</p>
          <p>You left some beautiful pieces in your shopping bag. Complete your checkout now and make them yours!</p>
        `;
      }

      const hasRecoveryLink = messageBody && messageBody.includes(checkoutUrl);
      const buttonHtml = (!hasRecoveryLink) ? `
        <div style="margin: 30px 0; text-align: center;">
          <a href="${checkoutUrl}" style="background-color: #000000; color: #ffffff; padding: 15px 30px; text-decoration: none; font-size: 12px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; border-radius: 4px; display: inline-block;">
            Complete Purchase
          </a>
        </div>
      ` : "";

      const productHtml = productImageUrl ? `
        <div style="text-align: center; margin: 30px 0; padding: 20px; background-color: #fcfcfc; border: 1px solid #f0f0f0; border-radius: 8px;">
          <img src="${productImageUrl}" alt="${productName}" style="max-width: 180px; height: auto; border-radius: 6px; border: 1px solid #eaeaea;" />
          <h4 style="font-size: 13px; color: #111111; margin: 12px 0 4px 0; text-transform: uppercase; letter-spacing: 1px; font-weight: normal;">${productName}</h4>
          ${itemCount > 1 ? `<p style="font-size: 11px; color: #777777; margin: 0;">and ${itemCount - 1} other item${itemCount > 2 ? 's' : ''} in your bag</p>` : ''}
        </div>
      ` : '';

      const htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; border: 1px solid #f0f0f0; border-radius: 12px; background-color: #ffffff;">
          <h2 style="font-family: 'Playfair Display', Georgia, serif; font-size: 22px; letter-spacing: 4px; color: #000000; text-align: center; text-transform: uppercase; margin-bottom: 30px;">ZICA BELLA</h2>
          
          <div style="font-size: 14px; line-height: 1.6; color: #333333; margin-bottom: 25px;">
            ${contentHtml}
          </div>

          ${productHtml}
          ${buttonHtml}
          
          <p style="font-size: 11px; color: #999999; text-align: center; margin-top: 40px; border-top: 1px solid #f0f0f0; padding-top: 25px; line-height: 1.5;">
            Need help? Contact our concierge team.<br />
            &copy; ${new Date().getFullYear()} Zica Bella. All rights reserved.
          </p>
        </div>
      `;

      const subjectText = subject || "Complete your Zica Bella purchase";

      await sendMail({
        to: email,
        subject: subjectText,
        html: htmlBody
      });

      return NextResponse.json({ success: true, channel: "email" });

    } else {
      return NextResponse.json({ error: "Unsupported channel type" }, { status: 400 });
    }

  } catch (error: any) {
    console.error("Send recovery message error:", error);
    return NextResponse.json({ error: error.message || "Failed to send recovery message" }, { status: 500 });
  }
}
