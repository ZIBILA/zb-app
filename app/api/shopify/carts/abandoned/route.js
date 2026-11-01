import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { formatPhone } from '@/lib/whatsapp/client';
import { storefrontUrl } from '@/lib/storefront-url';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    
    // Fetch active carts that have been idle for > 30 minutes, or explicitly abandoned
    let localCarts = [];
    try {
      localCarts = await prisma.cart.findMany({
        where: {
          items: { some: {} },
          convertedOrderId: null,
          status: { notIn: ['converted', 'merged'] },
          OR: [
            { status: 'abandoned' },
            { status: 'active', lastActivityAt: { lte: thirtyMinutesAgo } }
          ]
        },
        include: {
          customer: {
            select: {
              name: true,
              phone: true
            }
          },
          items: true
        },
        orderBy: {
          lastActivityAt: 'desc'
        },
        take: 50
      });
    } catch (apiErr) {
      console.warn('[First Party Carts API] Fetch failed:', apiErr.message);
    }

    // Cross reference with local whatsapp_messages database to count how many recovery messages are sent per phone number
    const recoveryCounts = {};
    try {
      const logs = await prisma.whatsAppMessage.findMany({
        where: {
          templateName: { in: ['abandoned_cart_a1', 'abandoned_cart_a2', 'abandoned_cart_a3', 'zica_cart_recovery_v1', 'zb_cart_followup', 'zb_cart_final'] }
        },
        select: { phoneNumber: true }
      });
      if (logs && Array.isArray(logs)) {
        logs.forEach(l => {
          if (l.phoneNumber) {
            recoveryCounts[l.phoneNumber] = (recoveryCounts[l.phoneNumber] || 0) + 1;
          }
        });
      }
    } catch (dbErr) {
      console.warn('[First Party Carts API] Failed to fetch recovery counts:', dbErr.message);
    }

    const carts = localCarts.map(c => {
      const phone = c.phone || c.customer?.phone || '';
      const formatted = phone ? formatPhone(phone) : '';
      const count = formatted ? (recoveryCounts[formatted] || 0) : 0;
      const recovery_step = count === 0 ? 'pending' : count === 1 ? 'step1_sent' : count === 2 ? 'step2_sent' : 'final_sent';
      const isSent = count > 0;

      const itemsList = c.items
        ?.map(item => `${item.title} (x${item.quantity || 1})`)
        .join(', ') || 'Cart Items';

      return {
        id: c.id,
        customer: c.customer?.name || 'Guest Customer',
        phone: phone,
        cart_value: `₹${parseFloat(c.subtotal || 0).toLocaleString('en-IN')}`,
        items: itemsList,
        itemsRaw: c.items.map(item => ({
          title: item.title,
          image: item.image,
          quantity: item.quantity,
          price: item.price
        })),
        productImageUrl: c.items[0]?.image || '',
        abandoned_at: c.lastActivityAt,
        status: isSent ? 'sent' : 'pending',
        recovery_step,
        abandoned_checkout_url: storefrontUrl(`/cart?recover=${c.id}`)
      };
    });

    return NextResponse.json({ carts });
  } catch (error) {
    console.error('[First Party Carts API] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}


