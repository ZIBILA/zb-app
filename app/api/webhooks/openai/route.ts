import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/webhooks/openai — OpenAI Webhook Receiver
 *
 * Receives and validates webhook payloads from OpenAI for:
 *   - Model usage updates
 *   - Rate limit notifications
 *   - API key status changes
 *   - Batch job completions
 *
 * Validates the payload using OPENAI_WEBHOOK_SECRET if configured.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = req.headers.get("x-openai-signature") || req.headers.get("x-webhook-signature") || "";

    // Validate webhook signature if secret is configured
    const webhookSecret = process.env.OPENAI_WEBHOOK_SECRET;
    if (webhookSecret && webhookSecret !== "none") {
      const expectedSignature = crypto
        .createHmac("sha256", webhookSecret)
        .update(body)
        .digest("hex");

      if (signature !== expectedSignature && signature !== `sha256=${expectedSignature}`) {
        console.error("[OpenAI Webhook] Invalid signature");
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
    }

    let payload: any;
    try {
      payload = JSON.parse(body);
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const eventType = payload.type || payload.event || "unknown";
    console.log(`[OpenAI Webhook] Received event: ${eventType}`);

    // Handle different event types
    switch (eventType) {
      case "model.updated":
        console.log("[OpenAI Webhook] Model update notification received:", payload.data);
        break;

      case "rate_limit.warning":
        console.warn("[OpenAI Webhook] Rate limit warning:", payload.data);
        break;

      case "api_key.revoked":
        console.error("[OpenAI Webhook] API Key revoked! Immediate action required:", payload.data);
        break;

      case "batch.completed":
        console.log("[OpenAI Webhook] Batch job completed:", payload.data?.id);
        break;

      case "fine_tuning.job.succeeded":
        console.log("[OpenAI Webhook] Fine-tuning job succeeded:", payload.data?.id);
        break;

      case "fine_tuning.job.failed":
        console.error("[OpenAI Webhook] Fine-tuning job failed:", payload.data);
        break;

      case "response.completed":
        console.log("[OpenAI Webhook] Response completed:", payload.data?.id);
        break;

      default:
        console.log(`[OpenAI Webhook] Unhandled event type: ${eventType}`);
    }

    // Log webhook event to database for audit trail
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "WebhookLog" ("id", "source", "event", "payload", "createdAt") VALUES ($1, $2, $3, $4, NOW())`,
        crypto.randomUUID(),
        "openai",
        eventType,
        JSON.stringify(payload).substring(0, 5000)
      );
    } catch (dbErr) {
      // WebhookLog table may not exist yet — that's fine, just log
      console.warn("[OpenAI Webhook] Could not log to database (table may not exist):", (dbErr as any).message?.substring(0, 100));
    }

    return NextResponse.json({
      success: true,
      event: eventType,
      received: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[OpenAI Webhook] Error:", error);
    return NextResponse.json(
      { error: error.message || "Webhook processing failed" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/webhooks/openai — Health check / verification endpoint
 * 
 * OpenAI may ping this endpoint to verify the webhook URL is live.
 * Returns a 200 OK with the webhook status.
 */
export async function GET() {
  return NextResponse.json({
    status: "active",
    service: "zica-bella-openai-webhook",
    timestamp: new Date().toISOString(),
    webhook_url: `${process.env.NEXT_PUBLIC_APP_URL || "https://app.zicabella.com"}/api/webhooks/openai`,
  });
}
