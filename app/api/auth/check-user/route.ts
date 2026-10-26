import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { searchCustomerByPhone } from "@/lib/shopify-admin";

export const dynamic = "force-dynamic";

import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const rateLimitResult = await checkRateLimit(req, "auth-check-user", { maxRequests: 30, windowMs: 60_000 });
  if (!rateLimitResult.allowed && rateLimitResult.response) {
    return rateLimitResult.response;
  }
  try {
    const { phone } = await req.json();

    if (!phone) {
      return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
    }

    const phoneDigits = phone.replace(/\D/g, "");
    const normalizedPhone = phoneDigits.slice(-10);
    const fullPhone = `+${phoneDigits}`;

    // 1. Search Shopify
    let shopifyCustomer = null;
    try {
      shopifyCustomer = await searchCustomerByPhone(fullPhone);
      if (!shopifyCustomer) shopifyCustomer = await searchCustomerByPhone(phoneDigits);
      if (!shopifyCustomer) shopifyCustomer = await searchCustomerByPhone(normalizedPhone);
    } catch (e) {
      console.error("Shopify search error:", e);
    }

    // Return exists + first name only (login greeting). Never expose full name/PII.
    const maskName = (full: string | null | undefined) => {
      const first = String(full || "").trim().split(/\s+/)[0] || "";
      return first || null;
    };

    if (shopifyCustomer) {
      const full = `${shopifyCustomer.first_name || ""} ${shopifyCustomer.last_name || ""}`.trim();
      return NextResponse.json({
        exists: true,
        name: maskName(shopifyCustomer.first_name || full)
      });
    }

    // 2. Search Local DB
    const localCustomer = await prisma.customer.findFirst({
      where: {
        OR: [
          { phone: fullPhone },
          { phone: phoneDigits },
          { phone: { contains: normalizedPhone } }
        ]
      }
    });

    if (localCustomer) {
      return NextResponse.json({
        exists: true,
        name: maskName(localCustomer.name)
      });
    }

    return NextResponse.json({
      exists: false,
      name: null
    });
  } catch (error: any) {
    console.error("Check user error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
