import crypto from 'crypto';

export function verifyShopifyWebhook(body: string, hmacHeader: string): boolean {
  // Try verifying with SHOPIFY_API_SECRET (app's client secret used for API-registered webhooks)
  if (process.env.SHOPIFY_API_SECRET) {
    const hash = crypto
      .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
      .update(body, 'utf8')
      .digest('base64');
    if (hash === hmacHeader) return true;
  }

  // Fallback to SHOPIFY_WEBHOOK_SECRET (used for manually configured webhooks in shopify admin)
  if (process.env.SHOPIFY_WEBHOOK_SECRET) {
    const hash = crypto
      .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
      .update(body, 'utf8')
      .digest('base64');
    if (hash === hmacHeader) return true;
  }
  
  console.error('[Shopify Webhooks] Webhook validation failed: signature mismatch or secret not configured.');
  return false;
}

import { getShopConfig, adminUrl, headers } from './shopify-admin';

// Register webhooks with Shopify Admin API
export async function registerWebhooks() {
  try {
    const config = await getShopConfig();
    if (!config.accessToken) {
      console.warn('[Webhooks] Cannot register webhooks: No access token found');
      return;
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.zicabella.com';
    const targetAddress = `${appUrl}/api/shopify/webhooks`;

    const topics = [
      'orders/create',
      'orders/updated',
      'orders/fulfilled',
      'orders/cancelled',
      'orders/paid',
      'fulfillments/create',
      'fulfillments/update',
      'refunds/create',
      'inventory_levels/update',
      // Storefront catalogue: product / collection edits must reach the live site immediately.
      'products/create',
      'products/update',
      'products/delete',
      'collections/create',
      'collections/update',
      'collections/delete',
    ];

    // Fetch existing webhooks
    const headersList = await headers();
    const listUrl = await adminUrl('webhooks.json');
    const listRes = await fetch(listUrl, { headers: headersList });
    if (!listRes.ok) {
      console.error('[Webhooks] Failed to fetch existing webhooks:', await listRes.text());
      return;
    }
    const { webhooks: existingWebhooks } = await listRes.json();
    console.log(`[Webhooks] Found ${existingWebhooks?.length || 0} existing webhooks on Shopify.`);

    for (const topic of topics) {
      const exists = existingWebhooks?.some(
        (w: any) => w.topic === topic && w.address === targetAddress
      );

      if (!exists) {
        console.log(`[Webhooks] Registering webhook for topic ${topic} to ${targetAddress}...`);
        const postUrl = await adminUrl('webhooks.json');
        const postRes = await fetch(postUrl, {
          method: 'POST',
          headers: headersList,
          body: JSON.stringify({
            webhook: {
              topic,
              address: targetAddress,
              format: 'json'
            }
          })
        });

        if (postRes.ok) {
          const newWebhook = await postRes.json();
          console.log(`[Webhooks] Registered topic ${topic} successfully. ID: ${newWebhook.webhook.id}`);
        } else {
          console.error(`[Webhooks] Failed to register topic ${topic}:`, await postRes.text());
        }
      } else {
        console.log(`[Webhooks] Webhook for topic ${topic} already exists.`);
      }
    }
  } catch (error) {
    console.error('[Webhooks] Error registering webhooks:', error);
  }
}
