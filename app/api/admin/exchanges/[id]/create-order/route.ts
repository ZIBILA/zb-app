import { NextResponse } from "next/server";
import { createExchangeReplacementOrder } from "@/lib/services/exchangeReplacementOrder";

/**
 * POST /api/admin/exchanges/[id]/create-order
 * Creates the G_E_ replacement Shopify+local order after QC pass.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const result = await createExchangeReplacementOrder(params.id);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status || 400 });
    }
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Create Exchange Replacement Order Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
