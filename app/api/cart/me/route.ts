import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/options";

export const dynamic = "force-dynamic";

import { checkRateLimit } from "@/lib/rate-limit";

/**
 * GET /api/cart/me
 * 
 * Returns the authenticated user's active cart from the database.
 * Optionally accepts ?recover=CART_ID to associate a recovered abandoned cart
 * with the logged-in customer.
 */
export async function GET(req: Request) {
  const rateLimitResult = await checkRateLimit(req, "cart-me", { maxRequests: 60, windowMs: 60_000 });
  if (!rateLimitResult.allowed && rateLimitResult.response) {
    return rateLimitResult.response;
  }

  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sessionUser = session.user as any;
    const userId = sessionUser.id;
    const userEmail = sessionUser.email;

    // Resolve customer ID from session
    const dbCustomer = await prisma.customer.findFirst({
      where: {
        OR: [
          ...(userId ? [{ id: userId }] : []),
          ...(userEmail ? [{ email: userEmail }] : []),
        ],
      },
    });

    if (!dbCustomer) {
      return NextResponse.json({ items: [], cartId: null });
    }

    const customerId = dbCustomer.id;
    const { searchParams } = new URL(req.url);
    const recoverId = searchParams.get("recover");

    // If a recovery cart ID is provided, associate it with this customer
    if (recoverId) {
      const recoveryCart = await prisma.cart.findUnique({
        where: { id: recoverId },
        include: { items: true },
      });

      // Refuse expired carts — they've passed the 30-day lifecycle
      if (recoveryCart && recoveryCart.status === "expired") {
        return NextResponse.json({ items: [], cartId: null, error: "Cart has expired" });
      }

      if (recoveryCart && recoveryCart.items.length > 0) {
        // Only associate if the cart has no owner, or already belongs to this customer
        if (!recoveryCart.customerId || recoveryCart.customerId === customerId) {
          // Associate the recovered cart with this customer
          if (!recoveryCart.customerId) {
            await prisma.cart.update({
              where: { id: recoverId },
              data: {
                customerId,
                status: "active",
                lastActivityAt: new Date(),
                phone: recoveryCart.phone || dbCustomer.phone || undefined,
                email: recoveryCart.email || dbCustomer.email || undefined,
              },
            });
          }

          // Deactivate any other active carts for this customer (avoid duplicates)
          await prisma.cart.updateMany({
            where: {
              customerId,
              status: "active",
              id: { not: recoverId },
            },
            data: { status: "merged" },
          });

          // Return the recovered cart items
          const items = recoveryCart.items.map((item: any) => ({
            id: `${item.productId}_${item.variantId || ""}_${item.size || "one-size"}`,
            productId: item.productId,
            variantId: item.variantId || "",
            handle: item.handle || "",
            title: item.title || "Product",
            price: String(item.price || 0),
            image: item.image || "",
            quantity: item.quantity || 1,
            size: item.size || null,
          }));

          return NextResponse.json({ items, cartId: recoverId, updatedAt: recoveryCart.lastActivityAt });
        }
      }
    }

    // Find the customer's active cart
    const activeCart = await prisma.cart.findFirst({
      where: { customerId, status: "active" },
      include: { items: true },
      orderBy: { lastActivityAt: "desc" },
    });

    if (!activeCart || activeCart.items.length === 0) {
      return NextResponse.json({
        items: [],
        cartId: activeCart?.id || null,
        updatedAt: activeCart?.lastActivityAt || null,
      });
    }

    const items = activeCart.items.map((item: any) => ({
      id: `${item.productId}_${item.variantId || ""}_${item.size || "one-size"}`,
      productId: item.productId,
      variantId: item.variantId || "",
      handle: item.handle || "",
      title: item.title || "Product",
      price: String(item.price || 0),
      image: item.image || "",
      quantity: item.quantity || 1,
      size: item.size || null,
    }));

    return NextResponse.json({ items, cartId: activeCart.id, updatedAt: activeCart.lastActivityAt });
  } catch (error: any) {
    console.error("Cart /me fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch cart", details: error.message },
      { status: 500 }
    );
  }
}
