import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@/lib/mailer';
import { requireAdmin, handleAuthError } from "@/lib/auth/rbac";

export const dynamic = 'force-dynamic';

// Simple in-memory rate limiter for marketing sends: max 50 per minute
let marketingSendCount = 0;
let lastResetTime = Date.now();

function checkMarketingRateLimit(countToIncrement: number): boolean {
  const now = Date.now();
  // Reset every 60 seconds
  if (now - lastResetTime >= 60 * 1000) {
    marketingSendCount = 0;
    lastResetTime = now;
  }
  
  if (marketingSendCount + countToIncrement > 50) {
    return false;
  }
  
  marketingSendCount += countToIncrement;
  return true;
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin('MARKETING', 'edit');

    const body = await request.json();
    const { to, subject, html, text, isMarketing } = body;

    if (!to || !subject || !html) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: to, subject, and html are required.' },
        { status: 400 }
      );
    }

    const recipients = Array.isArray(to) ? to : [to];

    // Apply rate limiting for marketing sends
    if (isMarketing) {
      const allowed = checkMarketingRateLimit(recipients.length);
      if (!allowed) {
        return NextResponse.json(
          {
            success: false,
            error: `Marketing email rate limit exceeded. Max 50 emails per minute. Current minute allowance: ${50 - marketingSendCount} remaining.`,
          },
          { status: 429 }
        );
      }
    }

    let sent = 0;
    let failed = 0;

    // Send emails individually to avoid leaking email addresses to other recipients
    for (const recipient of recipients) {
      try {
        await sendEmail({
          to: recipient,
          subject,
          html,
          text,
        });
        sent++;
      } catch (err) {
        console.error(`[Mail Send API] Failed sending to ${recipient}:`, err);
        failed++;
      }
    }

    return NextResponse.json(
      {
        success: true,
        sent,
        failed,
        message: `Successfully dispatched emails: ${sent} succeeded, ${failed} failed.`,
      },
      { status: 200 }
    );
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    console.error('[Mail Send API Error]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to dispatch emails' },
      { status: 500 }
    );
  }
}
