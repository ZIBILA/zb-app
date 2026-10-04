import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { isOrderValidConverted } from "@/lib/cartValidation";
import { validConvertedOrderClause } from "@/lib/cartConversion";
import { buildCustomerIdentityOrClauses, areItemsIdentical } from "@/lib/cartCustomerMatch";

export const dynamic = "force-dynamic";

async function enrichCartsWithConversionData(carts: any[]) {
  if (!carts || carts.length === 0) {
    return { previousConversionMap: new Map<string, any>(), isRaceDuplicateMap: new Map<string, boolean>() };
  }

  const allOrClauses: any[] = [];
  for (const c of carts) {
    const clauses = buildCustomerIdentityOrClauses({
      customerId: c.customerId || c.customer?.id,
      email: c.email || c.customer?.email,
      phone: c.phone || c.customer?.phone,
      sessionToken: c.sessionToken,
    });
    allOrClauses.push(...clauses);
  }

  let convertedCarts: any[] = [];
  if (allOrClauses.length > 0) {
    convertedCarts = await prisma.cart.findMany({
      where: {
        ...validConvertedOrderClause,
        OR: allOrClauses,
      },
      include: {
        items: true,
        convertedOrder: {
          select: {
            id: true,
            internalOrderNumber: true,
            totalPrice: true,
            createdAt: true,
            status: true,
            paymentStatus: true,
            paymentMethod: true,
          }
        }
      },
      orderBy: { updatedAt: "desc" }
    });
  }

  const isRaceDuplicateMap = new Map<string, boolean>();
  const previousConversionMap = new Map<string, any>();

  for (const cart of carts) {
    const matchingConverted = convertedCarts.filter(conv => {
      if (conv.id === cart.id) return false;
      if (cart.customerId && conv.customerId === cart.customerId) return true;
      if (cart.email && conv.email && cart.email.trim().toLowerCase() === conv.email.trim().toLowerCase()) return true;
      if (cart.phone && conv.phone && cart.phone.trim() === conv.phone.trim()) return true;
      if (cart.sessionToken && conv.sessionToken && cart.sessionToken === conv.sessionToken) return true;
      return false;
    });

    if (matchingConverted.length > 0) {
      const latestConv = matchingConverted[0];
      const order = latestConv.convertedOrder;
      previousConversionMap.set(cart.id, {
        cartId: latestConv.id,
        orderId: order?.id || latestConv.convertedOrderId,
        internalOrderNumber: order?.internalOrderNumber || null,
        totalPrice: order?.totalPrice || latestConv.subtotal || 0,
        convertedAt: order?.createdAt || latestConv.updatedAt,
      });

      if (!cart.convertedOrderId && cart.status !== "converted") {
        const isDuplicate = matchingConverted.some(conv => {
          const convTime = new Date(conv.convertedOrder?.createdAt || conv.updatedAt).getTime();
          const cartTime = new Date(cart.createdAt).getTime();
          const diffMinutes = Math.abs(cartTime - convTime) / (1000 * 60);
          return diffMinutes <= 30 && areItemsIdentical(cart.items || [], conv.items || []);
        });
        isRaceDuplicateMap.set(cart.id, isDuplicate);
      } else {
        isRaceDuplicateMap.set(cart.id, false);
      }
    } else {
      previousConversionMap.set(cart.id, null);
      isRaceDuplicateMap.set(cart.id, false);
    }
  }

  return { previousConversionMap, isRaceDuplicateMap };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get("status") || "all"; // all, live, abandoned, converted, expired
    const sourceFilter = searchParams.get("source") || "all"; // all, webstore, app
    const searchQuery = searchParams.get("search") || "";
    const dateRange = searchParams.get("dateRange") || "all"; // all, today, yesterday, last7days, last30days, custom
    const customStartDate = searchParams.get("startDate");
    const customEndDate = searchParams.get("endDate");
    const followupFilter = searchParams.get("followup") || "all"; // all, today, tomorrow
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const skip = (page - 1) * limit;

    const [delay1Setting, delay2Setting, delay3Setting] = await Promise.all([
      prisma.whatsAppSetting.findFirst({ where: { key: "delay_abandoned_cart_step1" } }),
      prisma.whatsAppSetting.findFirst({ where: { key: "delay_abandoned_cart_step2" } }),
      prisma.whatsAppSetting.findFirst({ where: { key: "delay_abandoned_cart_step3" } })
    ]);
    const rawDelay1 = delay1Setting ? (parseInt(delay1Setting.value, 10) || 15) : 15;
    const delay1 = Math.max(rawDelay1, 15);
    const delay2 = delay2Setting ? (parseInt(delay2Setting.value, 10) || 1440) : 1440;
    const delay3 = delay3Setting ? (parseInt(delay3Setting.value, 10) || 10080) : 10080;
    const abandonmentThreshold = new Date(Date.now() - delay1 * 60 * 1000);

    // Calculate IST-aligned (UTC+5:30) date ranges
    const now = new Date();
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + IST_OFFSET_MS);

    const getUtcDayRange = (year: number, month: number, date: number) => {
      const start = new Date(Date.UTC(year, month, date, 0, 0, 0, 0) - IST_OFFSET_MS);
      const end = new Date(Date.UTC(year, month, date, 23, 59, 59, 999) - IST_OFFSET_MS);
      return { start, end };
    };

    const curY = istNow.getUTCFullYear();
    const curM = istNow.getUTCMonth();
    const curD = istNow.getUTCDate();

    const todayRange = getUtcDayRange(curY, curM, curD);
    const yesterdayRange = getUtcDayRange(curY, curM, curD - 1);
    const tomorrowRange = getUtcDayRange(curY, curM, curD + 1);

    const computeNextFollowup = (c: any) => {
      const phone = c.phone || c.customer?.phone;
      if (!phone || c.status === "converted" || c.status === "expired" || c.convertedOrderId) {
        return null;
      }
      const messages = c.whatsAppMessages || [];
      const sentStages = new Set(
        messages
          .filter((m: any) => m.recoveryStage && m.status !== "failed")
          .map((m: any) => m.recoveryStage)
      );

      const lastActivity = new Date(c.lastActivityAt || c.createdAt).getTime();
      let nextStage: number | null = null;
      let nextFollowupMs: number | null = null;
      let label = "";

      if (!sentStages.has(1)) {
        nextStage = 1;
        nextFollowupMs = lastActivity + delay1 * 60 * 1000;
        label = "Step 1 Reminder";
      } else if (!sentStages.has(2)) {
        nextStage = 2;
        nextFollowupMs = lastActivity + delay2 * 60 * 1000;
        label = "Step 2 (Discount)";
      } else if (!sentStages.has(3)) {
        nextStage = 3;
        nextFollowupMs = lastActivity + delay3 * 60 * 1000;
        label = "Step 3 (Final)";
      }

      if (!nextFollowupMs || !nextStage) return null;

      return {
        stage: nextStage,
        scheduledAt: new Date(nextFollowupMs).toISOString(),
        label,
        isOverdue: nextFollowupMs < Date.now()
      };
    };

    // Calculate upcoming follow-up metrics across active candidate abandoned carts
    const candidateCartsForFollowup = await prisma.cart.findMany({
      where: {
        items: { some: {} },
        status: { in: ["active", "abandoned"] },
        convertedOrderId: null,
        OR: [
          { phone: { not: null } },
          { customer: { phone: { not: null } } }
        ]
      },
      select: {
        id: true,
        lastActivityAt: true,
        createdAt: true,
        status: true,
        convertedOrderId: true,
        phone: true,
        customer: { select: { phone: true } },
        whatsAppMessages: {
          select: { recoveryStage: true, status: true }
        }
      }
    });

    let followupsTodayCount = 0;
    let followupsTomorrowCount = 0;
    const todayStartMs = todayRange.start.getTime();
    const todayEndMs = todayRange.end.getTime();
    const tomorrowStartMs = tomorrowRange.start.getTime();
    const tomorrowEndMs = tomorrowRange.end.getTime();

    const todayCartIds = new Set<string>();
    const tomorrowCartIds = new Set<string>();

    for (const c of candidateCartsForFollowup) {
      const nf = computeNextFollowup(c);
      if (nf) {
        const schedMs = new Date(nf.scheduledAt).getTime();
        if (schedMs >= todayStartMs && schedMs <= todayEndMs) {
          followupsTodayCount++;
          todayCartIds.add(c.id);
        } else if (schedMs >= tomorrowStartMs && schedMs <= tomorrowEndMs) {
          followupsTomorrowCount++;
          tomorrowCartIds.add(c.id);
        }
      }
    }

    const andClauses: any[] = [
      { items: { some: {} } },
      { status: { not: "merged" } }
    ];

    // Filter by date range
    if (dateRange === "today") {
      andClauses.push({ createdAt: { gte: todayRange.start, lte: todayRange.end } });
    } else if (dateRange === "yesterday") {
      andClauses.push({ createdAt: { gte: yesterdayRange.start, lte: yesterdayRange.end } });
    } else if (dateRange === "last7days") {
      const start7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      andClauses.push({ createdAt: { gte: start7 } });
    } else if (dateRange === "last30days") {
      const start30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      andClauses.push({ createdAt: { gte: start30 } });
    } else if (dateRange === "custom" && customStartDate) {
      const [sy, sm, sd] = customStartDate.split("-").map(Number);
      const start = new Date(Date.UTC(sy, sm - 1, sd, 0, 0, 0, 0) - IST_OFFSET_MS);
      let end = now;
      if (customEndDate) {
        const [ey, em, ed] = customEndDate.split("-").map(Number);
        end = new Date(Date.UTC(ey, em - 1, ed, 23, 59, 59, 999) - IST_OFFSET_MS);
      }
      andClauses.push({ createdAt: { gte: start, lte: end } });
    }

    // Filter by scheduled follow-up activity
    if (followupFilter === "today") {
      andClauses.push({ id: { in: Array.from(todayCartIds) } });
    } else if (followupFilter === "tomorrow") {
      andClauses.push({ id: { in: Array.from(tomorrowCartIds) } });
    }

    // Filter by source
    if (sourceFilter !== "all") {
      andClauses.push({ source: sourceFilter });
    }

    // Filter by status (using valid is: relation and scalar status filters)
    if (statusFilter === "live") {
      andClauses.push({
        status: "active",
        lastActivityAt: { gt: abandonmentThreshold },
        convertedOrderId: null
      });
    } else if (statusFilter === "abandoned") {
      andClauses.push({ convertedOrderId: null });
      andClauses.push({
        OR: [
          { status: "abandoned" },
          { status: "active", lastActivityAt: { lte: abandonmentThreshold } }
        ]
      });
    } else if (statusFilter === "converted") {
      andClauses.push(validConvertedOrderClause);
    } else if (statusFilter === "expired") {
      andClauses.push({
        status: "expired",
        convertedOrderId: null
      });
    }

    // Filter by search query (customer name, email, phone)
    if (searchQuery) {
      andClauses.push({
        OR: [
          { email: { contains: searchQuery, mode: "insensitive" } },
          { phone: { contains: searchQuery, mode: "insensitive" } },
          {
            customer: {
              OR: [
                { name: { contains: searchQuery, mode: "insensitive" } },
                { email: { contains: searchQuery, mode: "insensitive" } },
                { phone: { contains: searchQuery, mode: "insensitive" } }
              ]
            }
          }
        ]
      });
    }

    const where = { AND: andClauses };

    // Parallel fetch: Page of carts + KPI summary counts + total count (high performance)
    const [
      carts,
      liveCount,
      abandonedCount,
      convertedCount,
      expiredCount,
      convertedAggregate,
      rawTotal
    ] = await Promise.all([
      prisma.cart.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
              image: true,
            }
          },
          items: true,
          whatsAppMessages: {
            select: {
              recoveryStage: true,
              status: true,
              sentAt: true
            }
          },
          convertedOrder: {
            select: {
              id: true,
              internalOrderNumber: true,
              totalPrice: true,
              createdAt: true,
              status: true,
              paymentStatus: true,
              paymentMethod: true,
            }
          }
        },
        orderBy: {
          updatedAt: "desc"
        },
        skip,
        take: limit
      }),
      prisma.cart.count({
        where: {
          items: { some: {} },
          status: "active",
          lastActivityAt: { gt: abandonmentThreshold },
          convertedOrderId: null
        }
      }),
      prisma.cart.count({
        where: {
          items: { some: {} },
          convertedOrderId: null,
          OR: [
            { status: "abandoned" },
            { status: "active", lastActivityAt: { lte: abandonmentThreshold } }
          ]
        }
      }),
      prisma.cart.count({
        where: {
          items: { some: {} },
          ...validConvertedOrderClause
        }
      }),
      prisma.cart.count({
        where: {
          items: { some: {} },
          status: "expired",
          convertedOrderId: null
        }
      }),
      prisma.cart.aggregate({
        where: {
          items: { some: {} },
          ...validConvertedOrderClause
        },
        _sum: { subtotal: true }
      }),
      prisma.cart.count({ where })
    ]);

    // Enrich only the active page of carts (15-20 records) with repeat customer conversion context
    const { previousConversionMap, isRaceDuplicateMap } = await enrichCartsWithConversionData(carts);

    const convertedRevenue = Math.round(convertedAggregate._sum.subtotal || 0);
    const totalTracked = liveCount + abandonedCount + convertedCount + expiredCount;
    const recoveryRate = (abandonedCount + convertedCount) > 0
      ? Math.round((convertedCount / (abandonedCount + convertedCount)) * 100)
      : 0;

    // Process carts to map final computed status and attach conversion context
    const mappedCarts = carts
      .filter((cart: any) => {
        const isDuplicate = isRaceDuplicateMap.get(cart.id);
        if (isDuplicate && (statusFilter === "abandoned" || statusFilter === "all")) {
          return false;
        }
        return true;
      })
      .map((cart: any) => {
        const order = cart.convertedOrder;
        const isValidConverted = isOrderValidConverted(order);
        // Only treat as converted if status is explicitly 'converted' AND (no linked order OR linked order is valid)
        // A cart with convertedOrderId pointing to a failed/cancelled order should NOT be "converted"
        const isExplicitlyConverted = cart.status === "converted";
        const hasFailedLinkedOrder = Boolean(cart.convertedOrderId) && !isValidConverted && order;

        let computedStatus = cart.status;
        if (isValidConverted || (isExplicitlyConverted && !hasFailedLinkedOrder)) {
          computedStatus = "converted";
        } else if (hasFailedLinkedOrder) {
          // Cart was linked to a failed/cancelled order — treat as abandoned, not converted
          computedStatus = "abandoned";
        } else if (cart.status === "expired") {
          computedStatus = "expired";
        } else if (cart.lastActivityAt <= abandonmentThreshold || cart.status === "abandoned") {
          computedStatus = "abandoned";
        } else {
          computedStatus = "active";
        }

        // Recalculate subtotal from items for accuracy (prevents stale ₹ values)
        const recalcSubtotal = (cart.items && cart.items.length > 0)
          ? cart.items.reduce((sum: number, item: any) => sum + ((item.price || 0) * (item.quantity || 1)), 0)
          : 0;

        return {
          ...cart,
          convertedOrder: order || null,
          convertedOrderId: cart.convertedOrderId || (isValidConverted && order ? order.id : null),
          subtotal: recalcSubtotal || cart.subtotal || 0,
          computedStatus,
          nextFollowup: computeNextFollowup(cart),
          previousConversion: previousConversionMap.get(cart.id) || null
        };
      });

    // FIX 5: De-dupe displayed rows by identity so each customer appears at most once.
    // Uses the same identity key logic: customerId > phoneLast10 > email > cartId.
    // Note: cross-page identity de-dupe is bounded by FIX 1's write-time merge which
    // is the authoritative single-active-cart enforcement.
    const identityKeyForCart = (c: any): string => {
      if (c.customerId || c.customer?.id) return `cid:${c.customerId || c.customer?.id}`;
      const ph = c.phoneLast10 || (c.phone ? c.phone.replace(/\D/g, '').slice(-10) : null) ||
                 (c.customer?.phone ? c.customer.phone.replace(/\D/g, '').slice(-10) : null);
      if (ph && ph.length >= 10) return `ph:${ph}`;
      const em = c.email || c.customer?.email;
      if (em) return `em:${em.trim().toLowerCase()}`;
      return `cart:${c.id}`;
    };

    const seenIdentities = new Set<string>();
    const dedupedCarts = mappedCarts.filter((cart: any) => {
      const key = identityKeyForCart(cart);
      if (seenIdentities.has(key)) return false;
      seenIdentities.add(key);
      return true;
    });

    // KPI counts (liveCount, abandonedCount, convertedCount, expiredCount) remain row-level
    // from the DB. With FIX 1 enforcing single-active-cart at write time, these counts
    // already represent people (not duplicate rows). No further de-dupe on KPIs needed.
    // Adjust total to reflect identity de-dupe so pagination is accurate.
    const dedupeRemovedCount = mappedCarts.length - dedupedCarts.length;
    const total = Math.max(0, (statusFilter === "abandoned" ? abandonedCount : rawTotal) - dedupeRemovedCount);

    return NextResponse.json({
      carts: dedupedCarts,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1
      },
      stats: {
        totalTracked,
        liveCount,
        abandonedCount,
        convertedCount,
        expiredCount,
        convertedRevenue,
        recoveryRate,
        followupsTodayCount,
        followupsTomorrowCount
      }
    });
  } catch (error: any) {
    console.error("[Abandoned Carts Route] Error fetching carts:", error);
    return NextResponse.json({
      error: error.message || "Failed to fetch abandoned carts",
      carts: [],
      pagination: { total: 0, page: 1, limit: 20, totalPages: 1 },
      stats: {
        totalTracked: 0,
        liveCount: 0,
        abandonedCount: 0,
        convertedCount: 0,
        expiredCount: 0,
        convertedRevenue: 0,
        recoveryRate: 0
      }
    }, { status: 500 });
  }
}
