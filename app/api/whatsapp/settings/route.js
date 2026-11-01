/**
 * WhatsApp Order Notifications Settings Toggle API Endpoint
 * Location: app/api/whatsapp/settings/route.js
 *
 * Handles both boolean toggle keys (e.g. order_confirmed = true/false)
 * and string template mapping keys (e.g. template_abandoned_cart = "zica_cart_recovery_v1").
 */

import { NextResponse } from 'next/server';
import { getWhatsAppSetting, setWhatsAppSetting } from '@/lib/whatsapp/logger';
import { toggleDefault, CART_RECOVERY_DELAY_DEFAULTS } from '@/lib/whatsapp/automation-defaults';

export const dynamic = 'force-dynamic';

// Boolean toggle keys for enabling/disabling event notifications
const TOGGLE_KEYS = [
  'order_confirmed',
  'order_status',
  'order_shipped',
  'out_for_delivery',
  'order_delivered',
  'return_confirmed',
  'return_pickup_scheduled_enabled',
  'exchange_confirmed_enabled',
  'exchange_pickup_scheduled_enabled',
  'exchange_shipped_enabled',
  'cart_recovery_enabled',
  'cart_recovery_step2_enabled',
  'cart_recovery_step3_enabled',
  'cod_confirmation_enabled',
  'new_collection_enabled',
  'sale_alert_enabled',
  'restock_alert_enabled',
  'welcome_enabled',
  'account_created_enabled',
  'return_received_enabled',
  'exchange_delivered_enabled',
  'order_cancelled_enabled',
  'refund_initiated_enabled',
  'store_credit_earned_enabled',
  'store_coins_earned_enabled'
];

// String keys for template name mappings (admin can override which template
// is used for each event type)
const TEMPLATE_MAPPING_KEYS = [
  'template_order_confirmed',
  'template_order_shipped',
  'template_order_delivered',
  'template_abandoned_cart',
  'template_cart_followup',
  'template_cart_final',
  'template_order_tracking',
  'template_cod_confirmation',
  'template_order_status',
  'template_out_for_delivery',
  'template_return_confirmed',
  'template_return_pickup',
  'template_exchange_confirmed',
  'template_exchange_pickup',
  'template_exchange_shipped',
  'template_new_collection',
  'template_sale_alert',
  'template_restock_alert',
  'template_welcome',
  'template_account_created',
  'template_return_received',
  'template_exchange_delivered',
  'template_order_cancelled',
  'template_refund_initiated',
  'template_store_credit_earned',
  'template_store_coins_earned'
];

// Timing keys for delays (in minutes)
const TIMING_KEYS = [
  'delay_abandoned_cart_step1',
  'delay_abandoned_cart_step2',
  'delay_abandoned_cart_step3'
];

const ALL_KEYS = [...TOGGLE_KEYS, ...TEMPLATE_MAPPING_KEYS, ...TIMING_KEYS];

// Reminder 1 after 15 minutes, 2 after 4 hours, 3 after 7 days (matches the cart-recovery scheduler).
const TIMING_DEFAULTS = CART_RECOVERY_DELAY_DEFAULTS;

/**
 * GET — Retrieve all order notification toggle settings + template mappings
 */
export async function GET() {
  try {
    const settings = {};
    // Load toggle keys (default 'true', except lifecycle automations that wait for an approved template)
    for (const key of TOGGLE_KEYS) {
      const val = await getWhatsAppSetting(key, toggleDefault(key));
      settings[key] = val === 'true';
    }
    // Load template mapping keys (default to empty string = use built-in default)
    for (const key of TEMPLATE_MAPPING_KEYS) {
      const val = await getWhatsAppSetting(key, '');
      settings[key] = val;
    }
    // Load timing keys
    for (const key of TIMING_KEYS) {
      const val = await getWhatsAppSetting(key, TIMING_DEFAULTS[key]);
      settings[key] = val;
    }
    return NextResponse.json({ settings });
  } catch (error) {
    console.error('[WhatsApp Settings API] GET Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST — Save/update order notification toggle settings + template mappings
 */
export async function POST(req) {
  try {
    const body = await req.json();
    const updates = body.settings || body;

    if (!updates || typeof updates !== 'object') {
      return NextResponse.json({ error: 'Invalid settings body' }, { status: 400 });
    }

    for (const [key, val] of Object.entries(updates)) {
      if (!ALL_KEYS.includes(key)) continue;

      if (TOGGLE_KEYS.includes(key)) {
        // Boolean toggle
        await setWhatsAppSetting(key, val === true || val === 'true' ? 'true' : 'false');
      } else if (TIMING_KEYS.includes(key)) {
        // Delay settings
        await setWhatsAppSetting(key, String(val || TIMING_DEFAULTS[key]));
      } else {
        // String template name
        await setWhatsAppSetting(key, String(val || ''));
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[WhatsApp Settings API] POST Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
