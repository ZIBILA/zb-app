/**
 * POST /api/logistics/create-shipment
 * Idempotent: returns existing shipment if already booked.
 * Books Shiprocket (create + AWB) from local Order.
 */

import { REVERSE_SHIPMENT_TYPES } from "@/lib/logistics/status";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { shipOrder } from "@/lib/services/logistics";
import { requireAdmin, handleAuthError } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

const inFlightBookings = new Set<string>();

export async function POST(req: Request) {
  let orderIdForLock: string | null = null;
  try {
    await requireAdmin("LOGISTICS", "edit");

    const body = await req.json();
    const { order_id, name, address1, city, province, zip, country, phone } = body;

    if (!order_id) {
      return NextResponse.json({ error: "order_id is required" }, { status: 400 });
    }

    if (inFlightBookings.has(order_id)) {
      return NextResponse.json(
        { error: "Shipment booking is already in progress for this order. Please wait a moment." },
        { status: 409 }
      );
    }
    inFlightBookings.add(order_id);
    orderIdForLock = order_id;

    const existingShipment = await prisma.shipment.findFirst({
      where: {
        orderId: order_id,
        NOT: { type: { in: [...REVERSE_SHIPMENT_TYPES] } },
        status: { notIn: ["cancelled", "canceled", "rto", "rto_delivered", "lost"] },
      },
      orderBy: { createdAt: "desc" },
    });

    const existingTn = existingShipment?.trackingNumber || "";
    const isFake =
      existingTn.startsWith("MOCK") ||
      String(existingShipment?.courier || "").toLowerCase().includes("mock");
    if (existingShipment && !isFake && (existingShipment.awb || existingTn)) {
      return NextResponse.json({
        awb: existingShipment.awb || existingShipment.trackingNumber,
        label_url: existingShipment.labelUrl || existingShipment.trackingUrl,
        success: true,
        existing: true,
      });
    }

    const order = await prisma.order.findUnique({
      where: { id: order_id },
      include: {
        items: true,
        customer: { select: { name: true, email: true, phone: true } },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const items = order.items.map((i: any) => ({
      title: i.title,
      sku: i.sku || undefined,
      quantity: i.quantity,
      price: i.price,
    }));

    const address = {
      name: name || order.customer?.name || "Customer",
      address1: address1 || "",
      city: city || "",
      province: province || "",
      zip: zip || "",
      country: country || "India",
      phone: phone || order.customer?.phone || "",
      email: order.customer?.email || "",
    };

    if (!address1 && order.shippingAddress) {
      try {
        const parsed = JSON.parse(order.shippingAddress);
        address.name = parsed.name || address.name;
        address.address1 = parsed.street || parsed.address1 || "";
        address.city = parsed.city || "";
        address.province = parsed.state || parsed.province || "";
        address.zip = parsed.zip || parsed.pincode || "";
        address.country = parsed.country || "India";
        address.phone = parsed.phone || order.customer?.phone || "";
        address.email = parsed.email || address.email;
      } catch {
        /* use provided */
      }
    }

    const result = await shipOrder(order_id, items, address);

    return NextResponse.json({
      awb: result.awb || null,
      tracking_number: result.trackingNumber || null,
      shipment_id: result.shipmentId || null,
      label_url: result.trackingUrl,
      courier: result.courier,
      success: true,
    });
  } catch (error: any) {
    if (error instanceof Error && (error.message === "401" || error.message === "403")) {
      return handleAuthError(error);
    }
    console.error("[Logistics] Create shipment error:", error.message);
    return NextResponse.json(
      { error: error.message || "Failed to create shipment. Please try again." },
      { status: 500 }
    );
  } finally {
    if (orderIdForLock) {
      inFlightBookings.delete(orderIdForLock);
    }
  }
}
