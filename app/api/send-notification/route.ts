import { NextResponse } from 'next/server';
import { NotificationService } from '@/lib/services/notification.service';
import db from '@/lib/db';
import { requireAdmin, handleAuthError } from "@/lib/auth/rbac";

/**
 * POST /api/send-notification
 *
 * Accepts { userId, title, body, data }.
 * Looks up the user's push tokens and sends via Expo push service + direct APNs.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin('MARKETING', 'edit');

    const payload = await req.json();
    const { userId, title, body, data } = payload;

    if (!userId || !title || !body) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, title, body' },
        { status: 400 }
      );
    }

    const result = await NotificationService.sendToUser(userId, title, body, data);

    if (!result.success) {
      return NextResponse.json(
        { error: (result as any).reason || 'Failed to send notification' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      successCount: (result as any).successCount || 0,
      failureCount: (result as any).failureCount || 0,
    });
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    console.error('[send-notification] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
