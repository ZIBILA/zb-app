import jwt from 'jsonwebtoken';

// ── FCM HTTP v1 Direct Delivery (Android) ──────────────────────────────────
// Service account JSON, base64-encoded, from Firebase Console →
// Project settings → Service accounts → Generate new private key.
function getServiceAccount(): { project_id: string; client_email: string; private_key: string } | null {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!b64) return null;
  try {
    const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
    if (!sa.project_id || !sa.client_email || !sa.private_key) return null;
    return sa;
  } catch {
    return null;
  }
}

let _accessToken: string | null = null;
let _accessTokenExpiry = 0;

async function getAccessToken(): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (_accessToken && now < _accessTokenExpiry) return _accessToken;

  const sa = getServiceAccount();
  if (!sa) return null;

  const assertion = jwt.sign(
    { scope: 'https://www.googleapis.com/auth/firebase.messaging' },
    sa.private_key,
    {
      algorithm: 'RS256',
      issuer: sa.client_email,
      audience: 'https://oauth2.googleapis.com/token',
      expiresIn: '1h',
    }
  );

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!res.ok) {
      console.error('[FCM] OAuth token request failed:', res.status, await res.text());
      return null;
    }
    const json = await res.json();
    _accessToken = json.access_token;
    _accessTokenExpiry = now + Math.max(60, (json.expires_in || 3600) - 300);
    return _accessToken;
  } catch (e) {
    console.error('[FCM] OAuth token request error:', e);
    return null;
  }
}

export type FcmResult = { ok: boolean; invalidToken?: boolean };

export async function sendViaFcm(
  deviceToken: string,
  title: string,
  body: string,
  data?: Record<string, string>
): Promise<FcmResult> {
  const sa = getServiceAccount();
  const accessToken = await getAccessToken();
  if (!sa || !accessToken) {
    console.error('[FCM] FIREBASE_SERVICE_ACCOUNT_BASE64 is missing or invalid.');
    return { ok: false };
  }

  // FCM data values must all be strings.
  const stringData: Record<string, string> = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v !== undefined && v !== null) stringData[k] = String(v);
  }

  try {
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: deviceToken,
            notification: { title, body },
            data: stringData,
            android: {
              priority: 'HIGH',
              notification: { channel_id: 'default', sound: 'default' },
            },
          },
        }),
      }
    );
    if (res.ok) return { ok: true };

    const text = await res.text();
    console.error('[FCM] Send failed:', res.status, text);
    // UNREGISTERED / INVALID_ARGUMENT on the token means the app was removed or the token is stale.
    const invalidToken = res.status === 404 || (res.status === 400 && text.includes('INVALID_ARGUMENT'));
    return { ok: false, invalidToken };
  } catch (e) {
    console.error('[FCM] Send error:', e);
    return { ok: false };
  }
}
