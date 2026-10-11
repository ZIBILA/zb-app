import twilio from 'twilio';
import db from '../db';

function getTwilioClient(sid?: string | null, token?: string | null) {
  const activeSid = sid || process.env.TWILIO_ACCOUNT_SID;
  const activeToken = token || process.env.TWILIO_AUTH_TOKEN;
  if (activeSid && activeToken) {
    return twilio(activeSid, activeToken);
  }
  return null;
}

function normalizeE164(to: string): string | null {
  let formatted = String(to || '').trim().replace(/[\s\-\(\)]/g, '');
  if (!formatted) return null;
  if (!formatted.startsWith('+')) formatted = '+' + formatted.replace(/\D/g, '');
  // E.164: + then 8–15 digits
  if (!/^\+[1-9]\d{7,14}$/.test(formatted)) return null;
  return formatted;
}

export const SmsService = {
  /**
   * Sends an SMS message via Twilio.
   * Tries environment variables first, then falls back to DB-stored credentials.
   * Throws an error if no valid credentials are found.
   */
  async sendSms(to: string, body: string, dltTemplateId?: string) {
    let activeClient = getTwilioClient();
    let activeFromNumber = process.env.TWILIO_PHONE_NUMBER || undefined;
    let activeMessagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

    // If environment variables are missing, try fetching from the database
    if (!activeClient || !activeFromNumber) {
      try {
        const shop = await db.shop.findFirst();
        if (shop?.twilioAccountSid && shop?.twilioAuthToken) {
          activeClient = getTwilioClient(shop.twilioAccountSid, shop.twilioAuthToken);
          activeFromNumber = shop.twilioPhoneNumber || undefined;
        }
      } catch (dbErr) {
        console.error('[SmsService] DB lookup failed:', dbErr);
      }
    }

    if (!activeClient) {
      console.warn('[SmsService] Twilio client not initialized.');
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[DEV FALLBACK] SMS to ${to}: ${body}`);
        return { sid: 'mock_sid' };
      }
      throw new Error('Twilio service is not configured correctly.');
    }

    try {
      const formattedPhone = normalizeE164(to);
      if (!formattedPhone) {
        throw new Error(`Invalid phone number for SMS: ${String(to).slice(0, 20)}`);
      }

      const messageOptions: any = {
        body,
        to: formattedPhone,
      };

      if (activeMessagingServiceSid) {
        messageOptions.messagingServiceSid = activeMessagingServiceSid;
      } else if (activeFromNumber) {
        messageOptions.from = activeFromNumber;
      } else {
        throw new Error('No sender (phone number or messaging service) configured.');
      }

      const response = await activeClient.messages.create(messageOptions);
      return response;
    } catch (error: any) {
      const code = error?.code || error?.status || 'unknown';
      console.warn(`[SmsService] Twilio SMS error [code=${code}]: ${error?.message || error}`);
      if (process.env.NODE_ENV === 'development') {
        return { sid: 'mock_sid' };
      }
      throw new Error(`Failed to send SMS: ${error.message}`);
    }
  },

  /**
   * Sends a verification code via Twilio Verify API.
   */
  async sendVerification(to: string) {
    const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
    const activeClient = getTwilioClient();
    if (!activeClient || !serviceSid) {
      console.log('[SmsService] Twilio Verify not configured, falling back to manual SMS.');
      return null;
    }

    try {
      const formattedPhone = normalizeE164(to);
      if (!formattedPhone) {
        console.warn('[SmsService] Invalid phone for Verify send — skipping');
        return null;
      }

      const verification = await activeClient.verify.v2.services(serviceSid)
        .verifications
        .create({ to: formattedPhone, channel: 'sms' });

      return verification;
    } catch (error: any) {
      const code = error?.code || error?.status || 'unknown';
      console.warn(`[SmsService] Twilio Verify send error [code=${code}]: ${error?.message || error}`);
      throw error;
    }
  },

  /**
   * Checks a verification code via Twilio Verify API.
   */
  async checkVerification(to: string, code: string) {
    const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
    const activeClient = getTwilioClient();
    if (!activeClient || !serviceSid) return null;

    try {
      const formattedPhone = normalizeE164(to);
      if (!formattedPhone) return false;

      const check = await activeClient.verify.v2.services(serviceSid)
        .verificationChecks
        .create({ to: formattedPhone, code });

      return check.status === 'approved';
    } catch (error: any) {
      // 20404: expired/consumed — expected user path, keep quiet
      const twilioCode = error.code || error.status || 'unknown';
      if (twilioCode === 20404 || twilioCode === '20404') return false;
      console.warn(`[SmsService] Twilio Verify check error [code=${twilioCode}]: ${error.message || 'No message'}`);
      return false;
    }
  }
};
