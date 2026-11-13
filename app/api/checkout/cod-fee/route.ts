import { NextResponse } from "next/server";
import { getConfiguredCodUpfrontAmount, DEFAULT_COD_UPFRONT_AMOUNT } from "@/lib/cod-upfront";
import { getCodMaxOrderValue, DEFAULT_COD_MAX_ORDER_VALUE } from "@/lib/cod-limit";

export const dynamic = "force-dynamic";

/**
 * Public endpoint for storefront + mobile checkout.
 * Returns the current dashboard-configured COD upfront fee (INR) and the Rate Card COD limit
 * (`maxCodOrderValue`: orders above it are prepaid only).
 */
export async function GET() {
  try {
    const [amount, maxCodOrderValue] = await Promise.all([getConfiguredCodUpfrontAmount(), getCodMaxOrderValue()]);
    return NextResponse.json(
      { amount, maxCodOrderValue, currency: "INR" },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch {
    return NextResponse.json(
      { amount: DEFAULT_COD_UPFRONT_AMOUNT, maxCodOrderValue: DEFAULT_COD_MAX_ORDER_VALUE, currency: "INR" },
      { headers: { "Access-Control-Allow-Origin": "*" } }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
