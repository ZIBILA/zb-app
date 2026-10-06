import { NextResponse } from "next/server";
import prisma, { getPhoneLast10 } from "@/lib/db";
import { getClientIP, lookupIpGeo } from "@/lib/ip-geo";
import { getAppAuthFromRequest, resolveAuthCustomer } from "@/lib/appAuth";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/options";
import { buildCustomerIdentityOrClauses, areItemsIdentical } from "@/lib/cartCustomerMatch";

export const dynamic = "force-dynamic";

import { getCorsHeaders, handleCorsOptions } from "@/lib/cors";

export async function OPTIONS(req: Request) {
  return handleCorsOptions(req);
}

import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const rateLimitResult = await checkRateLimit(req, "cart-sync", { maxRequests: 60, windowMs: 60_000 });
  if (!rateLimitResult.allowed && rateLimitResult.response) {
    return rateLimitResult.response;
  }
  const corsHeaders = getCorsHeaders(req);
  try {
    const body = await req.json();
    const { 
      items, guestId, name, email, phone, source,
      city, state, zip, country, latitude, longitude 
    } = body;

    // ── IP Geolocation Fallback ──
    // If client didn't provide geo data (user denied/ignored location prompt),
    // derive city/state/country from IP. This ensures every cart record has
    // at least IP-level location for the abandoned carts admin page.
    let finalCity = city || null;
    let finalState = state || null;
    let finalZip = zip || null;
    let finalCountry = country || null;
    let finalLat = latitude !== undefined && latitude !== null ? parseFloat(String(latitude)) : null;
    let finalLng = longitude !== undefined && longitude !== null ? parseFloat(String(longitude)) : null;

    if (!city && !state && !country) {
      const ipGeo = await lookupIpGeo(getClientIP(req), req);
      if (ipGeo) {
        finalCity = ipGeo.city || null;
        finalState = ipGeo.region || null;
        finalCountry = ipGeo.country || null;
        finalLat = ipGeo.lat ?? null;
        finalLng = ipGeo.lng ?? null;
        // No zip from IP geo — leave as-is
      }
    }
    // 1. Resolve customer identity (Mobile Auth vs NextAuth Session vs Guest Email/Phone Match)
    const auth = getAppAuthFromRequest(req);
    const appCustomer = auth ? await resolveAuthCustomer(auth) : null;
    let customerId = appCustomer?.id;

    if (!customerId) {
      const session = await getServerSession(authOptions);
      if (session?.user) {
        const sessionUser = session.user as any;
        const userEmail = sessionUser.email;
        const userId = sessionUser.id;
        const dbCustomer = await prisma.customer.findFirst({
          where: {
            OR: [
              ...(userId ? [{ id: userId }] : []),
              ...(userEmail ? [{ email: userEmail }] : [])
            ]
          }
        });
        customerId = dbCustomer?.id;
      }
    }

    // Fallback: match customer by guest phone or email if provided
    if (!customerId && (phone || email)) {
      const dbCustomer = await prisma.customer.findFirst({
        where: {
          OR: [
            ...(email ? [{ email: { equals: String(email).trim(), mode: "insensitive" as const } }] : []),
            ...(phone ? [{ phone: String(phone).trim() }] : [])
          ]
        }
      });
      if (dbCustomer) customerId = dbCustomer.id;
    }

    // Resolve customer profile default phone and email if logged in
    let customerPhone = null;
    let customerEmail = null;
    if (customerId) {
      const dbCustomer = await prisma.customer.findUnique({
        where: { id: customerId }
      });
      if (dbCustomer) {
        customerPhone = dbCustomer.phone;
        customerEmail = dbCustomer.email;
      }
    }

    // ── Identity-Merge Step: enforce single canonical active cart per identity ──
    // Before find-or-create, load ALL live carts for this identity and merge
    // duplicates so exactly one active cart remains per person.
    const identityOr = buildCustomerIdentityOrClauses({
      customerId: customerId || null,
      email: email || customerEmail || null,
      phone: phone || customerPhone || null,
      sessionToken: guestId || null,
    });

    let mergedCanonicalCart: any = null;
    if (identityOr.length > 0) {
      const liveCarts = await prisma.cart.findMany({
        where: {
          status: { in: ["active", "abandoned"] },
          convertedOrderId: null,
          OR: identityOr,
        },
        orderBy: { lastActivityAt: "desc" },
        include: { items: true },
      });

      if (liveCarts.length > 0) {
        mergedCanonicalCart = liveCarts[0]; // newest activity = canonical

        // Mark all other live carts as merged
        const otherIds = liveCarts.slice(1).map((c: any) => c.id);
        if (otherIds.length > 0) {
          await prisma.cart.updateMany({
            where: { id: { in: otherIds } },
            data: {
              status: "merged",
              sessionToken: null,
              ...(customerId ? { customerId } : {}),
            },
          });
          console.log(`[Cart Sync] Merged ${otherIds.length} cart(s) → ${mergedCanonicalCart.id}`);
        }

        // Ensure canonical cart has latest identity fields
        if (customerId && mergedCanonicalCart.customerId !== customerId) {
          mergedCanonicalCart = await prisma.cart.update({
            where: { id: mergedCanonicalCart.id },
            data: { customerId },
          });
        }
      }
    }

    // 2. Find or create an active cart session
    let cart: any = mergedCanonicalCart;

    if (!cart && customerId) {
      // Find active cart for this customer
      cart = await prisma.cart.findFirst({
        where: { customerId: customerId, status: "active" }
      });

      // If customer has no active cart, but we have a guestId, try to associate the guest cart
      if (!cart && guestId) {
        const existingSession = await prisma.cart.findUnique({
          where: { sessionToken: guestId }
        });
        if (existingSession) {
          // 30-day guard: don't reactivate expired carts older than 30 days
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          const isReactivatable = (existingSession.status === "active" || existingSession.status === "abandoned") ||
            (existingSession.status === "expired" && existingSession.lastActivityAt > thirtyDaysAgo);

          if (isReactivatable) {
            cart = await prisma.cart.update({
              where: { id: existingSession.id },
              data: { customerId: customerId, status: "active", abandonedAt: null }
            });
          } else {
            // Converted, merged, or ancient expired cart: release sessionToken so new cart can be created
            await prisma.cart.update({
              where: { id: existingSession.id },
              data: { sessionToken: null }
            });
          }
        }
      } else if (cart && guestId) {
        // Customer has an active cart, and we also have a guestId.
        const guestCart = await prisma.cart.findUnique({
          where: { sessionToken: guestId }
        });
        if (guestCart && guestCart.id !== cart.id) {
          if (guestCart.status === "active") {
            await prisma.cart.update({
              where: { id: guestCart.id },
              data: { status: "merged", customerId: customerId, sessionToken: null }
            });
          } else if (guestCart.status === "converted" || guestCart.status === "merged") {
            await prisma.cart.update({
              where: { id: guestCart.id },
              data: { sessionToken: null }
            });
          }
        }
      }
    } else if (!cart && guestId) {
      // Find guest cart by sessionToken
      const existingSession = await prisma.cart.findUnique({
        where: { sessionToken: guestId }
      });
      if (existingSession) {
        // 30-day guard: don't reactivate expired carts older than 30 days
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const isReactivatable = (existingSession.status === "active" || existingSession.status === "abandoned") ||
          (existingSession.status === "expired" && existingSession.lastActivityAt > thirtyDaysAgo);

        if (isReactivatable) {
          cart = existingSession;
          if (existingSession.status !== "active") {
            await prisma.cart.update({
              where: { id: existingSession.id },
              data: { status: "active", abandonedAt: null }
            });
          }
        } else {
          // Previously converted, merged, or ancient expired cart: release sessionToken from old cart
          await prisma.cart.update({
            where: { id: existingSession.id },
            data: { sessionToken: null }
          });
        }
      }
    }

    const calculatedSubtotal = Array.isArray(items) 
      ? items.reduce((sum: number, item: any) => sum + (parseFloat(String(item.price || 0)) * (parseInt(String(item.quantity || 1)) || 1)), 0)
      : 0;

    const cartSource = source || (auth ? "app" : "webstore");

    if (!cart) {
      // Prevent post-checkout race condition duplicates: skip creation if converted recently (15 mins) with identical items
      const identityClauses = buildCustomerIdentityOrClauses({
        customerId: customerId || null,
        email: email || customerEmail || null,
        phone: phone || customerPhone || null,
        sessionToken: guestId || null,
      });

      if (identityClauses.length > 0) {
        const recentWindow = new Date(Date.now() - 15 * 60 * 1000);
        const recentConvertedCart = await prisma.cart.findFirst({
          where: {
            OR: [
              { status: "converted" },
              { convertedOrderId: { not: null } }
            ],
            updatedAt: { gte: recentWindow },
            AND: [{ OR: identityClauses }]
          },
          include: { items: true },
          orderBy: { updatedAt: "desc" }
        });

        if (recentConvertedCart && areItemsIdentical(items || [], recentConvertedCart.items || [])) {
          console.log(`[Cart Sync] Suppressing duplicate cart creation for recently converted cart ${recentConvertedCart.id}`);
          return NextResponse.json({ success: true, count: Array.isArray(items) ? items.length : 0, skippedDuplicateSync: true }, { headers: corsHeaders });
        }
      }

      // Create new cart session safely
      try {
        const cartPhone = phone || customerPhone || null;
        cart = await prisma.cart.create({
          data: {
            customerId: customerId || null,
            sessionToken: guestId || null,
            source: cartSource,
            status: "active",
            phone: cartPhone,
            phoneLast10: getPhoneLast10(cartPhone),
            email: email || customerEmail || null,
            subtotal: calculatedSubtotal,
            lastActivityAt: new Date(),
            city: finalCity,
            state: finalState,
            zip: finalZip,
            country: finalCountry,
            latitude: finalLat,
            longitude: finalLng,
          }
        });
      } catch (createErr: any) {
        // Concurrent syncs often race on session_token — adopt the winner instead of
        // clearing the token and creating again (which can race a second time).
        if (createErr?.code === 'P2002' && guestId) {
          const raced = await prisma.cart.findUnique({
            where: { sessionToken: guestId },
          });
          if (raced) {
            cart = raced;
          } else if (customerId) {
            cart = await prisma.cart.findFirst({
              where: { customerId, status: 'active' },
              orderBy: { updatedAt: 'desc' },
            });
          }
          if (!cart) throw createErr;
        } else {
          throw createErr;
        }
      }
    } else {
      // Update existing cart details
      const resolvedPhone = phone || customerPhone || cart.phone || undefined;
      const updateData: Record<string, any> = {
        updatedAt: new Date(),
        lastActivityAt: new Date(),
        subtotal: calculatedSubtotal,
        phone: resolvedPhone,
        phoneLast10: getPhoneLast10(resolvedPhone || null),
        email: email || customerEmail || cart.email || undefined,
        source: cartSource,
        status: cart.status === "converted" ? "converted" : "active",
        abandonedAt: cart.status === "converted" ? cart.abandonedAt : null,
      };

      // Ensure location fields are updated if new values are available or if cart previously missed them
      if (finalCity !== null && finalCity !== undefined) updateData.city = finalCity;
      else if (!cart.city && finalCity) updateData.city = finalCity;

      if (finalState !== null && finalState !== undefined) updateData.state = finalState;
      else if (!cart.state && finalState) updateData.state = finalState;

      if (finalZip !== null && finalZip !== undefined) updateData.zip = finalZip;
      else if (!cart.zip && finalZip) updateData.zip = finalZip;

      if (finalCountry !== null && finalCountry !== undefined) updateData.country = finalCountry;
      else if (!cart.country && finalCountry) updateData.country = finalCountry;

      if (finalLat !== null && finalLat !== undefined) updateData.latitude = finalLat;
      if (finalLng !== null && finalLng !== undefined) updateData.longitude = finalLng;

      cart = await prisma.cart.update({
        where: { id: cart.id },
        data: updateData,
      });
    }

    if (!Array.isArray(items)) {
      return NextResponse.json({ error: "Invalid items format" }, { status: 400, headers: corsHeaders });
    }

    let syncedCount = 0;

    // Replace all items atomically
    await prisma.$transaction(async (tx: any) => {
      await tx.cartItem.deleteMany({
        where: { cartId: cart.id },
      });

      if (items.length > 0) {
        const validItems = items.filter((item: any) => item && (item.productId || item.title || item.variantId || item.id));
        if (validItems.length > 0) {
          const result = await tx.cartItem.createMany({
            data: validItems.map((item: any) => ({
              cartId: cart.id,
              productId: item.productId ? String(item.productId) : String(item.id || item.variantId || Math.random()),
              variantId: item.variantId ? String(item.variantId) : null,
              handle: item.handle || null,
              title: item.title || "Product",
              price: parseFloat(String(item.price)) || 0,
              image: item.image || null,
              quantity: parseInt(String(item.quantity)) || 1,
              size: item.size || null,
            })),
          });
          syncedCount = result.count;
        }
      }

      // Reset subtotal to 0 when cart is emptied so abandoned carts admin
      // page doesn't display stale ₹ values for empty carts.
      if (syncedCount === 0) {
        await tx.cart.update({
          where: { id: cart.id },
          data: { subtotal: 0 },
        });
      }
    });

    return NextResponse.json({ success: true, count: syncedCount }, { headers: corsHeaders });
  } catch (error: any) {
    console.error("Cart sync error:", error?.code || error?.message || "error");
    return NextResponse.json({ error: "Failed to sync cart", details: error.message }, { status: 500, headers: corsHeaders });
  }
}

