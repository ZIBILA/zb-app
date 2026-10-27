import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { sendMail, buildSupportEmailHtml } from '@/lib/mailer';
import { resolvePrincipal } from '@/lib/ai/principal';
import { processSupportTicketAIReply } from '@/lib/ai/supportAgent';
import { resolveEventGeo } from '@/lib/resolve-event-geo';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const principal = await resolvePrincipal(req);
    const body = await req.json();
    const { ticketId, content, clientGeo } = body;

    if (!ticketId || !content) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true } },
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    // Determine senderType securely based on the principal
    // Admin access comes only from a real admin session (resolvePrincipal). A Referer containing
    // "/dashboard/" used to count too — it's client-controlled, so anyone could read any ticket.

    let senderType = 'USER';
    let senderId: string | null = null;
    let senderName = body.senderName || 'Customer';

    if (principal.kind === 'admin') {
      senderType = 'AGENT';
      senderId = principal.kind === 'admin' ? principal.adminId : 'admin';
      senderName = body.senderName || 'Zica Support';
    } else if (principal.kind === 'customer') {
      if (ticket.customerId && ticket.customerId !== principal.customerId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      senderType = 'USER';
      senderId = principal.customerId;
      senderName = body.senderName || ticket.customer?.name || 'Customer';
    }

    const geo = senderType === 'USER' ? await resolveEventGeo(req, clientGeo) : null;

    const message = await prisma.supportMessage.create({
      data: {
        ticketId,
        content,
        senderType,
        senderId,
        senderName,
        ...(geo && senderType === 'USER'
          ? {
              ip: geo.ip,
              geoSource: geo.geoSource,
              city: geo.city,
              region: geo.region,
              country: geo.country,
              countryCode: geo.countryCode,
              zip: geo.zip,
              latitude: geo.latitude,
              longitude: geo.longitude,
            }
          : {}),
      },
    });

    // Update ticket's updatedAt timestamp
    await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { updatedAt: new Date() },
    });

    // If sender is AGENT, notify the user via email
    if (senderType === 'AGENT') {
      let recipientEmail = ticket.customer?.email || ticket.guestEmail || null;

      if (!recipientEmail && ticket.customerId) {
        const customer = await prisma.customer.findUnique({
          where: { id: ticket.customerId },
          select: { email: true, name: true },
        });
        recipientEmail = customer?.email || null;
      }

      if (recipientEmail) {
        const customerName = ticket.customer?.name || ticket.guestName || 'Valued Customer';
        sendMail({
          to: recipientEmail,
          subject: `Re: ${ticket.subject} [Support Ticket #${ticket.id.slice(-6)}]`,
          html: buildSupportEmailHtml({
            ticketId: ticket.id,
            subject: ticket.subject,
            senderName,
            content,
            customerName,
          }),
        }).catch((mailError) => {
          console.error('[Support API] Failed to send user notification email:', mailError);
        });
      }
    }

    // Trigger email & AI Auto-reply if sender is USER
    let aiReplyResult = null;
    if (senderType === 'USER') {
      // Async email notification to admin support inbox
      const supportEmail = process.env.ZOHO_MAIL_USER || 'support@zicabella.com';
      sendMail({
        to: supportEmail,
        subject: `[SUPPORT MESSAGE] Ticket #${ticket.id.slice(-6).toUpperCase()}: ${ticket.subject}`,
        html: `
          <h3>New Customer Message Received</h3>
          <p><strong>Ticket ID:</strong> #${ticket.id}</p>
          <p><strong>Subject:</strong> ${ticket.subject}</p>
          <div style="background: #f4f4f4; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Customer Message:</strong></p>
            <p>${content}</p>
          </div>
          <hr />
          <p><a href="https://app.zicabella.com/dashboard/support/${ticket.id}">View and Reply in Admin Dashboard</a></p>
        `,
      }).catch((mailError) => {
        console.error('[Support API] Failed to send admin notification email:', mailError);
      });

      // Await Zica AI reply inline so response is immediately saved and emailed
      try {
        aiReplyResult = await processSupportTicketAIReply(ticketId, content);
      } catch (aiErr) {
        console.error('[Support API] AI reply error:', aiErr);
      }
    }

    return NextResponse.json({ message, aiReply: aiReplyResult });
  } catch (error: unknown) {
    console.error('[Support API] POST Message Error:', error);
    return NextResponse.json({ error: 'Failed to post message' }, { status: 500 });
  }
}
