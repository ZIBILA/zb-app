/**
 * WhatsApp Recipients Audience Segment Fetch Endpoint
 * Location: app/api/whatsapp/recipients/route.js
 */

import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { isCampaignEligible } from '../broadcast/helper';
import { formatPhone } from '@/lib/whatsapp/client';
import { shopifyFetch } from '@/lib/shopify-admin';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const audience = searchParams.get('audience') || 'all_customers';

    let customers = [];

    if (audience === 'all_customers' || audience === 'all') {
      customers = await prisma.customer.findMany({
        where: { phone: { not: null } }
      });
    } else if (audience === 'new_customers' || audience === 'new') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      customers = await prisma.customer.findMany({
        where: {
          phone: { not: null },
          OR: [
            { createdAt: { gte: thirtyDaysAgo } },
            { ordersCount: 0 }
          ]
        }
      });
    } else if (audience === 'returning_customers' || audience === 'with_orders' || audience === 'returning') {
      customers = await prisma.customer.findMany({
        where: {
          phone: { not: null },
          ordersCount: { gte: 1 }
        }
      });
    } else if (audience === 'high_value_customers' || audience === 'high_value') {
      customers = await prisma.customer.findMany({
        where: {
          phone: { not: null },
          OR: [
            { totalSpent: { gte: 5000 } },
            { ordersCount: { gte: 2 } }
          ]
        }
      });
    } else if (audience === 'without_orders') {
      customers = await prisma.customer.findMany({
        where: {
          phone: { not: null },
          ordersCount: 0
        }
      });
    } else if (audience === 'wishlist' || audience === 'wishlist_customers') {
      customers = await prisma.customer.findMany({
        where: {
          phone: { not: null },
          wishlist: { some: {} }
        }
      });
    } else if (audience === 'cart_abandonment' || audience === 'abandoned_cart_customers') {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

      // Fetch local active-and-idle or explicitly abandoned carts from DB
      const localCarts = await prisma.cart.findMany({
        where: {
          items: { some: {} },
          OR: [
            { status: 'abandoned' },
            { status: 'active', lastActivityAt: { lte: thirtyMinutesAgo } }
          ]
        },
        include: { customer: true }
      });

      const combinedPhones = new Set();
      const combinedCustomers = [];

      for (const cart of localCarts) {
        const phone = cart.phone || cart.customer?.phone;
        if (phone) {
          const formatted = formatPhone(phone);
          if (formatted && !combinedPhones.has(formatted)) {
            combinedPhones.add(formatted);
            combinedCustomers.push({
              id: cart.id,
              name: cart.customer?.name || 'Guest Customer',
              phone: phone
            });
          }
        }
      }

      customers = combinedCustomers;
    }

    // Map and filter by marketing opt-in consent
    const recipients = [];
    const seenPhones = new Set();
    for (const c of customers) {
      const rawPhone = c.phone;
      if (!rawPhone) continue;

      const formatted = formatPhone(rawPhone);
      if (!formatted || formatted.length < 10 || seenPhones.has(formatted)) continue;
      seenPhones.add(formatted);

      // Check consent
      const consented = await isCampaignEligible(formatted);
      if (consented) {
        recipients.push({
          phone: formatted,
          customerName: c.name || c.customerName || 'there'
        });
      }
    }

    return NextResponse.json({ recipients });
  } catch (error) {
    console.error('[WhatsApp Recipients API] Error fetching opted-in customers:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
