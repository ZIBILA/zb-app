/**
 * POST /api/webhooks/logistics — Shiprocket (and legacy carrier) webhook handler
 * 
 * Validates signature, uses webhook_events table for idempotency,
 * updates shipment status, and triggers push notifications.
 * 
 * NOT protected by session auth — uses signature validation.
 */

import crypto from 'crypto';
import { NextResponse, NextRequest } from 'next/server';
import prisma from '@/lib/db';
import { validateWebhookSignature, resolveWebhookSecret } from '@/lib/services/logistics';
import { delhiveryRawStatus, normalizeCarrierStatus, REVERSE_SHIPMENT_TYPES } from '@/lib/logistics/status';

export const dynamic = 'force-dynamic';

function normalizeStatus(rawStatus: string): string {
  const canonical = normalizeCarrierStatus(rawStatus);
  return canonical !== 'unknown' ? canonical : rawStatus.toLowerCase().replace(/\s+/g, '_');
}

interface ShipmentDetail {
  AWB?: string;
  tracking_number?: string;
  awb?: string;
  waybill?: string;
  shipment_id?: string;
  ReferenceNo?: string;
  status?: string;
  current_status?: string;
  shipment_status?: string;
  timestamp?: string;
  event_time?: string;
  scanned_date?: string;
  location?: string;
  current_location?: string;
  city?: string;
  description?: string;
  activity?: string;
  status_description?: string;
  Status?: {
    Status?: string;
    StatusType?: string;
    StatusDateTime?: string;
    PickUpDate?: string;
    StatusLocation?: string;
    Instructions?: string;
  };
  estimated_delivery?: string;
  etd?: string;
  // Shiprocket webhook fields
  current_timestamp?: string;
  current_status_id?: number | string;
  shipment_status_id?: number | string;
  courier_name?: string;
  is_return?: number | string | boolean;
  scans?: Array<{
    date?: string;
    activity?: string;
    location?: string;
    'sr-status'?: string | number;
    'sr-status-label'?: string;
    status?: string;
  }>;
}

interface WebhookPayload extends ShipmentDetail {
  Shipment?: ShipmentDetail;
}

/**
 * Persist logistics webhook for audit via existing WebhookEvent model
 * (replaces missing raw `webhook_logs` table that spammed production logs).
 */
async function logToWebhookLogs(
  source: string,
  payload: string,
  status: string
): Promise<void> {
  try {
    await prisma.webhookEvent.create({
      data: {
        source,
        eventType: `logistics.${status}`,
        payload: payload.substring(0, 10000),
        processed: status === 'processed' || status === 'success',
        processedAt: status === 'processed' || status === 'success' ? new Date() : null,
      },
    });
  } catch (err) {
    // Non-fatal — never fail the webhook over audit logging
    if (process.env.NODE_ENV !== 'production') {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn('[Webhook] Could not write WebhookEvent:', errMsg.substring(0, 150));
    }
  }
}

