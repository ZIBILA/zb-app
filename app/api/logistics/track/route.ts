/**
 * GET /api/logistics/track — Track a shipment
 *
 * Accepts: ?awb=xxx or ?order_id=xxx
 * Returns tracking status, scan history, ETA.
 *
 * Provider-aware: the AWB may belong to Shiprocket or Delhivery; the shipment's
 * own provider decides which carrier API is queried, and the result is applied
 * through the shared status service so Shipment/Order stay consistent.
 */

import { NextResponse, NextRequest } from "next/server";
import prisma from "@/lib/db";
import { getTrackingStatus } from "@/lib/services/logistics";
import { resolveOutboundShipment } from "@/lib/services/orderTracking";
import { refreshShipmentFromCarrier } from "@/lib/services/shipmentStatusService";
import { carrierStatusLabel, normalizeCarrierStatus } from "@/lib/logistics/status";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const awb = req.nextUrl.searchParams.get("awb");
    const orderId = req.nextUrl.searchParams.get("order_id");

    if (!awb && !orderId) {
      return NextResponse.json({ error: "awb or order_id is required" }, { status: 400 });
    }

    let trackingNumber = awb;

    if (!trackingNumber && orderId) {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { delhivery_awb: true },
      });
      const resolved = await resolveOutboundShipment(orderId, order?.delhivery_awb);
      if (resolved.awbPending) {
        return NextResponse.json({ error: "Shipment booked — AWB not assigned yet" }, { status: 404 });
      }
      if (!resolved.awb) {
        return NextResponse.json({ error: "No shipment found for this order" }, { status: 404 });
      }
      trackingNumber = resolved.awb;
    }

    if (!trackingNumber) {
      return NextResponse.json({ error: "No tracking number available" }, { status: 404 });
    }

    const shipment = await prisma.shipment.findFirst({
      where: { OR: [{ trackingNumber }, { awb: trackingNumber }] },
      orderBy: { createdAt: "desc" },
    });

    let tracking;
    if (shipment) {
      const refreshed = await refreshShipmentFromCarrier(shipment.id);
      const latest = (await prisma.shipment.findUnique({ where: { id: shipment.id } })) || shipment;
      let events: unknown = [];
      try {
        events = JSON.parse(latest.events || "[]");
      } catch {
        events = [];
      }
      tracking = {
        status: latest.status,
        events,
        estimatedDelivery: latest.estimatedDelivery ? latest.estimatedDelivery.toISOString() : refreshed.tracking?.estimatedDelivery || null,
        location: latest.currentLocation || refreshed.tracking?.location || null,
        trackingUrl: latest.trackingUrl || refreshed.tracking?.trackingUrl || null,
      };
    } else {
      // Not one of our shipments (e.g. manual lookup) — read-only carrier query.
      const live = await getTrackingStatus(trackingNumber);
      tracking = {
        status: live.status,
        events: live.events,
        estimatedDelivery: live.estimatedDelivery,
        location: live.location,
        trackingUrl: live.trackingUrl,
      };
    }

    const code = normalizeCarrierStatus(tracking.status);

    return NextResponse.json({
      status: tracking.status,
      status_label: code === "unknown" ? tracking.status : carrierStatusLabel(code),
      scan_history: tracking.events,
      estimated_delivery: tracking.estimatedDelivery,
      current_location: tracking.location,
      tracking_url: tracking.trackingUrl,
      courier: shipment?.courier || null,
      awb: trackingNumber,
    });
  } catch (error: any) {
    console.error("[Logistics Track] Error:", error.message);
    return NextResponse.json({ error: "Failed to fetch tracking" }, { status: 500 });
  }
}
