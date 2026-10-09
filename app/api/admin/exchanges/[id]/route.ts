import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { enrichExchangeItem, enrichItemsWithSize } from '@/lib/enrichSize';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/exchanges/[id]
 * Fetch a single exchange request with full details including linked return and customer info
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const exchangeRequest = await prisma.exchangeRequest.findUnique({
      where: { id: params.id },
      include: {
        exchanges: {
          include: {
            originalProduct: true,
            newProduct: true,
          }
        },
        order: {
          include: {
            items: true,
            customer: true,
            shipments: true,
          }
        },
      },
    });

    if (!exchangeRequest) {
      const standalone = await prisma.exchange.findUnique({
        where: { id: params.id },
        include: {
          originalProduct: true,
          newProduct: true,
          order: {
            include: {
              items: true,
              customer: true,
              shipments: true
            }
          }
        }
      });
      
      if (!standalone) {
        return NextResponse.json({ error: 'Exchange request not found' }, { status: 404 });
      }

      // Map to ExchangeRequest structure synthetically
      const syntheticRequest = {
        id: standalone.id,
        orderId: standalone.orderId,
        customerId: standalone.order?.customerId || "",
        status: standalone.status.toLowerCase(),
        priceDifference: standalone.priceDifference || 0,
        paymentStatus: standalone.paymentStatus || 'not_required',
        createdAt: standalone.createdAt,
        updatedAt: standalone.updatedAt,
        reason: standalone.reason,
        returnRequestId: null,
        newShopifyOrderId: standalone.newOrderId,
        exchanges: [{
          id: standalone.id,
          orderId: standalone.orderId,
          originalProductId: standalone.originalProductId,
          newProductId: standalone.newProductId,
          status: standalone.status,
          priceDifference: standalone.priceDifference,
          createdAt: standalone.createdAt,
          updatedAt: standalone.updatedAt,
          paymentStatus: standalone.paymentStatus,
          newOrderId: standalone.newOrderId,
          exchangeRequestId: null,
          reason: standalone.reason,
          qcStatus: standalone.qcStatus,
          qcNotes: standalone.qcNotes,
          originalProduct: standalone.originalProduct,
          newProduct: standalone.newProduct
        }],
        order: standalone.order,
        linkedReturn: null
      };

      const enrichedExchanges = await Promise.all(
        (syntheticRequest.exchanges || []).map(enrichExchangeItem)
      );

      const enrichedOrderItems = syntheticRequest.order?.items
        ? await enrichItemsWithSize(syntheticRequest.order.items)
        : [];

      return NextResponse.json({
        exchangeRequest: {
          ...syntheticRequest,
          exchanges: enrichedExchanges,
          order: syntheticRequest.order
            ? { ...syntheticRequest.order, items: enrichedOrderItems }
            : null,
        }
      }, { status: 200 });
    }

    // Fetch the linked return request if it exists
    let linkedReturn = null;
    if (exchangeRequest.returnRequestId) {
      linkedReturn = await prisma.returnRequest.findUnique({
        where: { id: exchangeRequest.returnRequestId },
        include: {
          returns: { include: { product: true } },
        }
      });
    }

      const enrichedExchanges = await Promise.all(
        (exchangeRequest.exchanges || []).map(enrichExchangeItem)
      );

      const enrichedOrderItems = exchangeRequest.order?.items
        ? await enrichItemsWithSize(exchangeRequest.order.items)
        : [];

      const { liveReverseFields } = await import('@/lib/services/reverseShipmentExtras');
      const live = liveReverseFields({
        requestStatus: exchangeRequest.status,
        receivedAt: exchangeRequest.receivedAt,
        reverseAwb: exchangeRequest.reverseAwb,
        shipments: exchangeRequest.order?.shipments,
      });

      return NextResponse.json({
        exchangeRequest: {
          ...exchangeRequest,
          exchanges: enrichedExchanges,
          order: exchangeRequest.order
            ? { ...exchangeRequest.order, items: enrichedOrderItems }
            : null,
          linkedReturn,
          ...live,
        }
      }, { status: 200 });
  } catch (error: any) {
    console.error('Exchange Detail API Error:', error.message);
    return NextResponse.json({ error: 'Failed to fetch exchange' }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/exchanges/[id]
 * Update exchange status with full workflow:
 *   pending_approval → approved → received → qc_passed → new_order_created → shipped → completed
 *   pending_approval → rejected
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { status, trackingNumber, qcNotes, qcStatus } = body;
    const exchangeId = params.id;

    const validStatuses = ['approved', 'rejected', 'return_created', 'received', 'qc_passed', 'new_order_created', 'shipped', 'completed'];
    if (!status || !validStatuses.includes(status)) {
      return NextResponse.json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }, { status: 400 });
    }

    const exchangeRequest = await prisma.exchangeRequest.findUnique({
      where: { id: exchangeId },
      include: {
        exchanges: true,
      },
    });

    if (!exchangeRequest) {
      return NextResponse.json({ error: 'Exchange request not found' }, { status: 404 });
    }

    // State-machine guards: these steps have dedicated endpoints that perform the real work
    // (receipt confirmation, replacement order creation) and must not be skipped.
    const currentStatus = String(exchangeRequest.status || '').toLowerCase();
    if (['received', 'qc_passed'].includes(status)) {
      return NextResponse.json({ error: 'Use "Mark as Received & QC" (receive endpoint) to confirm the parcel.' }, { status: 400 });
    }
    if (status === 'new_order_created') {
      return NextResponse.json({ error: 'Use "Create Replacement Order" — it creates the G_E_ order and its shipment.' }, { status: 400 });
    }
    if ((status === 'shipped' || status === 'completed') && !['new_order_created', 'shipped'].includes(currentStatus)) {
      return NextResponse.json({ error: `Cannot mark "${currentStatus}" exchange as ${status}; the replacement order must be created first.` }, { status: 400 });
    }

    // Build update data
    const updateData: any = { status };

    const updatedRequest = await prisma.$transaction(async (tx: any) => {
      const updated = await tx.exchangeRequest.update({
        where: { id: exchangeId },
        data: updateData,
        include: {
          exchanges: { include: { originalProduct: true, newProduct: true } },
          order: { include: { customer: true } },
        },
      });

      // Update individual exchange items
      const exchangeItemStatus = status.toUpperCase();
      const exchangeUpdateData: any = { status: exchangeItemStatus };
      
      if (qcStatus) exchangeUpdateData.qcStatus = qcStatus;
      if (qcNotes) exchangeUpdateData.qcNotes = qcNotes;

      await tx.exchange.updateMany({
        where: { exchangeRequestId: exchangeId },
        data: exchangeUpdateData,
      });

      // Handle shipped status — create shipment record
      if (status === 'shipped' && trackingNumber) {
        const orderToShip = exchangeRequest.exchanges[0]?.newOrderId;
        if (orderToShip) {
          try {
            await tx.shipment.create({
              data: {
                orderId: orderToShip,
                trackingNumber,
                courier: 'Exchange Shipment',
                status: 'shipped',
              },
            });
          } catch (shipErr: any) {
            console.error('⚠️ Shipment creation failed:', shipErr.message);
          }
        }
      }

      return updated;
    });

    return NextResponse.json({ success: true, exchangeRequest: updatedRequest }, { status: 200 });
  } catch (error: any) {
    console.error('Admin Exchange API Error:', error);
    return NextResponse.json({ error: 'Failed to update exchange request' }, { status: 500 });
  }
}
