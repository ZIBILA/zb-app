import jwt from 'jsonwebtoken';
import db from '../db';
import { sendViaFcm } from './fcm';

const isLegacyExpoToken = (t: string) => t.startsWith('ExponentPushToken');
const isApnsToken = (t: string) => /^[a-f0-9]{64}$/i.test(t);

// ── APNs Direct Delivery ───────────────────────────────────────────────────
const APNS_KEY_ID = process.env.APNS_KEY_ID || '';
const APNS_TEAM_ID = process.env.APNS_TEAM_ID || '';
const APNS_BUNDLE_ID = process.env.APNS_BUNDLE_ID || 'com.zicabella.ios';
const APNS_PRODUCTION = process.env.APNS_PRODUCTION === 'true';
const APNS_HOST = APNS_PRODUCTION
  ? 'https://api.push.apple.com'
  : 'https://api.sandbox.push.apple.com';

function getApnsPrivateKey(): string | null {
  const b64 = process.env.APNS_KEY_BASE64;
  if (!b64) return null;
  try {
    return Buffer.from(b64, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

let _apnsJwt: string | null = null;
let _apnsJwtExpiry = 0;

function getApnsJwt(): string | null {
  const now = Math.floor(Date.now() / 1000);
  if (_apnsJwt && now < _apnsJwtExpiry) return _apnsJwt;
  const privateKey = getApnsPrivateKey();
  if (!privateKey || !APNS_KEY_ID || !APNS_TEAM_ID) return null;
  _apnsJwt = jwt.sign({}, privateKey, {
    algorithm: 'ES256',
    keyid: APNS_KEY_ID,
    issuer: APNS_TEAM_ID,
    header: { alg: 'ES256', kid: APNS_KEY_ID },
    expiresIn: '55m',
  });
  _apnsJwtExpiry = now + 55 * 60;
  return _apnsJwt;
}

async function sendViaApns(deviceToken: string, title: string, body: string, data?: Record<string, string>): Promise<boolean> {
  const token = getApnsJwt();
  if (!token) return false;
  const apnsPayload = {
    aps: {
      alert: { title, body },
      sound: 'default',
      badge: 1,
      'content-available': 1,
      'mutable-content': 1,
      category: 'default',
    },
    ...(data || {}),
  };
  try {
    const response = await fetch(`${APNS_HOST}/3/device/${deviceToken}`, {
      method: 'POST',
      headers: {
        'authorization': `bearer ${token}`,
        'apns-topic': APNS_BUNDLE_ID,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': '3600',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(apnsPayload),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export const NotificationService = {
  async sendToUser(userId: string, title: string, body: string, data?: Record<string, string>) {
    const devices = await db.deviceToken.findMany({
      where: { userId, isActive: true },
    });

    if (devices.length === 0) return { success: false, reason: 'No active devices.' };

    let successCount = 0;
    let failureCount = 0;

    // Send to ALL tokens on ALL devices for this user for redundancy and speed
    const deliveryPromises = devices.map(async (device: any) => {
      let deviceSuccess = false;

      // 1. Direct APNs (Primary for iOS)
      if (device.apnsToken && device.platform !== 'android') {
        deviceSuccess = await sendViaApns(device.apnsToken, title, body, data);
      }

      // 2. Android (FCM direct) or iOS native token stored in fcmToken
      if (!deviceSuccess && device.fcmToken && !isLegacyExpoToken(device.fcmToken)) {
        if (device.platform === 'ios' || isApnsToken(device.fcmToken)) {
          deviceSuccess = await sendViaApns(device.fcmToken, title, body, data);
        } else {
          const result = await sendViaFcm(device.fcmToken, title, body, data);
          deviceSuccess = result.ok;
          if (result.invalidToken) {
            await db.deviceToken.update({ where: { id: device.id }, data: { isActive: false } }).catch(() => {});
          }
        }
      }

      if (deviceSuccess) successCount++;
      else failureCount++;
    });

    await Promise.all(deliveryPromises);
    return { success: successCount > 0, successCount, failureCount };
  },

  async sendToTokens(tokens: string[], title: string, body: string, data?: Record<string, string>) {
    const results = await Promise.all(tokens.map(async token => {
      if (isLegacyExpoToken(token)) return false;
      if (isApnsToken(token)) return sendViaApns(token, title, body, data);
      return (await sendViaFcm(token, title, body, data)).ok;
    }));
    return { success: true, successCount: results.filter(Boolean).length };
  }
};
