import prisma from '../db';
import { sendTrackingPushNotification } from './notifications';
import { isReverseShipmentType, normalizeCarrierStatus } from '../logistics/status';
import { applyShipmentStatusUpdate, type ShipmentScanEvent } from '../services/shipmentStatusService';

export async function updateOrderTracking({
  awb,
  shopifyOrderId,
  status,
  statusDateTime,
  statusType,
  location,
  instructions,
  events: carrierEvents,
  estimatedDelivery,
}: {
  awb: string;
  shopifyOrderId: string;
  status: string;
  statusDateTime: string;
  statusType: string;
  location: string;
  instructions: string;
  /** Full scan history when the carrier supplies it (Shiprocket webhooks do). */
  events?: ShipmentScanEvent[];
  estimatedDelivery?: string | null;
}) {
  if (!awb && !shopifyOrderId) {
    console.warn('[Delhivery Tracking] Missing both AWB and order reference.');
    return;
  }

  // Idempotency check using WebhookEvent table
  const eventKey = `${awb}_${status}_${statusDateTime}`;
  const existingEvent = await prisma.webhookEvent.findFirst({
    where: {
      source: 'delhivery',
      payload: { contains: eventKey }
    }
  });

  if (existingEvent?.processed) {
    console.log(`[Delhivery Tracking] Event already processed: ${eventKey}`);
    return;
  }

  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      source: 'delhivery',
      eventType: status,
      payload: JSON.stringify({ awb, shopifyOrderId, status, statusDateTime, location, instructions, eventKey }),
      processed: false
    }
  });

  try {
    // 1. Resolve target Shipment BY AWB FIRST
    let shipment = await prisma.shipment.findFirst({
      where: {
        OR: [
          { awb },
          { trackingNumber: awb }
        ]
      },
      include: { order: true }
    });

    // 2. Fallback to ReferenceNo -> Order if no AWB match exists
    let order = shipment?.order;
    if (!order && shopifyOrderId) {
      order = await prisma.order.findFirst({
        where: {
          OR: [
            { shopifyOrderId },
            { id: shopifyOrderId }
          ]
        }
      });
    }

    if (!shipment && !order) {
      console.warn(`[Delhivery Tracking] Neither shipment nor order found for AWB: ${awb}, ReferenceNo: ${shopifyOrderId}`);
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { processed: true, processedAt: new Date() }
      });
      return;
    }

    // Create the shipment row if only the order matched (webhook arrived before we stored the AWB)
    if (!shipment && order) {
      shipment = await prisma.shipment.create({
        data: {
          orderId: order.id,
          awb,
          trackingNumber: awb,
          courier: 'Delhivery',
          status: normalizeCarrierStatus(status) === 'unknown' ? status : normalizeCarrierStatus(status),
          type: 'outbound',
          currentLocation: location,
          trackingUrl: `https://www.delhivery.com/track/package/${awb}`,
          events: JSON.stringify([])
        },
        include: { order: true }
      });
    }

    // Single place that applies the update to Shipment + Order (canonical status,
    // RTO tag, COD settlement, event log). Reverse shipments only touch the Shipment.
    const applied = shipment
      ? await applyShipmentStatusUpdate({
          shipmentId: shipment.id,
          rawStatus: status,
          location,
          timestamp: statusDateTime,
          description: instructions || statusType || status,
          events: carrierEvents,
          estimatedDelivery,
        })
      : null;
    const canonicalStatus = applied?.status ?? normalizeCarrierStatus(status);

    // 3. Handle routing based on shipment type
    const isReverse = applied?.isReverse ?? isReverseShipmentType(shipment?.type);

    if (isReverse) {
      // Reverse pickup: applyShipmentStatusUpdate already advanced the Shipment and the
      // linked return/exchange request (by reverse AWB). The customer's original
      // Order.deliveryStatus is intentionally untouched.
      console.log(`[Delhivery Tracking] Reverse pickup AWB ${awb} → ${canonicalStatus}`);

    } else if (order || shipment?.orderId) {
      // Outbound shipment: Order.deliveryStatus / RTO tag / COD settlement are already
      // applied by applyShipmentStatusUpdate. Only exchange linkage remains here.
      const activeOrderId = order?.id || shipment?.orderId;
      if (activeOrderId) {
        // If outbound shipment is tied to an exchange replacement order, update exchange request tracking
        const linkedExchange = await prisma.exchangeRequest.findFirst({
          where: {
            OR: [
              { replacementOrderId: activeOrderId },
              ...(order?.shopifyOrderId ? [{ newShopifyOrderId: order.shopifyOrderId }] : [])
            ]
          }
        });

        if (linkedExchange) {
          if (canonicalStatus === 'delivered' && linkedExchange.status === 'shipped') {
            await prisma.exchangeRequest.update({
              where: { id: linkedExchange.id },
              data: { status: 'completed' }
            });
          } else if (
            ['picked_up', 'in_transit', 'out_for_delivery'].includes(canonicalStatus) &&
            linkedExchange.status === 'new_order_created'
          ) {
            await prisma.exchangeRequest.update({
              where: { id: linkedExchange.id },
              data: { status: 'shipped' }
            });
          }
        }
      }
    }

    // Mark event processed
    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { processed: true, processedAt: new Date() }
    });

    // Trigger push notification flow
    await sendTrackingPushNotification(awb, status);
  } catch (err: any) {
    console.error('[Delhivery Tracking Error]', err);
  }
}

