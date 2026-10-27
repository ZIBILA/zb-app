import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/options';
import { voidExpiredCredits } from '@/lib/storeCreditsHelper';

export const dynamic = 'force-dynamic';

function getCleanPhone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '').slice(-10);
  return digits.length === 10 ? digits : null;
}

function getCleanEmail(email?: string | null): string | null {
  if (!email) return null;
  const trimmed = String(email).trim().toLowerCase();
  return trimmed.length > 3 && trimmed.includes('@') ? trimmed : null;
}

/**
 * GET /api/user/store-credits
 *
 * Returns the logged-in customer's available store credit balance (voids expired credits first).
 * Resolved from the session only — never from query params, so one customer can't read another's
 * balance. Guests get a zero balance.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const sessionUser = session?.user as any;
    const sessionId: string | null = sessionUser?.id || null;
    const sessionEmail = getCleanEmail(sessionUser?.email);
    const sessionPhone = getCleanPhone(sessionUser?.phone);

    if (!sessionId && !sessionEmail && !sessionPhone) {
      return NextResponse.json({
        success: true,
        balance: 0,
        storeCreditPreference: false,
      }, { status: 200 });
    }

    const select = {
      id: true,
      storeCredits: true,
      storeCreditPreference: true,
      email: true,
      phone: true,
    };
    const customer =
      (sessionId ? await prisma.customer.findUnique({ where: { id: sessionId }, select }) : null) ||
      (sessionEmail || sessionPhone
        ? await prisma.customer.findFirst({
            where: {
              OR: [
                ...(sessionEmail ? [{ email: { equals: sessionEmail, mode: 'insensitive' as const } }] : []),
                ...(sessionPhone ? [{ phone: { contains: sessionPhone } }] : []),
              ],
            },
            select,
          })
        : null);

    if (!customer) {
      return NextResponse.json({
        success: true,
        balance: 0,
        storeCreditPreference: false,
      }, { status: 200 });
    }

    // Run expiration cleanup
    await voidExpiredCredits(customer.id);

    // Re-query updated store credit balance
    const updatedCustomer = await prisma.customer.findUnique({
      where: { id: customer.id },
      select: { storeCredits: true, storeCreditPreference: true },
    });

    const balance = Math.max(0, updatedCustomer?.storeCredits || 0);

    return NextResponse.json({
      success: true,
      customerId: customer.id,
      balance,
      storeCreditPreference: updatedCustomer?.storeCreditPreference || false,
    }, { status: 200 });
  } catch (error: any) {
    console.error('[WebStore Store Credit API] Error fetching store credits:', error.message);
    return NextResponse.json({
      success: false,
      error: error.message,
      balance: 0,
    }, { status: 500 });
  }
}