/** Constant-time comparison of a presented token (optionally Bearer/Token-prefixed) with the secret. */
function tokenMatchesSecret(presented: string, secret: string): boolean {
  const clean = presented.replace(/^Bearer\s+/i, '').replace(/^Token\s+/i, '').trim();
  const a = crypto.createHash('sha256').update(clean).digest();
  const b = crypto.createHash('sha256').update(secret.trim()).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    // Parse payload early to assist provider detection
    let earlyPayload: { Shipment?: unknown } | null = null;
    try { earlyPayload = JSON.parse(rawBody) as { Shipment?: unknown }; } catch {}

    const provider = 'shiprocket';

    // Shiprocket sends the configured token verbatim in `x-api-key`. HMAC-style signatures are
    // still accepted for other / legacy carriers.
    const candidates = [
      req.headers.get('x-api-key'),
      req.headers.get('authorization'),
      req.headers.get('x-shiprocket-token'),
      req.headers.get('x-webhook-signature'),
      req.headers.get('x-shiprocket-signature'),
    ]
      .map((v) => (v || '').trim())
      .filter(Boolean);

    const { secret, source } = await resolveWebhookSecret();

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      '127.0.0.1';

    // Fail closed: a webhook that can change order / return state must never run unauthenticated.
    if (!secret) {
      console.error(`[Webhook] Logistics webhook rejected from ${ip}: no webhook secret configured (set SHIPROCKET_WEBHOOK_SECRET).`);
      await logToWebhookLogs('shiprocket', `No webhook secret configured | IP: ${ip}`, 'rejected_no_secret');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
    }

    if (candidates.length === 0) {
      console.warn(`[Webhook] No credential provided from IP ${ip} at ${new Date().toISOString()}. source=${source}`);
      await logToWebhookLogs('shiprocket', `Missing credential | IP: ${ip} | RawBody length: ${rawBody.length}`, 'unauthorized_missing_signature');
      return NextResponse.json({ error: 'Missing webhook credential' }, { status: 401 });
    }

    const authenticated = candidates.some(
      (c) => tokenMatchesSecret(c, secret) || validateWebhookSignature(rawBody, c, secret, provider)
    );
    if (!authenticated) {
      console.warn(`[Webhook] Credential mismatch. provider=${provider}, source=${source}, IP=${ip}, rawBody length=${rawBody.length}`);
      await logToWebhookLogs('shiprocket', `Credential mismatch | Secret source: ${source} | IP: ${ip} | RawBody length: ${rawBody.length}`, 'unauthorized_signature_mismatch');
      return NextResponse.json({ error: 'Invalid webhook credential' }, { status: 401 });
    }

    // Parse the payload
    let payload: WebhookPayload;
    try {
      payload = JSON.parse(rawBody) as WebhookPayload;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    // Handle nested Shipment structure (Delhivery default format)
    let shipmentData: ShipmentDetail = payload;
    if (payload.Shipment) {
      shipmentData = payload.Shipment;
    }

    // Normalize fields
    const trackingNumber = shipmentData.AWB || shipmentData.tracking_number || shipmentData.awb || shipmentData.waybill || shipmentData.shipment_id || shipmentData.ReferenceNo;
    
    let rawStatus = shipmentData.status || shipmentData.current_status || shipmentData.shipment_status;
    let timestamp = shipmentData.timestamp || shipmentData.event_time || shipmentData.scanned_date;
    let location = shipmentData.location || shipmentData.current_location || shipmentData.city || '';
    let description = shipmentData.description || shipmentData.activity || shipmentData.status_description || '';

    // Handle nested Status structure from default payload
    if (shipmentData.Status) {
      rawStatus =
        rawStatus ||
        delhiveryRawStatus(shipmentData.Status.Status, shipmentData.Status.StatusType) ||
        shipmentData.Status.StatusType;
      timestamp = timestamp || shipmentData.Status.StatusDateTime || shipmentData.Status.PickUpDate;
      location = location || shipmentData.Status.StatusLocation || '';
      description = description || shipmentData.Status.Instructions || '';
    }

    // Shiprocket: numeric status id when the text is missing; ISO-ish timestamp field name differs.
    // Only `shipment_status_id` is in the id space we map. `current_status_id` is a different
    // (tracking-level) numbering and would be misread, so it is never used as a fallback.
    rawStatus = rawStatus ||
      (shipmentData.shipment_status_id !== undefined ? String(shipmentData.shipment_status_id) : undefined);
    timestamp = timestamp || shipmentData.current_timestamp;
    const scanEvents = (shipmentData.scans || []).map((sc) => ({
      status: sc.activity || sc['sr-status-label'] || sc.status || '',
      location: sc.location || '',
      timestamp: sc.date || '',
      description: sc.activity || sc['sr-status-label'] || '',
    }));
    if (!location && scanEvents.length > 0) location = scanEvents[scanEvents.length - 1].location;

    timestamp = timestamp || new Date().toISOString();
    const estimatedDelivery = shipmentData.estimated_delivery || shipmentData.etd || null;

    if (!trackingNumber) {
      return NextResponse.json({ error: 'Missing tracking_number in payload' }, { status: 400 });
    }
    if (!rawStatus) {
      return NextResponse.json({ error: 'Missing status in payload' }, { status: 400 });
    }

    const normalizedStatus = normalizeStatus(rawStatus);
    const eventId = `${trackingNumber}_${rawStatus}_${timestamp}`;

    // Idempotency: check webhook_events table
    const existingEvent = await prisma.webhookEvent.findFirst({
      where: {
        source: 'delhivery',
        payload: { contains: eventId.slice(0, 50) },
      },
    });

    if (existingEvent?.processed) {
      console.log(`[Webhook] Event already processed: ${normalizedStatus} for ${trackingNumber}`);
      return NextResponse.json({ success: true, message: 'Already processed' });
    }

    // Insert event record
    const webhookEvent = await prisma.webhookEvent.create({
      data: {
        source: 'delhivery',
        eventType: normalizedStatus,
        payload: rawBody,
        processed: false,
      },
    });

    // FIX 2: Expanded AWB field lookup — check trackingNumber and awb on Shipment,
    // plus delhivery_awb on the related Order, to handle AWBs stored under any column.
    const includeOrder = { order: { include: { customer: true } } } as const;
    let shipment = await prisma.shipment.findFirst({
      where: { OR: [{ awb: trackingNumber }, { trackingNumber }] },
      include: includeOrder,
    });
    if (!shipment) {
      // Legacy: AWB stored only on the order. Never resolve to a return / exchange pickup.
      shipment = await prisma.shipment.findFirst({
        where: {
          order: { delhivery_awb: trackingNumber },
          NOT: { type: { in: [...REVERSE_SHIPMENT_TYPES] } },
        },
        orderBy: { createdAt: 'desc' },
        include: includeOrder,
      });
    }

    // FIX 1: Graceful handling for unknown AWBs — return 200 instead of 404
    if (!shipment) {
      console.warn(`[Webhook] No shipment found for AWB: ${trackingNumber} — skipping gracefully`);
      // Mark event as processed to avoid retries
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { processed: true, processedAt: new Date() },
      });
      // Log to webhook_logs with skipped status
      await logToWebhookLogs('shiprocket', rawBody, 'skipped_unknown_awb');
      return NextResponse.json({ success: true, message: 'AWB not tracked' }, { status: 200 });
    }

    // Central status update (order + reverse request side-effects)
    const { applyShipmentStatusUpdate } = await import('@/lib/services/shipmentStatusService');
    await applyShipmentStatusUpdate({
      shipmentId: shipment.id,
      rawStatus,
      location,
      estimatedDelivery: estimatedDelivery || null,
      events: scanEvents,
    });

    // Mark event processed
    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { processed: true, processedAt: new Date() },
    });

    // Log successful processing to webhook_logs
    await logToWebhookLogs('shiprocket', rawBody, 'processed');

    console.log(`[Webhook] ✅ Processed tracking update for AWB ${trackingNumber} → ${normalizedStatus}`);

    // RTO side effects (SKU restore, affiliate reversal, RTO tag) are applied centrally
    // by applyShipmentStatusUpdate.

    return NextResponse.json({
      success: true,
      awb: trackingNumber,
      status: normalizedStatus,
    });
  } catch (error) {
    console.error('[Webhook] Logistics webhook error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

/**
 * GET /api/webhooks/logistics — Health check
 */
export async function GET() {
  return NextResponse.json({
    status: 'active',
    message: 'Zica Bella Logistics Webhook endpoint is live.',
    supported_events: ['tracking_update', 'status_change', 'delivery_confirmation'],
    timestamp: new Date().toISOString(),
  });
}
