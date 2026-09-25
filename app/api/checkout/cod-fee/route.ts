import { NextResponse } from "next/server";
import { getConfiguredCodUpfrontAmount, DEFAULT_COD_UPFRONT_AMOUNT } from "@/lib/cod-upfront";

export const dynamic = "force-dynamic";

/**
 * Public endpoint for storefront + mobile checkout.
 * Returns the current dashboard-configured COD upfront fee (INR).
 */
export async function GET() {
  try {
    const amount = await getConfiguredCodUpfrontAmount();
    return NextResponse.json(
      { amount, currency: "INR" },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch {
    return NextResponse.json(
      { amount: DEFAULT_COD_UPFRONT_AMOUNT, currency: "INR" },
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
