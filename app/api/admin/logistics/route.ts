/**
 * Admin Logistics API
 * 
 * GET  /api/admin/logistics              — Test connection & get provider info (scoped)
 * POST /api/admin/logistics              — Ship an order
 * GET  /api/admin/logistics?track=<num>  — Get tracking status
 * POST /api/admin/logistics (action=cancel) — Cancel a shipment
 */

import { NextResponse, NextRequest } from 'next/server';
import {
  shipOrder,
  getTrackingStatus,
  cancelShipment,
  testConnection,
  createReturnShipment,
  PROVIDER_PRESETS,
} from '@/lib/services/logistics';
import prisma from '@/lib/db';
import { requireAdmin, handleAuthError } from '@/lib/auth/rbac';
import { logAudit } from '@/lib/audit';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const addressSchema = z.object({
  name: z.string().default(''),
  address1: z.string().default(''),
  city: z.string().default(''),
  province: z.string().default(''),
  zip: z.string().default(''),
  country: z.string().default('India'),
  phone: z.string().optional(),
});

const itemSchema = z.object({
  title: z.string(),
  sku: z.string().optional(),
  quantity: z.number(),
  price: z.number(),
});

const shipPayloadSchema = z.object({
  action: z.literal('ship'),
  orderId: z.string().min(1, 'orderId is required'),
  items: z.array(itemSchema).optional(),
  address: addressSchema.optional(),
});

const cancelPayloadSchema = z.object({
  action: z.literal('cancel'),
  trackingNumber: z.string().min(1, 'trackingNumber is required'),
});

const returnPayloadSchema = z.object({
  action: z.literal('return'),
  returnId: z.string().min(1, 'returnId is required'),
  pickupAddress: addressSchema,
});

const logisticsActionSchema = z.discriminatedUnion('action', [
  shipPayloadSchema,
  cancelPayloadSchema,
  returnPayloadSchema,
]);

export async function GET(req: NextRequest) {
  try {
    await requireAdmin('LOGISTICS', 'view');

    const url = new URL(req.url);
    const trackingNumber = url.searchParams.get('track');
    const action = url.searchParams.get('action');
    const includeShipments = url.searchParams.get('includeShipments') === 'true';

    // Test connection
    if (action === 'test') {
      const result = await testConnection();
      return NextResponse.json(result);
    }

    // Get provider presets
    if (action === 'presets') {
      return NextResponse.json({ presets: PROVIDER_PRESETS });
    }

    // Track a shipment
    if (trackingNumber) {
      const status = await getTrackingStatus(trackingNumber);
      return NextResponse.json({ tracking: status });
    }

    // Default: return current logistics config summary (trimmed — no secrets leaked)
    const shop = await prisma.shop.findFirst({
      select: {
        shiprocketToken: true,
        shiprocketEmail: true,
        domain: true,
      },
    });

    const activeProvider = shop?.shiprocketToken ? 'shiprocket' : 'none';
    const baseUrl = activeProvider !== 'none' ? PROVIDER_PRESETS[activeProvider]?.baseUrl : '';

    // Build webhook URL
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    const host = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || 'localhost:3001';
    const webhookUrl = `${protocol}://${host}/api/webhooks/logistics`;

    let recentShipments: any[] = [];
    if (includeShipments) {
      const dbShipments = await prisma.shipment.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { order: { select: { shopifyOrderId: true } } },
      });
      recentShipments = dbShipments.map((s: any) => ({
        id: s.id,
        orderId: s.order?.shopifyOrderId,
        trackingNumber: s.trackingNumber,
        courier: s.courier,
        status: s.status,
        currentLocation: s.currentLocation,
        estimatedDelivery: s.estimatedDelivery,
        trackingUrl: s.trackingUrl,
        createdAt: s.createdAt,
      }));
    }

    return NextResponse.json({
      activeProvider,
      baseUrl,
      webhookUrl,
      recentShipments: includeShipments ? recentShipments : undefined,
    });
  } catch (error: any) {
    if (error instanceof Error && (error.message === '401' || error.message === '403')) {
      return handleAuthError(error);
    }
    console.error('[Logistics API] GET Error:', error.message);
    return NextResponse.json({ error: 'Failed to fetch logistics info' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin('LOGISTICS', 'edit');

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = logisticsActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request payload', details: parsed.error.format() },
        { status: 400 }
      );
    }

    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || undefined;
    const userAgent = req.headers.get('user-agent') || undefined;
    const data = parsed.data;

    // Ship an order
    if (data.action === 'ship') {
      const { orderId, items, address } = data;
      const result = await shipOrder(orderId, items || [], address || { name: '', address1: '', city: '', province: '', zip: '', country: 'India' });
      await logAudit({
        action: 'SHIPMENT_CREATED',
        module: 'LOGISTICS',
        targetId: orderId,
        metadata: { courier: (result as any)?.courier, trackingNumber: (result as any)?.trackingNumber },
        ipAddress,
        userAgent,
      });
      return NextResponse.json({ success: true, shipment: result });
    }

    // Cancel a shipment
    if (data.action === 'cancel') {
      const { trackingNumber } = data;
      const result = await cancelShipment(trackingNumber);
      await logAudit({
        action: 'SHIPMENT_CANCELLED',
        module: 'LOGISTICS',
        targetId: trackingNumber,
        metadata: { result },
        ipAddress,
        userAgent,
      });
      return NextResponse.json(result);
    }

    // Create return shipment
    if (data.action === 'return') {
      const { returnId, pickupAddress } = data;
      const result = await createReturnShipment(returnId, pickupAddress);
      await logAudit({
        action: 'RETURN_SHIPMENT_CREATED',
        module: 'LOGISTICS',
        targetId: returnId,
        metadata: { shipment: result },
        ipAddress,
        userAgent,
      });
      return NextResponse.json({ success: true, shipment: result });
    }

    return NextResponse.json({ error: 'Invalid action. Use: ship, cancel, or return' }, { status: 400 });
  } catch (error: any) {
    if (error instanceof Error && (error.message === '401' || error.message === '403')) {
      return handleAuthError(error);
    }
    console.error('[Logistics API] POST Error:', error.message);
    return NextResponse.json({ error: `Operation failed: ${error.message}` }, { status: 500 });
  }
}
