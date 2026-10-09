import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { resolveRazorpayCredentials } from '@/lib/razorpay-credentials';
import { VerifyPaymentSchema } from '@/lib/razorpay-schemas';
import { paymentLog } from '@/lib/payment-logger';
import prisma from '@/lib/db';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = VerifyPaymentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Missing payment details', details: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = parsed.data;

    // Accept mock payments ONLY in non-production with explicit opt-in (same as checkout/complete)
    const allowMock =
      process.env.NODE_ENV !== 'production' &&
      process.env.ALLOW_MOCK_PAYMENTS === 'true' &&
      (razorpay_order_id.startsWith('order_mock_') || razorpay_signature === 'mock_sig_valid');
    if (allowMock) {
      paymentLog('warn', 'verify-payment', { orderId: razorpay_order_id, message: 'Mock verification' });
      return NextResponse.json({ success: true, payment_id: razorpay_payment_id, mock: true });
    }
    if (razorpay_order_id.startsWith('order_mock_') || razorpay_signature === 'mock_sig_valid') {
      paymentLog('warn', 'verify-payment', {
        orderId: razorpay_order_id,
        message: 'Mock verification rejected (production or ALLOW_MOCK_PAYMENTS unset)',
      });
      return NextResponse.json({ success: false, error: 'Mock payments are disabled' }, { status: 400 });
    }

    let secret: string;
    try {
      secret = (await resolveRazorpayCredentials()).key_secret;
    } catch {
      return NextResponse.json({ success: false, error: 'Razorpay not configured.' }, { status: 500 });
    }

    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    // Timing-safe comparison
    try {
      const sigBuf = Buffer.from(razorpay_signature, 'utf-8');
      const genBuf = Buffer.from(expectedSig, 'utf-8');
      if (sigBuf.length !== genBuf.length || !crypto.timingSafeEqual(sigBuf, genBuf)) {
        paymentLog('warn', 'verify-payment', { orderId: razorpay_order_id, paymentId: razorpay_payment_id, status: 'signature_mismatch' });
        return NextResponse.json({ success: false, error: 'Signature mismatch' }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid payment signature' }, { status: 400 });
    }

    // Update order in DB only after live capture confirmation
    try {
      const existingOrder = await prisma.order.findFirst({
        where: { razorpayOrderId: razorpay_order_id },
        select: { id: true, paymentMethod: true, internalOrderNumber: true, shopifyOrderName: true },
      });

      const isCOD = (existingOrder?.paymentMethod || "").toLowerCase().trim() === "cod";
      const { resolveRazorpayCredentials } = await import('@/lib/razorpay-credentials');
      const { assertCapturedCharge, paymentAmountRupees } = await import('@/lib/razorpay-payment');
      const { getConfiguredCodUpfrontAmount, DEFAULT_COD_UPFRONT_AMOUNT } = await import('@/lib/cod-upfront');
      const creds = await resolveRazorpayCredentials();
      const expectedMin = isCOD
        ? await getConfiguredCodUpfrontAmount().catch(() => DEFAULT_COD_UPFRONT_AMOUNT)
        : 0;
      let capturedRupees = 0;
      try {
        const payment = await assertCapturedCharge({
          paymentId: razorpay_payment_id,
          credentials: creds,
          expectedMinRupees: expectedMin,
          orderId: razorpay_order_id,
        });
        capturedRupees = paymentAmountRupees(payment);
      } catch (capErr: any) {
        paymentLog('warn', 'verify-payment', {
          orderId: razorpay_order_id,
          paymentId: razorpay_payment_id,
          message: `Capture check failed: ${capErr?.message || capErr}`,
        });
        return NextResponse.json(
          { success: false, error: 'Payment not captured on Razorpay' },
          { status: 402 }
        );
      }

      const targetPaymentStatus = isCOD ? "cod_upfront_paid" : "PAID";

      await prisma.order.updateMany({
        where: { razorpayOrderId: razorpay_order_id },
        data: {
          paymentStatus: targetPaymentStatus,
          status: 'CONFIRMED',
          razorpayPaymentId: razorpay_payment_id,
          paymentCapturedAt: new Date(),
          ...(isCOD
            ? { codUpfrontPaid: capturedRupees, codUpfrontPaymentId: razorpay_payment_id }
            : {}),
        },
      });

      await prisma.webStoreOrder.updateMany({
        where: { razorpayOrderId: razorpay_order_id },
        data: {
          paymentStatus: isCOD ? "cod_upfront_paid" : "paid",
          razorpayPaymentId: razorpay_payment_id,
          ...(isCOD
            ? { codUpfrontPaid: capturedRupees, codUpfrontPaymentId: razorpay_payment_id }
            : {}),
        },
      });

      // Upgrade WebStoreOrder number from ZBPP prefix to real order number
      const realOrderNum = existingOrder?.internalOrderNumber || existingOrder?.shopifyOrderName;
      if (realOrderNum) {
        try {
          const pendingWso = await prisma.webStoreOrder.findFirst({
            where: {
              razorpayOrderId: razorpay_order_id,
              orderNumber: { startsWith: "ZBPP" },
            },
          });
          if (pendingWso) {
            const existing = await prisma.webStoreOrder.findUnique({
              where: { orderNumber: realOrderNum },
            });
            if (!existing) {
              await prisma.webStoreOrder.update({
                where: { id: pendingWso.id },
                data: {
                  orderNumber: realOrderNum,
                  notes: pendingWso.notes
                    ? `${pendingWso.notes} | Local: ${existingOrder.id}`
                    : `Local: ${existingOrder.id}`,
                },
              });
              paymentLog('info', 'verify-payment', { orderId: razorpay_order_id, message: `Upgraded order number: ${pendingWso.orderNumber} -> ${realOrderNum}` });
            }
          }
        } catch (numErr) {
          // Non-fatal: order number upgrade failure shouldn't block payment verification
          paymentLog('warn', 'verify-payment', { orderId: razorpay_order_id, message: 'Order number upgrade failed (non-fatal)' });
        }
      }
    } catch (dbErr) {
      paymentLog('error', 'verify-payment', { orderId: razorpay_order_id, error: 'DB update failed' });
    }

    paymentLog('info', 'verify-payment', { orderId: razorpay_order_id, paymentId: razorpay_payment_id, status: 'verified' });
    return NextResponse.json({ success: true, payment_id: razorpay_payment_id });
  } catch (err: any) {
    paymentLog('error', 'verify-payment', { error: err.message });
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
