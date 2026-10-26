import { NextRequest, NextResponse } from 'next/server';
import { sendMail } from '@/lib/mailer';
import { logEmail } from '@/lib/log-email';
import { baseTemplate } from '@/lib/email-templates/base';
import prisma from '@/lib/db';
import { requireAdmin, handleAuthError } from "@/lib/auth/rbac";

export async function POST(req: NextRequest) {
  try {
    await requireAdmin('MARKETING', 'edit');

    const data = await req.json();
    const { to, subject, html, recipientName } = data;

    if (!to || !subject || !html) {
      return NextResponse.json({ error: 'Missing to, subject, or html' }, { status: 400 });
    }

    // Resolve recipients list
    let recipients: { email: string; name: string }[] = [];

    if (to === 'all_customers') {
      const customers = await prisma.customer.findMany({
        where: {
          email: { not: null },
          emailOptedOut: false,
        },
        select: { email: true, name: true }
      });
      recipients = customers.map((c: { email: string | null; name: string | null }) => ({ email: c.email!, name: c.name || 'Customer' }));
    } else if (to === 'all_vendors') {
      const vendorsEmail = process.env.VENDOR_NOTIFICATION_EMAIL || 'vendors@zicabella.com';
      recipients = vendorsEmail.split(',').map(e => ({ email: e.trim(), name: 'Vendor' }));
    } else if (to === 'app_users') {
      let customers = await prisma.customer.findMany({
        where: {
          email: { not: null },
          emailOptedOut: false,
          OR: [
            { lastLoginAt: { not: null } },
            { communityMember: { isNot: null } }
          ]
        },
        select: { email: true, name: true }
      });
      if (customers.length === 0) {
        customers = await prisma.customer.findMany({
          where: {
            email: { not: null },
            emailOptedOut: false,
          },
          select: { email: true, name: true }
        });
      }
      recipients = customers.map((c: { email: string | null; name: string | null }) => ({ email: c.email!, name: c.name || 'User' }));
    } else {
      // Comma-separated custom emails
      recipients = to.split(',').map((email: string) => {
        const cleanEmail = email.trim();
        return { email: cleanEmail, name: cleanEmail.split('@')[0] || 'Recipient' };
      }).filter((r: any) => r.email && r.email.includes('@'));
    }

    if (recipients.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid recipients found' }, { status: 400 });
    }

    // Wrap the custom HTML in our base template if it's not already a full document
    const finalHtml = html.includes('<!DOCTYPE') ? html : baseTemplate(html);

    let successCount = 0;
    let failCount = 0;
    const errors: string[] = [];

    // Send emails in a loop and log results
    for (const recipient of recipients) {
      try {
        // Personalize the email template with all available recipient-level data.
        // In the manual compose context, only customer-level fields are available
        // (no per-order data like orderId, trackingUrl, etc.).
        let personalizedHtml = finalHtml;
        personalizedHtml = personalizedHtml.replace(/\{\{customerName\}\}/g, recipient.name);
        personalizedHtml = personalizedHtml.replace(/\{\{customerEmail\}\}/g, recipient.email);

        // Check for any remaining unresolved {{...}} variables.
        // In a manual compose flow there is no per-order context, so any remaining
        // template variables would render as literal {{...}} in the customer's inbox.
        // Reject the send with a clear error listing which variables remain.
        const unresolvedMatches = personalizedHtml.match(/\{\{([^}]+)\}\}/g);
        if (unresolvedMatches) {
          const unresolvedKeys = Array.from(new Set(unresolvedMatches.map((m: string) => m.slice(2, -2).trim())));
          return NextResponse.json({
            success: false,
            error: `Unresolved template variables: ${unresolvedKeys.join(', ')}. These variables have no value in a manual compose context. Remove them from the template or provide values before sending.`,
            unresolvedVariables: unresolvedKeys,
          }, { status: 400 });
        }

        const result = await sendMail({
          to: recipient.email,
          subject: subject,
          html: personalizedHtml,
        });

        const msgId = (result as any)?.messageId || `sent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        await logEmail({
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          subject,
          templateName: 'customCompose',
          triggerEvent: 'dashboard/compose',
          status: 'sent',
          messageId: msgId,
          sentBy: 'admin-dashboard',
        });

        successCount++;
      } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
        console.error(`Failed to send email to ${recipient.email}:`, error);
        failCount++;
        errors.push(`${recipient.email}: ${error.message}`);

        await logEmail({
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          subject,
          templateName: 'customCompose',
          triggerEvent: 'dashboard/compose',
          status: 'failed',
          errorMessage: error.message,
          sentBy: 'admin-dashboard',
        });
      }
    }

    return NextResponse.json({ 
      success: successCount > 0, 
      successCount, 
      failCount, 
      errors 
    });
  } catch (error: any) {
    console.error('Compose Email General Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

