import { NextResponse, NextRequest } from "next/server";
import Razorpay from "razorpay";
import prisma from "@/lib/db";
import { assignFailedOrderNumber } from "@/lib/orderNumber";

import { isOrderValidConverted } from "@/lib/cartValidation";
import { recordMetaPurchaseContext, metaContextFromRequest } from "@/lib/meta/purchase-server";
import { normalizeVariantId } from "@/lib/snap/catalog-id";

export const dynamic = "force-dynamic";

function getRazorpayInstance(keyId?: string, keySecret?: string): Razorpay | null {
  const id = keyId || process.env.RAZORPAY_KEY_ID;
  const secret = keySecret || process.env.RAZORPAY_KEY_SECRET;
  if (id && secret) {
    return new Razorpay({ key_id: id, key_secret: secret });
  }
  return null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { cartId: string } }
) {
  const { cartId } = params;

  try {
    // 1. Fetch the cart
    const cart = await prisma.cart.findUnique({
      where: { id: cartId },
      include: {
        customer: true,
        items: true,
      },
    });

    if (!cart) {
      return NextResponse.json({ error: "Cart not found" }, { status: 404 });
    }

    if (cart.items.length === 0) {
      return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    }

    // 2. Fetch the Shop for credentials
    const shop = await prisma.shop.findFirst();
    if (!shop) {
      return NextResponse.json({ error: "Shop not configured" }, { status: 500 });
    }

    // 3. Check if already converted and redirect to success if valid
    if (cart.status === "converted" && cart.convertedOrderId) {
      const convertedOrder = await prisma.order.findUnique({
        where: { id: cart.convertedOrderId }
      });
      if (convertedOrder && isOrderValidConverted(convertedOrder)) {
        return NextResponse.redirect(new URL(`/checkout/success?order_id=${cart.convertedOrderId}`, req.url));
      }
    }

    // 4. Resolve/Find customer
    let localCustomer = cart.customer;
    if (!localCustomer) {
      const phone = cart.phone || "";
      const email = cart.email || "";
      localCustomer = await prisma.customer.findFirst({
        where: {
          OR: [
            ...(email ? [{ email }] : []),
            ...(phone ? [{ phone }] : []),
          ],
        },
      });

      if (!localCustomer) {
        localCustomer = await prisma.customer.create({
          data: {
            email: email || `guest_${Date.now()}@zicabella.in`,
            phone: phone || "",
            name: "WhatsApp Customer",
            shopId: shop.id,
            shopifyId: `temp_wa_${Date.now()}`,
          },
        });
      }

      // Link customer to cart
      await prisma.cart.update({
        where: { id: cart.id },
        data: { customerId: localCustomer.id },
      });
    }

    // 5. Check if we already created a pending order for this cart
    let pendingOrder = await prisma.order.findFirst({
      where: {
        customerId: localCustomer.id,
        status: "open",
        paymentStatus: "pending",
        tags: { contains: `cart-${cart.id}` },
      },
    });

    // Resolve Razorpay keys
    const rzKeyId = shop.razorpayKeyId || process.env.RAZORPAY_KEY_ID;
    const rzKeySecret = shop.razorpayKeySecret || process.env.RAZORPAY_KEY_SECRET;
    const rzInstance = getRazorpayInstance(rzKeyId, rzKeySecret);

    if (!rzInstance) {
      return NextResponse.json({ error: "Razorpay credentials not configured" }, { status: 500 });
    }

    let paymentLinkUrl = "";

    if (pendingOrder && pendingOrder.razorpayOrderId) {
      // Re-opened link: refresh the click context from this visit (see below).
      recordMetaPurchaseContext(pendingOrder.id, metaContextFromRequest(req)).catch(() => {});
      try {
        const link = await (rzInstance as any).paymentLink.create({
          amount: Math.round(cart.subtotal * 100),
          currency: "INR",
          accept_partial: false,
          description: `Order Payment for Cart Recovery #${cartId}`,
          customer: {
            name: localCustomer.name || "Customer",
            email: localCustomer.email || undefined,
            contact: localCustomer.phone || undefined,
          },
          notify: { sms: false, email: false },
          reminder_enable: true,
          notes: {
            cart_id: cart.id,
            order_id: pendingOrder.id,
          },
          options: {
            checkout: {
              shipping_address: {
                collect: true,
              },
            } as any,
          },
          callback_url: `${new URL(req.url).origin}/checkout/success?order_id=${pendingOrder.id}`,
          callback_method: "get",
        });
        paymentLinkUrl = (link as any).short_url;
      } catch (err: any) {
        console.error("[Pay Route] Failed to recreate payment link:", err.message);
      }
    }

    if (!paymentLinkUrl) {
      // Generate a pending order number (real ZB number assigned at payment success)
      let universalOrderNumber = '';
      try {
        universalOrderNumber = await assignFailedOrderNumber(prisma, { cause: 'pending' });
      } catch (seqErr: any) {
        universalOrderNumber = `ZBPP${Date.now().toString().slice(-8)}`;
      }

      // Create a Razorpay Order first
      const rzOrder = await rzInstance.orders.create({
        amount: Math.round(cart.subtotal * 100),
        currency: "INR",
        receipt: `receipt_${universalOrderNumber}`,
        notes: {
          cart_id: cart.id,
        },
      });

      // Create the pending order locally
      pendingOrder = await prisma.order.create({
        data: {
          shopId: shop.id,
          customerId: localCustomer.id,
          status: "open",
          totalPrice: cart.subtotal,
          subtotalPrice: cart.subtotal,
          paymentStatus: "pending",
          fulfillmentStatus: "unfulfilled",
          deliveryStatus: "pending",
          razorpayOrderId: rzOrder.id,
          paymentMethod: "razorpay",
          orderType: "WEB_STORE",
          tags: `WebStoreOrder, Web, Razorpay, CartRecovery, cart-${cart.id}, zb-order-${universalOrderNumber}`,
          internalOrderNumber: universalOrderNumber,
          shopifySyncStatus: 'pending',
          shopifySyncError: 'Pending payment confirmation',
          items: {
            create: cart.items.map((item: any) => ({
              shopifyLineItemId: `web_recovery_${cart.id}_${item.id}`,
              productId: item.productId,
              title: item.title || "",
              quantity: item.quantity,
              price: item.price || 0,
              sku: item.variantId || item.productId || null,
              // Catalog id for the ad-platform Purchase (feed.xml g:id = variant id).
              variantId: normalizeVariantId(item.variantId),
              image: item.image,
            })),
          },
        },
      });

      // The shopper opened this link in their own browser: record their click
      // context now, so the Purchase the Razorpay webhook sends later carries a
      // real user agent / IP / fbp / fbc (Meta rejects website events without
      // client_user_agent). Never throws.
      recordMetaPurchaseContext(pendingOrder.id, metaContextFromRequest(req)).catch(() => {});

      // Create the Razorpay Payment Link linked to the Razorpay Order ID
      const link = await (rzInstance as any).paymentLink.create({
        amount: Math.round(cart.subtotal * 100),
        currency: "INR",
        accept_partial: false,
        description: `Order Payment for Cart Recovery #${cartId}`,
        customer: {
          name: localCustomer.name || "Customer",
          email: localCustomer.email || undefined,
          contact: localCustomer.phone || undefined,
        },
        notify: { sms: false, email: false },
        reminder_enable: true,
        notes: {
          cart_id: cart.id,
          order_id: pendingOrder.id,
        },
        options: {
          checkout: {
            shipping_address: {
              collect: true,
            },
          } as any,
        },
        callback_url: `${new URL(req.url).origin}/checkout/success?order_id=${pendingOrder.id}`,
        callback_method: "get",
      });

      paymentLinkUrl = (link as any).short_url;
    }

    return NextResponse.redirect(paymentLinkUrl);
  } catch (error: any) {
    console.error("[Pay Route] Error generating payment link redirect:", error);
    return NextResponse.json({ error: error.message || "Failed to generate payment redirect" }, { status: 500 });
  }
}
