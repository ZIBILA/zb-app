import db from '../db';
import axios from 'axios';
import crypto from 'crypto';

// Helper to hash customer data (required by Meta Conversions API)
function sha256(text: string): string {
  if (!text) return '';
  return crypto.createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
}

export const eventTracker = {
  /**
   * Central track function.
   * Stores the event locally, and forwards to Meta if configured and enabled.
   */
  async track(params: {
    eventName: string;
    customerId?: string | null;
    customerPhone?: string | null;
    orderId?: string | null;
    productId?: string | null;
    eventSource?: string;
    metadata?: any;
  }) {
    const {
      eventName,
      customerId,
      customerPhone,
      orderId,
      productId,
      eventSource = 'system',
      metadata = {},
    } = params;

    // Normalize phone number
    let normalizedPhone = '';
    if (customerPhone) {
      normalizedPhone = customerPhone.replace(/\D/g, '');
      if (normalizedPhone.length === 10) {
        normalizedPhone = '91' + normalizedPhone;
      }
    }

    // 1. Store internally in whatsapp_events
    let eventRecord: any;
    try {
      eventRecord = await db.whatsAppEvent.create({
        data: {
          eventName,
          customerId: customerId || null,
          customerPhone: normalizedPhone || null,
          orderId: orderId || null,
          productId: productId || null,
          eventSource,
          metadataJson: JSON.stringify(metadata),
          status: 'pending',
        },
      });
    } catch (dbErr: any) {
      console.error('[Event Tracker] Failed to save event locally:', dbErr.message);
      return { success: false, error: 'Database save failed' };
    }

    // Check feature flags: environment variable OR database settings
    let isMetaEventsEnabled = process.env.ENABLE_META_EVENTS === 'true';
    let dbSettings: Record<string, string> = {};
    try {
      const list = await db.whatsAppSetting.findMany();
      dbSettings = Object.fromEntries(list.map((s: any) => [s.key, s.value]));
      if (dbSettings['enable_meta_events'] !== undefined) {
        isMetaEventsEnabled = dbSettings['enable_meta_events'] === 'true';
      }
    } catch (err: any) {
      console.warn('[Event Tracker] Failed to fetch settings from whatsapp_settings:', err.message);
    }

    // 2. Forward to Meta Conversions API if enabled
    if (isMetaEventsEnabled) {
      try {
        const datasetId = dbSettings['whatsapp_dataset_id'] || process.env.NEXT_PUBLIC_META_PIXEL_ID || process.env.NEXT_PUBLIC_FACEBOOK_PIXEL_ID;
        const accessToken = dbSettings['whatsapp_access_token'] || process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
        const wabaId = dbSettings['whatsapp_business_account_id'] || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
        const pageId = dbSettings['whatsapp_page_id'] || process.env.WHATSAPP_PAGE_ID;

        if (!datasetId || !accessToken) {
          throw new Error('Meta Conversions API is not fully configured (missing Dataset ID/Pixel ID or Meta Access Token).');
        }

        const eventTime = Math.floor(Date.now() / 1000);
        const hashedPhone = normalizedPhone ? sha256(normalizedPhone) : '';

        // Match parameters
        const userData: any = {
          whatsapp_business_account_id: wabaId || undefined,
          page_id: pageId || undefined,
        };
        if (hashedPhone) {
          userData.ph = [hashedPhone];
        }
        
        // Match ctwa_clid (Click-to-WhatsApp Click ID) if present
        if (metadata.ctwa_clid) {
          userData.ctwa_clid = metadata.ctwa_clid;
        }

        // Map events to Meta's standard event names
        let metaEventName = eventName;
        const eventMapping: Record<string, string> = {
          'Product Viewed': 'ViewContent',
          'Category Viewed': 'ViewContent',
          'Search Performed': 'Search',
          'Add To Wishlist': 'AddToWishlist',
          'Add To Cart': 'AddToCart',
          'Checkout Started': 'InitiateCheckout',
          'Payment Initiated': 'InitiateCheckout',
          'Purchase Completed': 'Purchase',
          'COD Order Placed': 'Purchase',
          'Lead Created': 'Lead',
          'User Registered': 'CompleteRegistration',
          'User Login': 'Contact',
          'WhatsApp Chat Started': 'Contact',
          'Customer Support Conversation Started': 'Contact',
        };

        if (eventMapping[eventName]) {
          metaEventName = eventMapping[eventName];
        }

        const customData: any = {};
        if (metadata.value !== undefined) customData.value = Number(metadata.value);
        if (metadata.currency) customData.currency = metadata.currency;
        if (metadata.content_ids) customData.content_ids = metadata.content_ids;
        if (metadata.content_type) customData.content_type = metadata.content_type;
        if (metadata.search_string) customData.search_string = metadata.search_string;

        const payload = {
          data: [
            {
              event_name: metaEventName,
              event_time: eventTime,
              action_source: 'business_messaging',
              messaging_channel: 'whatsapp',
              user_data: userData,
              custom_data: Object.keys(customData).length > 0 ? customData : undefined,
              event_id: eventRecord.id, // Deduplication key
            }
          ]
        };

        const metaUrl = `https://graph.facebook.com/v25.0/${datasetId}/events?access_token=${accessToken}`;
        const requestPayloadStr = JSON.stringify(payload, null, 2);

        const response = await axios.post(metaUrl, payload);
        const responsePayloadStr = JSON.stringify(response.data, null, 2);

        // Update local event status to forwarded
        await db.whatsAppEvent.update({
          where: { id: eventRecord.id },
          data: { status: 'forwarded' }
        });

        // Log the success details
        await db.whatsAppEventLog.create({
          data: {
            eventId: eventRecord.id,
            requestPayload: requestPayloadStr,
            responsePayload: responsePayloadStr,
            status: 'success',
          }
        });

      } catch (metaErr: any) {
        const errorMsg = metaErr.response?.data?.error?.message || metaErr.message;
        console.error('[Event Tracker] Meta Conversions API request failed:', errorMsg);

        // Update local event status to failed
        await db.whatsAppEvent.update({
          where: { id: eventRecord.id },
          data: { status: 'failed' }
        });

        // Log the failure details
        await db.whatsAppEventLog.create({
          data: {
            eventId: eventRecord.id,
            requestPayload: metaErr.config?.data || null,
            responsePayload: JSON.stringify(metaErr.response?.data || null, null, 2),
            status: 'failed',
            errorMessage: errorMsg,
          }
        });
      }
    } else {
      // Feature flag disabled - mark as processed locally
      await db.whatsAppEvent.update({
        where: { id: eventRecord.id },
        data: { status: 'processed' }
      });
    }

    return { success: true, eventId: eventRecord.id };
  },

  // Specialized helpers to provide clean semantic methods
  async trackProductView(customerId: string | null, phone: string | null, productId: string, metadata?: any) {
    return this.track({
      eventName: 'Product Viewed',
      customerId,
      customerPhone: phone,
      productId,
      eventSource: 'web',
      metadata,
    });
  },

  async trackAddToCart(customerId: string | null, phone: string | null, productId: string, metadata?: any) {
    return this.track({
      eventName: 'Add To Cart',
      customerId,
      customerPhone: phone,
      productId,
      eventSource: 'web',
      metadata,
    });
  },

  async trackCheckoutStart(customerId: string | null, phone: string | null, orderId: string, metadata?: any) {
    return this.track({
      eventName: 'Checkout Started',
      customerId,
      customerPhone: phone,
      orderId,
      eventSource: 'web',
      metadata,
    });
  },

  async trackPurchase(customerId: string | null, phone: string | null, orderId: string, revenue: number, metadata?: any) {
    return this.track({
      eventName: 'Purchase Completed',
      customerId,
      customerPhone: phone,
      orderId,
      eventSource: 'web',
      metadata: { ...metadata, value: revenue, currency: 'INR' },
    });
  },

  async trackLead(customerId: string | null, phone: string | null, metadata?: any) {
    return this.track({
      eventName: 'Lead Created',
      customerId,
      customerPhone: phone,
      eventSource: 'web',
      metadata,
    });
  },

  async trackWhatsAppConversation(customerId: string | null, phone: string | null, metadata?: any) {
    return this.track({
      eventName: 'WhatsApp Chat Started',
      customerId,
      customerPhone: phone,
      eventSource: 'whatsapp',
      metadata,
    });
  }
};
