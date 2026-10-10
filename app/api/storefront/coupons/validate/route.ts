import { NextResponse } from "next/server";
import prisma from "@/lib/db";

/**
 * POST /api/storefront/coupons/validate
 * Public API — validates a coupon code against the WebStoreCoupon table.
 * Accepts: { code: string, subtotal: number }
 * Returns: { valid: boolean, discount: number, discountType: string, message: string }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { code, subtotal, paymentMethod } = body;

    if (!code || typeof code !== "string") {
      return NextResponse.json({
        valid: false,
        discount: 0,
        discountType: "",
        message: "Please enter a coupon code.",
      });
    }

    const coupon = await prisma.webStoreCoupon.findFirst({
      where: {
        code: code.toUpperCase().trim(),
        isActive: true,
      },
    });

    if (!coupon) {
      return NextResponse.json({
        valid: false,
        discount: 0,
        discountType: "",
        message: "Invalid coupon code.",
      });
    }

    // Check date validity
    const now = new Date();
    if (coupon.validFrom && new Date(coupon.validFrom) > now) {
      return NextResponse.json({
        valid: false,
        discount: 0,
        discountType: "",
        message: "This coupon is not yet active.",
      });
    }

    if (coupon.validUntil && new Date(coupon.validUntil) < now) {
      return NextResponse.json({
        valid: false,
        discount: 0,
        discountType: "",
        message: "This coupon has expired.",
      });
    }

    // Check usage limit
    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      return NextResponse.json({
        valid: false,
        discount: 0,
        discountType: "",
        message: "This coupon has reached its usage limit.",
      });
    }

    // Check minimum order amount
    const minOrderVal = Number(coupon.minOrderValue || 0);
    if (minOrderVal > 0 && subtotal < minOrderVal) {
      return NextResponse.json({
        valid: false,
        discount: 0,
        discountType: "",
        message: `Minimum order of ₹${minOrderVal.toLocaleString("en-IN")} required.`,
      });
    }

    // Check payment method applicability (COD upfront payment is STILL a COD order)
    const pmUpper = (paymentMethod || "").toUpperCase().trim();
    const isCOD = pmUpper === "COD" || pmUpper.includes("COD");
    const codeUpper = code.toUpperCase().trim();
    const isPrepaidCode = coupon.applicability === "PREPAID_ONLY" || codeUpper.includes("PREPAID") || /^PREPAID/i.test(codeUpper);

    if (isPrepaidCode && isCOD) {
      return NextResponse.json({
        valid: false,
        discount: 0,
        discountType: "",
        message: "This coupon is only valid for prepaid orders.",
      });
    }

    if (coupon.applicability === "COD_ONLY" && !isCOD) {
      return NextResponse.json({
        valid: false,
        discount: 0,
        discountType: "",
        message: "This coupon is only valid for COD orders.",
      });
    }

    // Determine discount rates based on payment method
    let currentDiscountType = coupon.discountType;
    let currentDiscountValue = Number(coupon.discountValue);

    if (coupon.applicability === "CUSTOM_RATES") {
      if (!isCOD) {
        currentDiscountType = coupon.prepaidDiscountType;
        currentDiscountValue = Number(coupon.prepaidDiscountValue);
      } else {
        currentDiscountType = coupon.codDiscountType;
        currentDiscountValue = Number(coupon.codDiscountValue);
      }
    }

    // Calculate discount
    let discount = 0;
    if (currentDiscountType === "percentage") {
      discount = Math.round((subtotal * currentDiscountValue) / 100);
    } else {
      discount = Math.min(currentDiscountValue, subtotal);
    }

    // Cashback is % of amount paid after instant discount (e.g. ₹10k − 10% = ₹9k → ₹900 coins).
    let cashbackAmount = 0;
    const isCashbackEnabled = !!coupon.cashbackEnabled;
    if (isCashbackEnabled) {
      const paidBase = Math.max(0, subtotal - discount);
      const cbVal = Number(coupon.cashbackValue || 0);
      if (coupon.cashbackType === "percentage") {
        cashbackAmount = Math.round((paidBase * cbVal) / 100);
      } else {
        cashbackAmount = Math.min(cbVal, paidBase);
      }
    }

    // Format display message
    let displayMessage = "";
    if (isCashbackEnabled && discount > 0) {
      // Instant discount + Store Credit Earned on amount paid after discount
      displayMessage = currentDiscountType === "percentage"
        ? `${currentDiscountValue}% off + ₹${cashbackAmount.toLocaleString("en-IN")} Store Credit after delivery!`
        : `₹${currentDiscountValue.toLocaleString("en-IN")} off + ₹${cashbackAmount.toLocaleString("en-IN")} Store Credit after delivery!`;
    } else if (coupon.applyAsStoreCredit || (isCashbackEnabled && discount === 0)) {
      const finalCashback = discount > 0 ? discount : cashbackAmount;
      displayMessage = `₹${finalCashback.toLocaleString("en-IN")} Store Credit will be earned after delivery!`;
    } else {
      displayMessage = currentDiscountType === "percentage"
        ? `${currentDiscountValue}% off applied!`
        : `₹${currentDiscountValue.toLocaleString("en-IN")} off applied!`;
    }

    // When both instant discount and store-credit reward exist, discount must reduce the payable total.
    const applyAsStoreCredit =
      isCashbackEnabled && discount > 0 ? false : !!coupon.applyAsStoreCredit;

    return NextResponse.json({
      valid: true,
      discount,
      discountType: currentDiscountType,
      couponId: coupon.id,
      applyAsStoreCredit,
      cashbackEnabled: isCashbackEnabled,
      cashbackType: coupon.cashbackType || "percentage",
      cashbackValue: Number(coupon.cashbackValue || 0),
      cashbackAmount: cashbackAmount,
      message: displayMessage,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[Coupon Validate API] Error:", msg);
    return NextResponse.json({
      valid: false,
      discount: 0,
      discountType: "",
      message: "Unable to validate coupon. Please try again.",
    });
  }
}
