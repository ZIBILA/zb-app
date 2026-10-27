import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { resolvePrincipal } from '@/lib/ai/principal';

export const dynamic = 'force-dynamic';

/**
 * POST /api/support/tickets/claim  { ticketId }
 *
 * Attaches a guest support chat to the customer who just logged in, so they continue the same
 * conversation. Only an unowned ticket (customerId null) can be claimed; the ticket id is an
 * unguessable cuid that only exists in the guest's own browser (localStorage).
 */
export async function POST(req: NextRequest) {
  try {
    const principal = await resolvePrincipal(req);
    if (principal.kind !== 'customer') {
      return NextResponse.json({ error: 'Login required' }, { status: 401 });
    }

    const { ticketId } = await req.json().catch(() => ({}));
    if (!ticketId || typeof ticketId !== 'string') {
      return NextResponse.json({ error: 'ticketId is required' }, { status: 400 });
    }

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, customerId: true },
    });
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }
    if (ticket.customerId === principal.customerId) {
      return NextResponse.json({ claimed: false, alreadyOwned: true });
    }
    if (ticket.customerId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Conditional update so two concurrent claims can't both win
    const { count } = await prisma.supportTicket.updateMany({
      where: { id: ticketId, customerId: null },
      data: { customerId: principal.customerId },
    });
    if (count === 0) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Earlier guest messages belong to this customer too (keeps the dashboard's sender view consistent)
    await prisma.supportMessage.updateMany({
      where: { ticketId, senderType: 'USER', senderId: null },
      data: { senderId: principal.customerId },
    });

    return NextResponse.json({ claimed: true });
  } catch (error: unknown) {
    console.error('[Support API] Claim ticket error:', error);
    return NextResponse.json({ error: 'Failed to claim ticket' }, { status: 500 });
  }
}
