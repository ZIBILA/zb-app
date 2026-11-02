import { NextRequest, NextResponse } from "next/server";
import { reconcileRazorpayPayments } from "@/lib/services/razorpayReconcileService";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron: /api/cron/reconcile-razorpay — payment-driven reconciliation.
 *
 * Starts from Razorpay's captured payments (last 3 h) rather than from local
 * pending rows, so an order that /complete never finished and the (disabled)
 * webhook never confirmed is marked paid within 15 minutes instead of hours.
 * Scheduled by vercel.json and .github/workflows/razorpay-reconcile.yml (the
 * GitHub pings are the ones that actually fire on the DigitalOcean deployment).
 * Auth and SyncLog ping mirror /api/cron/sync-pending-orders.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get("secret");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && secret !== cronSecret && req.headers.get("Authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await reconcileRazorpayPayments();
    // The email body is for the admins' inbox, not the JSON (it can get large).
    const { adminEmailHtml: _html, ...summary } = result;
    return NextResponse.json({ success: true, ...summary });
  } catch (error: any) {
    console.error("[Reconcile Razorpay Cron] Error:", error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
