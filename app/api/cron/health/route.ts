import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const logs = await prisma.syncLog.findMany({
      where: {
        action: {
          in: ["CRON_PING_ORDER_SYNC", "CRON_PING_WHATSAPP_SCHEDULER", "CRON_PING_SHIPMENT_SYNC"]
        }
      },
      orderBy: { createdAt: "desc" },
      take: 30
    });

    const lastOrderSync = logs.find((l: any) => l.action === "CRON_PING_ORDER_SYNC");
    const lastWhatsApp = logs.find((l: any) => l.action === "CRON_PING_WHATSAPP_SCHEDULER");
    const lastShipmentSync = logs.find((l: any) => l.action === "CRON_PING_SHIPMENT_SYNC");

    const now = Date.now();
    const orderSyncAgeMin = lastOrderSync ? Math.floor((now - new Date(lastOrderSync.createdAt).getTime()) / 60000) : null;
    const whatsAppAgeMin = lastWhatsApp ? Math.floor((now - new Date(lastWhatsApp.createdAt).getTime()) / 60000) : null;
    const shipmentSyncAgeMin = lastShipmentSync ? Math.floor((now - new Date(lastShipmentSync.createdAt).getTime()) / 60000) : null;

    return NextResponse.json({
      success: true,
      health: {
        orderSync: {
          lastPing: lastOrderSync?.createdAt || null,
          ageMinutes: orderSyncAgeMin,
          isHealthy: orderSyncAgeMin !== null && orderSyncAgeMin <= 30
        },
        whatsAppScheduler: {
          lastPing: lastWhatsApp?.createdAt || null,
          ageMinutes: whatsAppAgeMin,
          isHealthy: whatsAppAgeMin !== null && whatsAppAgeMin <= 30
        },
        shipmentSync: {
          lastPing: lastShipmentSync?.createdAt || null,
          ageMinutes: shipmentSyncAgeMin,
          isHealthy: shipmentSyncAgeMin !== null && shipmentSyncAgeMin <= 45
        }
      }
    });
  } catch (error: any) {
    console.error("[Cron Health API] Error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
