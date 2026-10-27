import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/options";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

// PATCH: Update coupon details
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
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

    const coupon = await prisma.webStoreCoupon.findUnique({
      where: { id: params.id },
    });

    if (!coupon) {
      return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
    }

    const data: any = {};
    if (code !== undefined) data.code = String(code).toUpperCase().trim();
    if (discountType !== undefined) data.discountType = discountType;
    if (discountValue !== undefined) data.discountValue = parseFloat(discountValue);
    if (minOrderValue !== undefined) data.minOrderValue = parseFloat(minOrderValue);
    if (usageLimit !== undefined) data.usageLimit = usageLimit ? parseInt(usageLimit) : null;
    if (validFrom !== undefined) data.validFrom = new Date(validFrom);
    if (validUntil !== undefined) data.validUntil = new Date(validUntil);
    if (isActive !== undefined) data.isActive = isActive;
    if (applicability !== undefined) data.applicability = applicability;
    if (prepaidDiscountType !== undefined) data.prepaidDiscountType = prepaidDiscountType;
    if (prepaidDiscountValue !== undefined) data.prepaidDiscountValue = parseFloat(prepaidDiscountValue);
    if (codDiscountType !== undefined) data.codDiscountType = codDiscountType;
    if (codDiscountValue !== undefined) data.codDiscountValue = parseFloat(codDiscountValue);
    if (applyAsStoreCredit !== undefined) data.applyAsStoreCredit = applyAsStoreCredit;
    if (cashbackEnabled !== undefined) data.cashbackEnabled = !!cashbackEnabled;
    if (cashbackType !== undefined) data.cashbackType = cashbackType;
    if (cashbackValue !== undefined) data.cashbackValue = parseFloat(cashbackValue);

    const updatedCoupon = await prisma.$transaction(async (tx: any) => {
      const uCoupon = await tx.webStoreCoupon.update({
        where: { id: params.id },
        data,
      });

      // Synchronize with Discount model
      await tx.discount.updateMany({
        where: { code: coupon.code },
        data: {
          code: uCoupon.code,
          type: uCoupon.discountType,
          value: Number(uCoupon.discountValue),
          minOrderAmount: Number(uCoupon.minOrderValue),
          applicability: uCoupon.applicability === "PREPAID_ONLY" ? "PREPAID_ONLY" : "ALL",
          endDate: uCoupon.validUntil,
          usageLimit: uCoupon.usageLimit,
          isActive: uCoupon.isActive,
          cashbackEnabled: uCoupon.cashbackEnabled,
          cashbackType: uCoupon.cashbackType,
          cashbackValue: Number(uCoupon.cashbackValue),
        },
      });

      return uCoupon;
    });

    return NextResponse.json({ success: true, coupon: updatedCoupon });
  } catch (error: any) {
    console.error("[Web Store Single Coupon PATCH] Error:", error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}

// DELETE: Delete coupon
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const coupon = await prisma.webStoreCoupon.findUnique({
      where: { id: params.id },
    });

    if (!coupon) {
      return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
    }

    await prisma.$transaction(async (tx: any) => {
      // Delete matching discount by code
      await tx.discount.deleteMany({
        where: { code: coupon.code },
      });

      // Delete coupon
      await tx.webStoreCoupon.delete({
        where: { id: params.id },
      });
    });

    return NextResponse.json({ success: true, message: "Coupon deleted successfully" });
  } catch (error: any) {
    console.error("[Web Store Single Coupon DELETE] Error:", error);
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 });
  }
}
