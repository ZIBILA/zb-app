import { NextResponse } from 'next/server';
import db from '@/lib/db';

/**
 * POST /api/notifications/register-device
 * 
 * Stores or updates a device's push tokens.
 * Stores APNs tokens (iOS) and FCM registration tokens (Android).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { userId, deviceId, fcmToken, expoPushToken, deviceToken, platform, appVersion } = body;

    if (!deviceId) {
      return NextResponse.json({ error: 'Missing deviceId' }, { status: 400 });
    }

    const finalUserId = userId || `GUEST_${deviceId}`;
    
    const isIos = (platform || 'ios') === 'ios';
    const incoming: string | undefined = deviceToken || fcmToken || expoPushToken;
    if (!incoming) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 });
    }
    const isLegacyExpo = incoming.startsWith('ExponentPushToken');
    // iOS native tokens go to APNs; Android native tokens are FCM registration tokens.
    const expoToken = expoPushToken || (isLegacyExpo ? incoming : null);
    const apnsToken = isIos && !isLegacyExpo ? (deviceToken || incoming) : null;
    const primaryToken = isLegacyExpo && !isIos ? incoming : (apnsToken || incoming);

    const record = await db.deviceToken.upsert({
      where: {
        userId_deviceId: {
          userId: finalUserId,
          deviceId,
        },
      },
      update: {
        fcmToken: primaryToken,
        expoPushToken: expoToken,
        apnsToken: apnsToken,
        platform: platform || 'ios',
        appVersion,
        isActive: true,
        updatedAt: new Date(),
      },
      create: {
        userId: finalUserId,
        deviceId,
        fcmToken: primaryToken,
        expoPushToken: expoToken,
        apnsToken: apnsToken,
        platform: platform || 'ios',
        isActive: true,
        appVersion,
      },
    });

    return NextResponse.json({ success: true, id: record.id });
  } catch (error: any) {
    console.error('Device registration error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
