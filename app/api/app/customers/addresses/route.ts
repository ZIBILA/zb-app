import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const phone = url.searchParams.get('phone')?.trim();
    const email = url.searchParams.get('email')?.trim();

    if (!phone && !email) {
      return NextResponse.json(
        { addresses: [], error: 'phone or email query parameter required' },
        { status: 400, headers: corsHeaders }
      );
    }

    const where: any = { OR: [] };
    if (phone) where.OR.push({ phone });
    if (email) where.OR.push({ email });

    const customer = await prisma.customer.findFirst({
      where,
      include: { addresses: { orderBy: { updatedAt: 'desc' } } },
    });

    if (!customer) {
      return NextResponse.json({ addresses: [] }, { headers: corsHeaders });
    }

    return NextResponse.json({ addresses: customer.addresses }, { headers: corsHeaders });
  } catch (e: any) {
    console.error('[App API] Customer addresses GET error:', e.message);
    return NextResponse.json(
      { addresses: [], error: e.message },
      { status: 500, headers: corsHeaders }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { phone, email, address } = body;

    if (!phone && !email) {
      return NextResponse.json(
        { error: 'phone or email required' },
        { status: 400, headers: corsHeaders }
      );
    }

    if (!address) {
      return NextResponse.json(
        { error: 'address data required' },
        { status: 400, headers: corsHeaders }
      );
    }

    // 1. Find or create the customer
    const where: any = { OR: [] };
    if (phone) where.OR.push({ phone });
    if (email) where.OR.push({ email });

    let customer = await prisma.customer.findFirst({ where });

    if (!customer) {
      // Create a minimal customer record if they don't exist
      // We'll use a placeholder shopId if none provided, or look for the first shop
      const shop = await prisma.shop.findFirst();
      if (!shop) throw new Error('No shop configured');

      customer = await prisma.customer.create({
        data: {
          shopifyId: `mobile_${Date.now()}`,
          shopId: shop.id,
          email: email || null,
          phone: phone || null,
          name: address.name || 'Mobile User',
        },
      });
    }

    // 2. Create the new address
    // Unset previous defaults for this customer if the new one is default
    await prisma.address.updateMany({
      where: { customerId: customer.id, isDefault: true },
      data: { isDefault: false },
    });

    const resolvedAddress1 = address.address1 || [address.flat, address.street || address.line1].filter(Boolean).join(', ') || address.line1 || '';
    const newAddress = await prisma.address.create({
      data: {
        customerId: customer.id,
        name: address.name,
        phone: address.phone || customer.phone,
        email: address.email || customer.email,
        address1: resolvedAddress1,
        address2: address.address2 || address.line2 || null,
        city: address.city,
        state: address.state,
        zip: address.zip || address.pincode || '',
        country: address.country || 'India',
        isDefault: true,
      },
    });

    // 3. Update customer's defaultAddress string for backward compatibility
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        defaultAddress: JSON.stringify(newAddress),
        // Update customer profile info if it was missing
        name: (!customer.name || customer.name === 'Mobile User') ? address.name : customer.name,
        email: customer.email || address.email,
        phone: customer.phone || address.phone,
      },
    });

    return NextResponse.json({ success: true, address: newAddress }, { headers: corsHeaders });
  } catch (e: any) {
    console.error('[App API] Customer addresses POST error:', e.message);
    return NextResponse.json(
      { error: e.message },
      { status: 500, headers: corsHeaders }
    );
  }
}

