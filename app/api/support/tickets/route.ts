import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { sendMail } from '@/lib/mailer';
import { resolvePrincipal } from '@/lib/ai/principal';
import { processSupportTicketAIReply } from '@/lib/ai/supportAgent';
import { resolveEventGeo } from '@/lib/resolve-event-geo';

export const dynamic = 'force-dynamic';

export interface TicketWithCustomer {
  id?: string;
  customerId?: string | null;
  guestName?: string | null;
  guestEmail?: string | null;
  subject?: string | null;
  status?: string;
  priority?: string;
  aiAutoReply?: boolean;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  customer?: {
    id?: string;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  messages?: unknown[];
  [key: string]: unknown;
}

async function normalizeTicketIdentity(ticket: TicketWithCustomer) {
  let customer = ticket.customer;

  if (!customer && ticket.guestEmail && ticket.guestEmail !== 'Logged-in User') {
    try {
      customer = await prisma.customer.findFirst({
        where: { email: { equals: ticket.guestEmail, mode: 'insensitive' } },
        select: { id: true, name: true, email: true, phone: true },
      });
      // Display only: never persist the link — a typed email doesn't prove account ownership
    } catch {}
  }

  const rawGuestName = ticket.guestName && ticket.guestName !== 'Anonymous' ? ticket.guestName : null;
  const rawGuestEmail = ticket.guestEmail && ticket.guestEmail !== 'Logged-in User' ? ticket.guestEmail : null;

  const displayName = customer?.name || rawGuestName || (ticket.customerId ? 'Registered Customer' : 'Guest');
  const displayEmail = customer?.email || rawGuestEmail || null;
  const displayPhone = customer?.phone || null;

  return {
    ...ticket,
    displayName,
    displayEmail,
    displayPhone,
  };
}

export async function PATCH(req: NextRequest) {
  try {
    const principal = await resolvePrincipal(req);
    const body = await req.json();
    const { ticketId, status, priority, aiAutoReply } = body;

    if (!ticketId) {
      return NextResponse.json({ error: 'Ticket ID is required' }, { status: 400 });
    }

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    // Security check: Admins can update any ticket; customers can only update their own ticket status/priority
    if (principal.kind === 'customer' && ticket.customerId !== principal.customerId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    } else if (principal.kind === 'guest') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const updatedTicket = await prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        ...(status && { status }),
        ...(priority && { priority }),
        ...(typeof aiAutoReply === 'boolean' && { aiAutoReply }),
        updatedAt: new Date(),
      },
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    const normalized = await normalizeTicketIdentity(updatedTicket);
    return NextResponse.json({ ticket: normalized });
  } catch (error: unknown) {
    console.error('[Support API] PATCH Error:', error);
    return NextResponse.json({ error: 'Failed to update ticket' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const principal = await resolvePrincipal(req);
    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const ticketId = url.searchParams.get('ticketId');
    const requestedCustomerId = url.searchParams.get('customerId');
    const requestedGuestEmail = url.searchParams.get('guestEmail');

    // Admin access comes only from a real admin session (resolvePrincipal). A Referer containing
    // "/dashboard/" used to count too — it's client-controlled, so anyone could read any ticket.

    const where: Record<string, unknown> = {};
    if (ticketId) where.id = ticketId;
    if (status) where.status = status;

    if (principal.kind === 'admin') {
      if (requestedCustomerId) where.customerId = requestedCustomerId;
      if (requestedGuestEmail) where.guestEmail = requestedGuestEmail;
    } else if (principal.kind === 'customer') {
      // Return tickets matching customerId OR customer email
      if (principal.email) {
        where.OR = [
          { customerId: principal.customerId },
          { guestEmail: principal.email },
        ];
      } else {
        where.customerId = principal.customerId;
      }
    } else {
      // Guest requests: only an unowned ticket by its (unguessable) id.
      // Fetching by guestEmail is not allowed — emails are guessable and exposed whole chat histories.
      if (ticketId) {
        where.id = ticketId;
        // Once a guest chat belongs to an account, reading it requires that customer's login
        where.customerId = null;
      } else if (requestedCustomerId) {
        // TODO: remove once app builds that send the Bearer token are widely installed —
        // older app versions fetch their tickets here without auth.
        where.customerId = requestedCustomerId;
      } else {
        return NextResponse.json({ tickets: [] });
      }
    }

    const tickets = await prisma.supportTicket.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const normalizedTickets = await Promise.all(tickets.map(normalizeTicketIdentity));

    return NextResponse.json({ tickets: normalizedTickets });
  } catch (error: unknown) {
    console.error('[Support API] GET Tickets Error:', error);
    return NextResponse.json({ error: 'Failed to fetch tickets' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const principal = await resolvePrincipal(req);
    const body = await req.json();
    const { guestName: rawGuestName, guestEmail: rawGuestEmail, subject, content, priority, clientGeo } = body;
    const geo = await resolveEventGeo(req, clientGeo);

    let targetCustomerId = principal.kind === 'customer' ? principal.customerId : null;
    let guestName = rawGuestName;
    let guestEmail = rawGuestEmail;

    if (targetCustomerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: targetCustomerId },
        select: { name: true, email: true },
      });
      if (customer) {
        if (!guestName) guestName = customer.name || undefined;
        if (!guestEmail) guestEmail = customer.email || undefined;
      }
    } else if (body.customerId && rawGuestEmail) {
      // Older app builds create tickets without an auth token but send the user's id + email.
      // Attach only when BOTH match the same account (an email alone is guessable).
      // TODO: remove once app builds that send the Bearer token are widely installed.
      const appCustomer = await prisma.customer.findUnique({
        where: { id: String(body.customerId) },
        select: { id: true, email: true },
      });
      if (appCustomer?.email && appCustomer.email.toLowerCase() === String(rawGuestEmail).trim().toLowerCase()) {
        targetCustomerId = appCustomer.id;
      }
    }
    // Guests are never matched to an account by a typed email alone — that let anyone read (and post
    // into) another customer's open ticket. A web guest chat is attached to an account when that
    // customer logs in on the same browser (POST /api/support/tickets/claim).

    if (!subject || !content) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    // Guests can chat without giving a name or email (they continue via the ticket id in their browser)
    if (!targetCustomerId && !guestName) guestName = 'Guest';

    const cleanSubject = subject.trim();
    const targetSubjectLower = cleanSubject.toLowerCase();

    // -------------------------------------------------------------------------
    // Deduplication check: the logged-in customer's own OPEN / IN_PROGRESS ticket with the same subject.
    // Guests always get a new ticket (they continue it via the ticket id saved in their browser).
    // -------------------------------------------------------------------------
    const existingTickets = !targetCustomerId ? [] : await prisma.supportTicket.findMany({
      where: {
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        customerId: targetCustomerId,
      },
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const matchingTicket = existingTickets.find(
      (t: TicketWithCustomer) => (t.subject || '').trim().toLowerCase() === targetSubjectLower
    );

    if (matchingTicket) {
      // Append message to existing ticket instead of creating duplicate
      const senderName = guestName || (principal.kind === 'customer' ? (principal.email || 'Customer') : 'Guest');

      await prisma.supportMessage.create({
        data: {
          ticketId: matchingTicket.id!,
          content,
          senderType: 'USER',
          senderId: targetCustomerId,
          senderName,
          ip: geo.ip,
          geoSource: geo.geoSource,
          city: geo.city,
          region: geo.region,
          country: geo.country,
          countryCode: geo.countryCode,
          zip: geo.zip,
          latitude: geo.latitude,
          longitude: geo.longitude,
        },
      });

      await prisma.supportTicket.update({
        where: { id: matchingTicket.id },
        data: { updatedAt: new Date() },
      });

      // Trigger AI Auto-reply
      try {
        await processSupportTicketAIReply(matchingTicket.id!, content);
      } catch (aiErr) {
        console.error('[Support API] AI reply error on appended message:', aiErr);
      }

      const updatedExisting = await prisma.supportTicket.findUnique({
        where: { id: matchingTicket.id },
        include: {
          customer: { select: { id: true, name: true, email: true, phone: true } },
          messages: { orderBy: { createdAt: 'asc' } },
        },
      });

      const normalized = await normalizeTicketIdentity(updatedExisting || matchingTicket);
      return NextResponse.json({
        ticket: normalized,
        appended: true,
      });
    }

    // -------------------------------------------------------------------------
    // Create new ticket if no existing open match
    // -------------------------------------------------------------------------
    const senderName = guestName || (principal.kind === 'customer' ? 'Customer' : 'Guest');

    const ticket = await prisma.supportTicket.create({
      data: {
        customerId: targetCustomerId,
        guestName: guestName || null,
        guestEmail: guestEmail || null,
        subject: cleanSubject,
        priority: priority || 'MEDIUM',
        ip: geo.ip,
        geoSource: geo.geoSource,
        city: geo.city,
        region: geo.region,
        country: geo.country,
        countryCode: geo.countryCode,
        zip: geo.zip,
        latitude: geo.latitude,
        longitude: geo.longitude,
        messages: {
          create: [
            {
              content,
              senderType: 'USER',
              senderId: targetCustomerId,
              senderName,
              ip: geo.ip,
              geoSource: geo.geoSource,
              city: geo.city,
              region: geo.region,
              country: geo.country,
              countryCode: geo.countryCode,
              zip: geo.zip,
              latitude: geo.latitude,
              longitude: geo.longitude,
            },
            {
              content: `Hello! We have received your support request regarding "${cleanSubject}". Our team and Zica AI assistant will review it shortly. Ticket ID: #${cleanSubject.slice(0, 4)}-${Date.now().toString().slice(-4)}`,
              senderType: 'ZICA_AI',
              senderId: 'system',
              senderName: 'Zica AI',
            },
          ],
        },
      },
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    // Send internal admin email notification asynchronously
    sendMail({
      to: process.env.ZOHO_MAIL_USER || 'support@zicabella.com',
      subject: `[SUPPORT] New Ticket: ${cleanSubject}`,
      html: `
        <h3>New Support Ticket Created</h3>
        <p><strong>From:</strong> ${guestName || targetCustomerId} (${guestEmail || 'Logged-in User'})</p>
        <p><strong>Subject:</strong> ${cleanSubject}</p>
        <p><strong>Message:</strong></p>
        <p>${content}</p>
        <hr />
        <p>View in Admin Dashboard: <a href="https://app.zicabella.com/dashboard/support/${ticket.id}">View Ticket</a></p>
      `,
    }).catch((mailError) => {
      console.error('[Support API] Failed to send notification email:', mailError);
    });

    // Trigger AI Auto-reply inline for the new ticket
    try {
      await processSupportTicketAIReply(ticket.id, content);
    } catch (aiErr) {
      console.error('[Support API] AI reply error on ticket creation:', aiErr);
    }

    // Refetch ticket with full updated messages including Zica AI reply
    const updatedTicket = await prisma.supportTicket.findUnique({
      where: { id: ticket.id },
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });

    const normalized = await normalizeTicketIdentity(updatedTicket || ticket);
    return NextResponse.json({
      ticket: normalized,
    });
  } catch (error: unknown) {
    console.error('[Support API] POST Error:', error);
    return NextResponse.json({ error: 'Failed to create ticket' }, { status: 500 });
  }
}
