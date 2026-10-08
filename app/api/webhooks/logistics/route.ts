/**
 * POST /api/webhooks/logistics — Delhivery/Shiprocket Webhook Handler
 * 
 * Validates signature, uses webhook_events table for idempotency,
 * updates shipment status, and triggers push notifications.
 * 
 * NOT protected by session auth — uses signature validation.
 */

import { NextResponse, NextRequest } from 'next/server';
import prisma from '@/lib/db';
import { validateWebhookSignature, resolveWebhookSecret } from '@/lib/services/logistics';
import { delhiveryRawStatus, normalizeCarrierStatus } from '@/lib/logistics/status';

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

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    // Parse payload early to assist provider detection
    let earlyPayload: { Shipment?: unknown } | null = null;
    try { earlyPayload = JSON.parse(rawBody) as { Shipment?: unknown }; } catch {}

    // Detect provider: Delhivery sends x-delhivery-signature or nested Shipment object
    const isDelhivery =
      !!req.headers.get('x-delhivery-signature') ||
      !!earlyPayload?.Shipment;

    const provider = isDelhivery ? 'delhivery' : 'generic';

    // Signature precedence: for Delhivery, x-delhivery-signature MUST take priority
    // over stray authorization header
    const signature = (isDelhivery
      ? (req.headers.get('x-delhivery-signature') ||
         req.headers.get('x-webhook-signature') ||
         req.headers.get('authorization') || '')
      : (req.headers.get('authorization') ||
         req.headers.get('x-webhook-signature') ||
         req.headers.get('x-shiprocket-signature') ||
         req.headers.get('x-delhivery-signature') || '')).trim();

    // Validate webhook signature using the unified secret resolver
    const { secret, source } = await resolveWebhookSecret();
    const mode = (process.env.DELHIVERY_WEBHOOK_MODE || 'token').trim().toLowerCase();

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      '127.0.0.1';

    if (secret && signature) {
      const isValid = validateWebhookSignature(rawBody, signature, secret, provider);
      if (!isValid) {
        const secretTail = secret ? secret.slice(-4) : '';
        const sigHead = signature ? signature.slice(0, 12) : '';
        console.warn(`[Webhook] Signature mismatch. provider=${provider}, mode=${mode}, source=${source}, secret tail=****${secretTail}, token head=${sigHead}..., rawBody length=${rawBody.length}`);
        
        const debugPayload = `Provider: ${provider} | Mode: ${mode} | Secret source: ${source} | Secret tail: ****${secretTail} | Received token head: ${sigHead}... | IP: ${ip} | RawBody length: ${rawBody.length}`;
        await logToWebhookLogs('delhivery', debugPayload, 'unauthorized_signature_mismatch');
        return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
      }
    } else if (!signature && secret) {
      // Secret configured but no signature sent — reject
      const secretTail = secret ? secret.slice(-4) : '';
      console.warn(`[Webhook] No signature provided from IP ${ip} at ${new Date().toISOString()} but webhook secret is configured. provider=${provider}, mode=${mode}, source=${source}, secret tail=****${secretTail}, rawBody length=${rawBody.length}`);
      
      const debugPayload = `Provider: ${provider} | Mode: ${mode} | Secret source: ${source} | Secret tail: ****${secretTail} | IP: ${ip} | RawBody length: ${rawBody.length}`;
      await logToWebhookLogs('delhivery', debugPayload, 'unauthorized_missing_signature');
      return NextResponse.json({ error: 'Missing webhook signature' }, { status: 401 });
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
    rawStatus = rawStatus || (shipmentData.current_status_id !== undefined ? String(shipmentData.current_status_id) : undefined) ||
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
    const shipment = await prisma.shipment.findFirst({
      where: {
        OR: [
          { trackingNumber },
          { awb: trackingNumber },
          { order: { delhivery_awb: trackingNumber } },
        ],
      },
      include: { order: { include: { customer: true } } },
    });

    // FIX 1: Graceful handling for unknown AWBs — return 200 instead of 404
    if (!shipment) {
      console.warn(`[Webhook] No shipment found for AWB: ${trackingNumber} — skipping gracefully`);
      // Mark event as processed to avoid retries
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { processed: true, processedAt: new Date() },
      });
      // Log to webhook_logs with skipped status
      await logToWebhookLogs('delhivery', rawBody, 'skipped_unknown_awb');
      return NextResponse.json({ success: true, message: 'AWB not tracked' }, { status: 200 });
    }

    // Use central tracking helper to update shipment, order, and reverse requests
    const { updateOrderTracking } = await import('@/lib/delhivery/tracking');
    await updateOrderTracking({
      awb: trackingNumber,
      shopifyOrderId: shipmentData.ReferenceNo || '',
      status: rawStatus,
      statusDateTime: timestamp,
      statusType: description,
      location,
      instructions: description,
      events: scanEvents,
      estimatedDelivery,
    });

    // Mark event processed
    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { processed: true, processedAt: new Date() },
    });

    // Log successful processing to webhook_logs
    await logToWebhookLogs('delhivery', rawBody, 'processed');

    console.log(`[Webhook] ✅ Processed tracking update for AWB ${trackingNumber} → ${normalizedStatus}`);

    // RTO side effects (SKU restore, affiliate reversal, RTO tag) are applied centrally
    // by applyShipmentStatusUpdate via updateOrderTracking.

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
