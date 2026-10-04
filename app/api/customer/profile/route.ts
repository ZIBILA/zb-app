import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/options";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sessionUserId = (session.user as any)?.id || (session as any)?.customer?.id || null;
    const sessionEmail = session.user?.email ? session.user.email.trim().toLowerCase() : null;
    const sessionPhone = (session.user as any)?.phone ? String((session.user as any).phone).trim() : null;
    const phoneDigits = sessionPhone ? sessionPhone.replace(/\D/g, '') : null;
    const phoneLast10 = phoneDigits && phoneDigits.length >= 10 ? phoneDigits.slice(-10) : null;

    const customerWhereClauses: any[] = [];
    if (sessionUserId) customerWhereClauses.push({ id: sessionUserId });
    if (sessionEmail) customerWhereClauses.push({ email: sessionEmail });
    if (sessionPhone) {
      customerWhereClauses.push({ phone: sessionPhone });
      if (phoneDigits && phoneDigits !== sessionPhone) {
        customerWhereClauses.push({ phone: phoneDigits });
      }
    }
    if (phoneLast10) {
      customerWhereClauses.push({ phoneLast10: phoneLast10 });
      customerWhereClauses.push({ phone: { contains: phoneLast10 } });
    }

    if (customerWhereClauses.length === 0) {
      return NextResponse.json({ error: "No valid user identifier" }, { status: 400 });
    }

    const matchingCustomers = await prisma.customer.findMany({
      where: { OR: customerWhereClauses },
      include: {
        communityMember: true
      }
    });

    let customer = matchingCustomers.find((c: any) => c.id === sessionUserId) || matchingCustomers[0] || null;

    // If customer has no name or orders, try a quick sync from Shopify
    if (customer && (!customer.name || customer.name === 'New User') && customer.phone) {
      try {
        const { searchCustomerByPhone } = await import('@/lib/shopify-admin');
        const shopifyCustomer = await searchCustomerByPhone(customer.phone);
        if (shopifyCustomer) {
          customer = await prisma.customer.update({
            where: { id: customer.id },
            data: {
              name: `${shopifyCustomer.first_name || ""} ${shopifyCustomer.last_name || ""}`.trim() || undefined,
              email: shopifyCustomer.email || undefined,
              ordersCount: shopifyCustomer.orders_count,
              totalSpent: parseFloat(shopifyCustomer.total_spent || "0"),
            },
            include: {
              communityMember: true
            }
          });
        }
      } catch (e) {
        console.error("Profile sync-on-get error:", e);
      }
    }

    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    // Only verified Customer row ids (never raw session ids that may not exist in Customer)
    const customerIds = Array.from(new Set([
      ...matchingCustomers.map((c: any) => c.id),
      customer.id
    ])).filter(Boolean);

    const customerEmails = Array.from(new Set([
      ...(sessionEmail ? [sessionEmail] : []),
      ...matchingCustomers.map((c: any) => c.email).filter(Boolean) as string[],
      ...(customer.email ? [customer.email] : [])
    ]));

    const customerPhones = Array.from(new Set([
      ...(sessionPhone ? [sessionPhone] : []),
      ...matchingCustomers.map((c: any) => c.phone).filter(Boolean) as string[],
      ...(customer.phone ? [customer.phone] : [])
    ]));

    const customerPhoneLast10s = Array.from(new Set([
      ...(phoneLast10 ? [phoneLast10] : []),
      ...matchingCustomers.map((c: any) => c.phoneLast10).filter(Boolean) as string[],
      ...(customer.phoneLast10 ? [customer.phoneLast10] : [])
    ]));

    // Query master orders with broad identity matching (capturing guest and past checkouts)
    const masterOrClauses: any[] = [];
    if (customerIds.length > 0) masterOrClauses.push({ customerId: { in: customerIds } });
    if (customerEmails.length > 0) masterOrClauses.push({ customer: { email: { in: customerEmails } } });
    if (customerPhones.length > 0) masterOrClauses.push({ customer: { phone: { in: customerPhones } } });
    if (customerPhoneLast10s.length > 0) masterOrClauses.push({ customer: { phoneLast10: { in: customerPhoneLast10s } } });

    const customerOrders = masterOrClauses.length > 0 ? await prisma.order.findMany({
      where: {
        OR: masterOrClauses,
        NOT: {
          OR: [
            {
              AND: [
                { internalOrderNumber: { startsWith: 'ZBPP' } },
                { paymentStatus: { notIn: ['paid', 'partially_paid', 'cod_upfront_paid', 'PAID'] } },
              ],
            },
            {
              AND: [
                { internalOrderNumber: { startsWith: 'ZBPF' } },
                { paymentStatus: { notIn: ['paid', 'partially_paid', 'cod_upfront_paid', 'PAID'] } },
              ],
            },
            { paymentStatus: { in: ['failed', 'FAILED', 'voided'] } },
            { status: { in: ['payment_failed', 'failed', 'FAILED', 'payment_pending'] } }
          ]
        }
      },
      include: {
        items: {
          include: {
            product: true
          }
        },
        shipments: true
      },
      orderBy: { createdAt: "desc" }
    }) : [];

    // Auto-link orphaned orders onto the resolved Customer row (FK-safe)
    const orphanedOrderIds = customerOrders
      .filter((o: any) => o.customerId && o.customerId !== customer.id)
      .map((o: any) => o.id);
    if (orphanedOrderIds.length > 0) {
      prisma.order.updateMany({
        where: { id: { in: orphanedOrderIds } },
        data: { customerId: customer.id }
      }).catch((err: any) => console.error("[Profile] Auto-link failed:", err?.code || err?.message));
    }

    const orderIds = customerOrders.map((o: any) => o.id);

    // Load active and historic return & exchange requests for the customer
    const returnRequests = await prisma.returnRequest.findMany({
      where: {
        OR: [
          { customerId: { in: customerIds } },
          ...(orderIds.length > 0 ? [{ orderId: { in: orderIds } }] : [])
        ]
      },
      include: {
        order: {
          include: {
            items: {
              include: {
                product: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    const exchangeRequests = await prisma.exchangeRequest.findMany({
      where: {
        OR: [
          { customerId: { in: customerIds } },
          ...(orderIds.length > 0 ? [{ orderId: { in: orderIds } }] : [])
        ]
      },
      include: {
        order: {
          include: {
            items: {
              include: {
                product: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    // Helper to find matching WebStoreOrder and get proper sequence order number (#ZB40001)
    async function enrichOrderNumber(orderObj: any) {
      if (!orderObj) return null;
      let webStoreOrder = null;
      if (orderObj.razorpayOrderId) {
        webStoreOrder = await prisma.webStoreOrder.findFirst({
          where: { razorpayOrderId: orderObj.razorpayOrderId }
        });
      }
      if (!webStoreOrder) {
        webStoreOrder = await prisma.webStoreOrder.findFirst({
          where: {
            notes: {
              contains: `Local: ${orderObj.id}`
            }
          }
        });
      }
      if (!webStoreOrder && orderObj.shopifyOrderId) {
        webStoreOrder = await prisma.webStoreOrder.findFirst({
          where: {
            notes: {
              contains: `Shopify: ${orderObj.shopifyOrderId}`
            }
          }
        });
      }
      return orderObj.internalOrderNumber || webStoreOrder?.orderNumber || (orderObj.shopifyOrderId && !orderObj.shopifyOrderId.startsWith('app_pending_') ? orderObj.shopifyOrderId : `#ZB${orderObj.id.slice(-5).toUpperCase()}`);
    }

    // Enrich all customer orders
    const enrichedOrders = await Promise.all(
      (customerOrders || []).map(async (o: any) => {
        const orderNumber = await enrichOrderNumber(o);
        return { ...o, orderNumber };
      })
    );

    // Enrich return requests orders
    const enrichedReturnRequests = await Promise.all(
      returnRequests.map(async (req: any) => {
        const orderNumber = await enrichOrderNumber(req.order);
        return {
          ...req,
          order: {
            ...req.order,
            orderNumber
          }
        };
      })
    );

    // Enrich exchange requests orders
    const enrichedExchangeRequests = await Promise.all(
      exchangeRequests.map(async (req: any) => {
        const orderNumber = await enrichOrderNumber(req.order);
        return {
          ...req,
          order: {
            ...req.order,
            orderNumber
          }
        };
      })
    );

    const finalCustomer = {
      ...customer,
      orders: enrichedOrders,
      returnRequests: enrichedReturnRequests,
      exchangeRequests: enrichedExchangeRequests
    };

    return NextResponse.json({ customer: finalCustomer });
  } catch (error: any) {
    console.error("Fetch Profile Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { name, email, phone, region, image, storeCreditPreference, emailOptedOut, whatsappOptedOut, smsOptedOut } = body;

    const sessionUserId = (session.user as any)?.id || (session as any)?.customer?.id || null;
    const sessionEmail = session.user?.email ? session.user.email.trim().toLowerCase() : null;
    const sessionPhone = (session.user as any)?.phone ? String((session.user as any).phone).trim() : null;
    const phoneDigits = sessionPhone ? sessionPhone.replace(/\D/g, '') : null;
    const phoneLast10 = phoneDigits && phoneDigits.length >= 10 ? phoneDigits.slice(-10) : null;

    const customerWhereClauses: any[] = [];
    if (sessionUserId) customerWhereClauses.push({ id: sessionUserId });
    if (sessionEmail) customerWhereClauses.push({ email: sessionEmail });
    if (sessionPhone) {
      customerWhereClauses.push({ phone: sessionPhone });
      if (phoneDigits && phoneDigits !== sessionPhone) {
        customerWhereClauses.push({ phone: phoneDigits });
      }
    }
    if (phoneLast10) {
      customerWhereClauses.push({ phoneLast10: phoneLast10 });
      customerWhereClauses.push({ phone: { contains: phoneLast10 } });
    }

    if (customerWhereClauses.length === 0) {
      return NextResponse.json({ error: "No valid user identifier" }, { status: 400 });
    }

    const customer = await prisma.customer.findFirst({
      where: { OR: customerWhereClauses }
    });

    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const cleanEmail = email !== undefined && email !== null ? String(email).trim().toLowerCase() : undefined;
    const cleanPhone = phone !== undefined && phone !== null ? String(phone).trim() : undefined;

    if ((cleanEmail && cleanEmail !== customer.email) || (cleanPhone && cleanPhone !== customer.phone)) {
      const phoneDigits = cleanPhone ? cleanPhone.replace(/\D/g, '').slice(-10) : '';
      const existingOther = await prisma.customer.findFirst({
        where: {
          id: { not: customer.id },
          OR: [
            ...(cleanEmail ? [{ email: cleanEmail }] : []),
            ...(phoneDigits.length === 10 ? [{ phone: { contains: phoneDigits } }] : []),
          ]
        }
      });
      if (existingOther) {
        return NextResponse.json({ error: "An account with this email or phone number already exists." }, { status: 400 });
      }
    }

    const updatedCustomer = await prisma.customer.update({
      where: { id: customer.id },
      data: {
        name: name !== undefined ? String(name).trim() : undefined,
        email: cleanEmail !== undefined ? cleanEmail : undefined,
        phone: cleanPhone !== undefined ? cleanPhone : undefined,
        region: region !== undefined ? region : undefined,
        image: image !== undefined ? image : undefined,
        storeCreditPreference: storeCreditPreference !== undefined ? storeCreditPreference : undefined,
        emailOptedOut: emailOptedOut !== undefined ? emailOptedOut : undefined,
        whatsappOptedOut: whatsappOptedOut !== undefined ? whatsappOptedOut : undefined,
        smsOptedOut: smsOptedOut !== undefined ? smsOptedOut : undefined,
      }
    });

    return NextResponse.json({ customer: updatedCustomer });
  } catch (error: any) {
    console.error("Update Profile Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
