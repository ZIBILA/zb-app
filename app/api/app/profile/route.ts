import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { requireAppAuth, handleAppAuthError } from '@/lib/appAuth';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const customerId = url.searchParams.get('customerId')?.trim();

    // Health-check mode: return a test response for dashboard API registry
    if (customerId === 'test' || customerId === 'health-check') {
      return NextResponse.json({ customer: null, isHealthCheck: true }, { headers: corsHeaders });
    }

    const { customer: authCustomer } = await requireAppAuth(req);

    const customer = await prisma.customer.findUnique({
      where: { id: authCustomer.id },
      include: { communityMember: true },
    });

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404, headers: corsHeaders });
    }

    // Clean up expired store credits
    const { voidExpiredCredits } = await import('@/lib/storeCreditsHelper');
    await voidExpiredCredits(customer.id);

    const freshCustomer = await prisma.customer.findUnique({
      where: { id: customer.id },
      select: { storeCredits: true },
    });

    return NextResponse.json(
      {
        customer: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          image: customer.image,
          defaultAddress: customer.defaultAddress,
          isCommunityMember: !!customer.communityMember,
          storeCredits: freshCustomer ? freshCustomer.storeCredits : (customer.storeCredits ?? 0),
          storeCreditPreference: customer.storeCreditPreference ?? false,
        },
      },
      { headers: corsHeaders }
    );
  } catch (e: any) {
    if (e?.statusCode === 401) return handleAppAuthError(e);
    console.error('[App API] Profile GET error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500, headers: corsHeaders });
  }
}

export async function PATCH(req: Request) {
  try {
    const { customer: authCustomer } = await requireAppAuth(req);
    const body = await req.json();
    const { phone, email, name, image, defaultAddress } = body || {};

    const customer = await prisma.customer.findUnique({ where: { id: authCustomer.id } });
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404, headers: corsHeaders });
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
          ],
        },
      });
      if (existingOther) {
        return NextResponse.json(
          { error: 'An account with this email or phone number already exists.' },
          { status: 400, headers: corsHeaders }
        );
      }
    }

    const updated = await prisma.customer.update({
      where: { id: customer.id },
      data: {
        name: name !== undefined ? String(name).trim() : undefined,
        image: image !== undefined ? String(image) : undefined,
        defaultAddress: defaultAddress !== undefined ? String(defaultAddress) : undefined,
        email: cleanEmail !== undefined ? cleanEmail : undefined,
        phone: cleanPhone !== undefined ? cleanPhone : undefined,
      },
    });

    const historyData: any = { customerId: customer.id, changedBy: 'USER' };
    let hasChanges = false;

    if (name !== undefined && String(name) !== (customer.name || '')) {
      historyData.oldName = customer.name;
      historyData.newName = String(name);
      hasChanges = true;
    }
    if (email !== undefined && String(email) !== (customer.email || '')) {
      historyData.oldEmail = customer.email;
      historyData.newEmail = String(email);
      hasChanges = true;
    }
    if (phone !== undefined && String(phone) !== (customer.phone || '')) {
      historyData.oldPhone = customer.phone;
      historyData.newPhone = String(phone);
      hasChanges = true;
    }
    if (image !== undefined && String(image) !== (customer.image || '')) {
      historyData.oldImage = customer.image;
      historyData.newImage = String(image);
      hasChanges = true;
    }

    if (hasChanges) {
      await prisma.profileHistory.create({ data: historyData });
    }

    return NextResponse.json(
      {
        customer: {
          id: updated.id,
          name: updated.name,
          email: updated.email,
          phone: updated.phone,
          image: updated.image,
          defaultAddress: updated.defaultAddress,
        },
      },
      { headers: corsHeaders }
    );
  } catch (e: any) {
    if (e?.statusCode === 401) return handleAppAuthError(e);
    console.error('[App API] Profile PATCH error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500, headers: corsHeaders });
  }
}
