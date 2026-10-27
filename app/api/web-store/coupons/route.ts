import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/options";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

// GET: Fetch all coupons
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const coupons = await prisma.webStoreCoupon.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json({ coupons });
  } catch (error: any) {
    console.error("[Web Store Coupons GET] Error:", error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}

// POST: Create a coupon
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      code,
      discountType,
      discountValue,
      minOrderValue,
      usageLimit,
      validFrom,
      validUntil,
      isActive,
      applicability,
      prepaidDiscountType,
      prepaidDiscountValue,
      codDiscountType,
      codDiscountValue,
      applyAsStoreCredit,
      cashbackEnabled,
      cashbackType,
      cashbackValue
    } = body;

    if (!code || !discountType || !discountValue || !validFrom || !validUntil) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Force uppercase codes for consistency
    const formattedCode = String(code).toUpperCase().trim();

    // Check if coupon code already exists
    const existing = await prisma.webStoreCoupon.findUnique({
      where: { code: formattedCode },
    });
    if (existing) {
      return NextResponse.json({ error: "Coupon code already exists" }, { status: 400 });
    }

    const newCoupon = await prisma.$transaction(async (tx: any) => {
      // 1. Create WebStoreCoupon
      const coupon = await tx.webStoreCoupon.create({
        data: {
          code: formattedCode,
          discountType,
          discountValue: parseFloat(discountValue),
          minOrderValue: parseFloat(minOrderValue || 0),
          usageLimit: usageLimit ? parseInt(usageLimit) : null,
          usedCount: 0,
          validFrom: new Date(validFrom),
          validUntil: new Date(validUntil),
          isActive: isActive !== undefined ? isActive : true,
          applicability: applicability || "ALL",
          prepaidDiscountType: prepaidDiscountType || "percentage",
          prepaidDiscountValue: parseFloat(prepaidDiscountValue || 0),
          codDiscountType: codDiscountType || "percentage",
          codDiscountValue: parseFloat(codDiscountValue || 0),
          applyAsStoreCredit: applyAsStoreCredit !== undefined ? applyAsStoreCredit : false,
          cashbackEnabled: cashbackEnabled !== undefined ? !!cashbackEnabled : false,
          cashbackType: cashbackType || "percentage",
          cashbackValue: cashbackValue ? parseFloat(cashbackValue) : 0,
        },
      });

      // 2. Synchronize with Discount
      const existingDiscount = await tx.discount.findUnique({
        where: { code: formattedCode }
      });
      if (!existingDiscount) {
        await tx.discount.create({
          data: {
            code: formattedCode,
            type: discountType,
            value: parseFloat(discountValue),
            minOrderAmount: parseFloat(minOrderValue || 0),
            applicability: applicability === "PREPAID_ONLY" ? "PREPAID_ONLY" : "ALL",
            endDate: new Date(validUntil),
            usageLimit: usageLimit ? parseInt(usageLimit) : null,
            isActive: isActive !== undefined ? isActive : true,
            cashbackEnabled: cashbackEnabled !== undefined ? !!cashbackEnabled : false,
            cashbackType: cashbackType || "percentage",
            cashbackValue: cashbackValue ? parseFloat(cashbackValue) : 0,
          }
        });
      }

      return coupon;
    });

    return NextResponse.json({ success: true, coupon: newCoupon });
  } catch (error: any) {
    console.error("[Web Store Coupons POST] Error:", error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
