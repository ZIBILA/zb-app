import { NextResponse } from 'next/server';
import db from '@/lib/db';

/**
 * POST /api/push-token
 *
 * Accepts { userId, token } from the React Native app.
 * Upserts into the DeviceToken table so the admin dashboard
 * can later send targeted push notifications.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { userId, token, platform = 'ios' } = body;

    if (!userId || !token) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, token' },
        { status: 400 }
      );
    }

    // Use a deterministic deviceId derived from userId + platform prefix
    // so re-registering from the same user/device upserts instead of duplicating.
    const deviceId = `expo_${platform}_${userId}`;

    const record = await db.deviceToken.upsert({
      where: {
        userId_deviceId: {
          userId,
          deviceId,
        },
      },
      update: {
        fcmToken: token,       // Expo push token stored in fcmToken column
        isActive: true,
        updatedAt: new Date(),
      },
      create: {
        userId,
        deviceId,
        fcmToken: token,
        platform,
        isActive: true,
      },
    });

    return NextResponse.json({ success: true, id: record.id });
  } catch (error: any) {
    console.error('[push-token] Registration error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
