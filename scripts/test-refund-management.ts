/**
 * Comprehensive Test Suite for Refund Management System
 * 
 * Tests:
 * 1. Prepaid Order Return Refund (Razorpay refund to original payment source)
 * 2. Exchange Price Difference Refund (Customer exchanges for lower-priced item)
 * 3. Refund Accuracy: Order discounts & accounting for already-paid / refunded amounts
 * 4. Strict QC & Approval Flow: Blocking refunds for items that failed QC
 * 5. Duplicate Approval & Race Condition Protection
 * 6. Failed Refund Handling & Status Sync
 */

import prisma from '../lib/db';
import { calculateOrderRefundLimits } from '../lib/services/refundAccuracy';

// Colors for terminal output
const green = (msg: string) => `\x1b[32m✔ ${msg}\x1b[0m`;
const red = (msg: string) => `\x1b[31m✖ ${msg}\x1b[0m`;
const cyan = (msg: string) => `\x1b[36mℹ ${msg}\x1b[0m`;
const bold = (msg: string) => `\x1b[1m${msg}\x1b[0m`;

async function runTests() {
  console.log(bold('\n======================================================'));
  console.log(bold('  STARTING REFUND MANAGEMENT SYSTEM TEST SUITE'));
  console.log(bold('======================================================\n'));

  let passed = 0;
  let failed = 0;

  // Route handlers are called directly, so stub the NextAuth session as a super admin.
  const adminSession = {
    user: { id: 'test_admin_id', name: 'Super Admin', email: 'test_admin@zicabella.com', role: 'SUPER_ADMIN' },
  };
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('next-auth/next').getServerSession = async () => adminSession;

  const shop = await prisma.shop.findFirst() || await prisma.shop.create({
    data: {
      domain: 'test.myshopify.com',
      accessToken: 'test_token',
      name: 'Test Shop'
    }
  });

  const testCustomer = await prisma.customer.upsert({
    where: { id: 'test_refund_customer_1' },
    update: { storeCredits: 0 },
    create: {
      id: 'test_refund_customer_1',
      shopifyId: 'test_shopify_cust_1',
      shopId: shop.id,
      email: 'refund_test_customer@example.com',
      name: 'Test Customer',
      phone: '+910000000001',
      storeCredits: 0,
    },
  });

  const testProduct1 = await prisma.product.upsert({
    where: { id: 'test_product_refund_1' },
    update: { price: 2000 },
    create: {
      id: 'test_product_refund_1',
      shopifyProductId: 'test_shopify_prod_1',
      shopId: shop.id,
      title: 'Premium Streetwear Hoodie',
      price: 2000,
      sku: 'HOODIE-M',
    },
  });

  const testProduct2 = await prisma.product.upsert({
    where: { id: 'test_product_refund_2' },
    update: { price: 1500 },
    create: {
      id: 'test_product_refund_2',
      shopifyProductId: 'test_shopify_prod_2',
      shopId: shop.id,
      title: 'Classic Streetwear Tee',
      price: 1500,
      sku: 'TEE-M',
    },
  });

  // =========================================================================
  // TEST 1: Prepaid Order Return Refund (Razorpay refund to original payment source)
  // =========================================================================
  console.log(cyan('TEST 1: Prepaid Order Return Refund Flow...'));
  try {
    const order1 = await prisma.order.create({
      data: {
        shopId: shop.id,
        customerId: testCustomer.id,
        totalPrice: 2000,
        subtotalPrice: 2000,
        discountAmount: 0,
        paymentStatus: 'paid',
        status: 'delivered',
        deliveryStatus: 'delivered',
        fulfillmentStatus: 'fulfilled',
        paymentMethod: 'Prepaid',
        razorpayPaymentId: `pay_mock_test_ret_${Date.now()}`,
        internalOrderNumber: `ZB_RET_${Date.now()}`,
        items: {
          create: [{
            shopifyLineItemId: `sli_1_${Date.now()}`,
            productId: testProduct1.id,
            title: testProduct1.title,
            price: 2000,
            quantity: 1,
            sku: testProduct1.sku,
          }]
        },
        payments: {
          create: [{
            customerId: testCustomer.id,
            amount: 2000,
            type: 'charge',
            status: 'completed',
            gateway: 'razorpay'
          }]
        }
      }
    });

    // Create return request
    const retReq1 = await prisma.returnRequest.create({
      data: {
        orderId: order1.id,
        customerId: testCustomer.id,
        status: 'received', // Parcel received
        receivedAt: new Date(),
        estimatedRefund: 2000,
        refundType: 'original_source',
        returns: {
          create: [{
            orderId: order1.id,
            customerId: testCustomer.id,
            productId: testProduct1.id,
            quantity: 1,
            sku: testProduct1.sku,
            reason: 'Size too large',
            status: 'RECEIVED',
            refundAmount: 2000,
            refundStatus: 'PENDING',
            refundMethod: 'original_method',
          }]
        }
      },
      include: { returns: true }
    });

    // Mark QC as passed
    await prisma.returnRequest.update({
      where: { id: retReq1.id },
      data: { status: 'qc_passed' }
    });
    await prisma.return.updateMany({
      where: { returnRequestId: retReq1.id },
      data: { status: 'QC_PASSED' }
    });

    // Now test approval via the approve logic
    const { POST: approvePost } = await import('../app/api/admin/refunds/[id]/approve/route');
    const approveReq = new Request(`http://localhost/api/admin/refunds/${retReq1.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    // Mock admin session for test
    const approveRes = await approvePost(approveReq, { params: { id: retReq1.id } });
    const approveData = await approveRes.json();

    if (!approveRes.ok || !approveData.success) {
      throw new Error(`Approval failed: ${approveData.error || JSON.stringify(approveData)}`);
    }

    // Verify database state
    const updatedRetReq = await prisma.returnRequest.findUnique({
      where: { id: retReq1.id },
      include: { returns: true, order: { include: { payments: true } } }
    });

    if (updatedRetReq?.status !== 'refunded') {
      throw new Error(`Expected returnRequest.status to be 'refunded', got '${updatedRetReq?.status}'`);
    }

    if (updatedRetReq.returns[0]?.refundStatus !== 'COMPLETED') {
      throw new Error(`Expected return.refundStatus to be 'COMPLETED', got '${updatedRetReq.returns[0]?.refundStatus}'`);
    }

    if (updatedRetReq.order.refundStatus !== 'completed') {
      throw new Error(`Expected order.refundStatus to be 'completed', got '${updatedRetReq.order.refundStatus}'`);
    }

    // Verify refund payment was recorded in Payment table
    const refundPayment = updatedRetReq.order.payments.find(p => p.type === 'refund' && p.status === 'completed');
    if (!refundPayment || refundPayment.amount !== 2000) {
      throw new Error(`Expected refund payment of ₹2000, found: ${JSON.stringify(refundPayment)}`);
    }

    console.log(green('TEST 1 PASSED: Prepaid order return refund approved and processed to Razorpay original source successfully!'));
    passed++;
  } catch (err: any) {
    console.error(red(`TEST 1 FAILED: ${err.message}`));
    failed++;
  }

  // =========================================================================
  // TEST 2: Exchange Difference Refund (Customer exchanges for lower-priced item)
  // =========================================================================
  console.log(cyan('\nTEST 2: Exchange Difference Refund Flow...'));
  try {
    const order2 = await prisma.order.create({
      data: {
        shopId: shop.id,
        customerId: testCustomer.id,
        totalPrice: 2000,
        subtotalPrice: 2000,
        discountAmount: 0,
        paymentStatus: 'paid',
        status: 'delivered',
        deliveryStatus: 'delivered',
        fulfillmentStatus: 'fulfilled',
        paymentMethod: 'Prepaid',
        razorpayPaymentId: `pay_mock_test_exc_${Date.now()}`,
        internalOrderNumber: `ZB_EXC_${Date.now()}`,
        items: {
          create: [{
            shopifyLineItemId: `sli_2_${Date.now()}`,
            productId: testProduct1.id,
            title: testProduct1.title,
            price: 2000,
            quantity: 1,
            sku: testProduct1.sku,
          }]
        },
        payments: {
          create: [{
            customerId: testCustomer.id,
            amount: 2000,
            type: 'charge',
            status: 'completed',
            gateway: 'razorpay'
          }]
        }
      }
    });

    // Customer exchanges Product 1 (₹2000) for Product 2 (₹1500) -> price difference is -₹500
    const exchangeReq = await prisma.exchangeRequest.create({
      data: {
        orderId: order2.id,
        customerId: testCustomer.id,
        status: 'qc_passed', // Received and passed QC
        receivedAt: new Date(),
        priceDifference: -500,
        paymentStatus: 'refund_original_pending',
        settlementPreference: 'REFUND_ORIGINAL_METHOD',
        displayId: `E_ZB_${Date.now()}`,
        exchanges: {
          create: [{
            orderId: order2.id,
            originalProductId: testProduct1.id,
            newProductId: testProduct2.id,
            status: 'QC_PASSED',
            priceDifference: -500,
            paymentStatus: 'refund_original_pending',
            qcStatus: 'passed',
          }]
        }
      },
      include: { exchanges: true }
    });

    // 1. Verify GET /api/admin/refunds lists this exchange refund
    const { GET: getRefunds } = await import('../app/api/admin/refunds/route');
    const getReq = new Request('http://localhost/api/admin/refunds?status=all');
    const getRes = await getRefunds(getReq);
    const getData = await getRes.json();

    const listedItem = getData.refunds.find((r: any) => r.id === exchangeReq.id);
    if (!listedItem) {
      throw new Error(`ExchangeRequest ${exchangeReq.id} was not found in GET /api/admin/refunds!`);
    }

    if (listedItem.type !== 'EXCHANGE_REQUEST' || listedItem.refundAmount !== 500) {
      throw new Error(`Expected exchange refund amount ₹500, got ₹${listedItem.refundAmount}`);
    }

    if (listedItem.qcStatus !== 'PASSED') {
      throw new Error(`Expected QC status 'PASSED', got '${listedItem.qcStatus}'`);
    }

    // 2. Approve the Exchange Difference Refund
    const { POST: approvePost } = await import('../app/api/admin/refunds/[id]/approve/route');
    const approveReq = new Request(`http://localhost/api/admin/refunds/${exchangeReq.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    const approveRes = await approvePost(approveReq, { params: { id: exchangeReq.id } });
    const approveData = await approveRes.json();

    if (!approveRes.ok || !approveData.success) {
      throw new Error(`Exchange refund approval failed: ${approveData.error || JSON.stringify(approveData)}`);
    }

    // Verify DB update
    const updatedExchangeReq = await prisma.exchangeRequest.findUnique({
      where: { id: exchangeReq.id },
      include: { exchanges: true, order: { include: { payments: true } } }
    });

    if (updatedExchangeReq?.paymentStatus !== 'refunded_original') {
      throw new Error(`Expected exchange paymentStatus 'refunded_original', got '${updatedExchangeReq?.paymentStatus}'`);
    }

    const excPayment = updatedExchangeReq.order.payments.find(p => p.type === 'refund' && p.amount === 500);
    if (!excPayment) {
      throw new Error('Exchange refund of ₹500 was not recorded in Payment table!');
    }

    console.log(green('TEST 2 PASSED: Exchange difference refund of ₹500 approved and refunded to original payment source successfully!'));
    passed++;
  } catch (err: any) {
    console.error(red(`TEST 2 FAILED: ${err.message}`));
    failed++;
  }

  // =========================================================================
  // TEST 3: Refund Accuracy with Discounts & Accounting for Previous Refunds
  // =========================================================================
  console.log(cyan('\nTEST 3: Refund Accuracy with Discounts and Prior Refunds...'));
  try {
    // Order: 2 items of ₹1000 each = ₹2000. Discount applied = ₹500 (25%). Net paid = ₹1500.
    const order3 = await prisma.order.create({
      data: {
        shopId: shop.id,
        customerId: testCustomer.id,
        totalPrice: 1500,
        subtotalPrice: 2000,
        discountAmount: 500,
        paymentStatus: 'paid',
        status: 'delivered',
        deliveryStatus: 'delivered',
        fulfillmentStatus: 'fulfilled',
        paymentMethod: 'Prepaid',
        razorpayPaymentId: `pay_mock_test_acc_${Date.now()}`,
        internalOrderNumber: `ZB_ACC_${Date.now()}`,
        items: {
          create: [
            { shopifyLineItemId: `sli_3a_${Date.now()}`, productId: testProduct1.id, title: 'Item 1', price: 1000, quantity: 1, sku: 'ITEM-1' },
            { shopifyLineItemId: `sli_3b_${Date.now()}`, productId: testProduct2.id, title: 'Item 2', price: 1000, quantity: 1, sku: 'ITEM-2' },
          ]
        },
        payments: {
          create: [{
            customerId: testCustomer.id,
            amount: 1500,
            type: 'charge',
            status: 'completed',
            gateway: 'razorpay'
          }]
        }
      }
    });

    // Check discount calculation helper
    const limits3 = await calculateOrderRefundLimits(order3.id);
    if (limits3.totalPaid !== 1500 || limits3.maxRemainingRefundable !== 1500) {
      throw new Error(`Expected maxRemainingRefundable to be 1500, got ${limits3.maxRemainingRefundable}`);
    }
    if (limits3.discountRatio !== 0.25) {
      throw new Error(`Expected discount ratio 0.25 (25%), got ${limits3.discountRatio}`);
    }

    // Customer returns Item 1 (Nominal price ₹1000, but after 25% discount, net refund is ₹750)
    const retReq3 = await prisma.returnRequest.create({
      data: {
        orderId: order3.id,
        customerId: testCustomer.id,
        status: 'qc_passed',
        receivedAt: new Date(),
        estimatedRefund: 750, // Accurately calculated post-discount
        returns: {
          create: [{
            orderId: order3.id,
            customerId: testCustomer.id,
            productId: testProduct1.id,
            quantity: 1,
            sku: 'ITEM-1',
            reason: 'Defective',
            status: 'QC_PASSED',
            refundAmount: 750,
            refundStatus: 'PENDING',
            refundMethod: 'original_method',
          }]
        }
      }
    });

    // Approve the first partial refund
    const { POST: approvePost } = await import('../app/api/admin/refunds/[id]/approve/route');
    const approveRes1 = await approvePost(
      new Request(`http://localhost/api/admin/refunds/${retReq3.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }),
      { params: { id: retReq3.id } }
    );
    const data1 = await approveRes1.json();
    if (!data1.success || data1.finalRefundAmount !== 750) {
      throw new Error(`First refund of ₹750 failed: ${JSON.stringify(data1)}`);
    }

    // Now verify the remaining refundable ceiling is accurately reduced to ₹750
    const limitsAfter1 = await calculateOrderRefundLimits(order3.id);
    if (limitsAfter1.totalAlreadyRefunded !== 750 || limitsAfter1.maxRemainingRefundable !== 750) {
      throw new Error(`Expected remaining refundable to be ₹750, got ₹${limitsAfter1.maxRemainingRefundable}`);
    }

    // Attempt to request an invalid refund exceeding remaining refundable (e.g. ₹1000)
    const retReq3B = await prisma.returnRequest.create({
      data: {
        orderId: order3.id,
        customerId: testCustomer.id,
        status: 'qc_passed',
        receivedAt: new Date(),
        estimatedRefund: 1000,
        returns: {
          create: [{
            orderId: order3.id,
            customerId: testCustomer.id,
            productId: testProduct2.id,
            quantity: 1,
            sku: 'ITEM-2',
            reason: 'Not needed',
            status: 'QC_PASSED',
            refundAmount: 1000,
            refundStatus: 'PENDING',
            refundMethod: 'original_method',
          }]
        }
      }
    });

    // Attempting to approve ₹1000 when only ₹750 remains MUST BE BLOCKED
    const approveResExceed = await approvePost(
      new Request(`http://localhost/api/admin/refunds/${retReq3B.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrideAmount: 1000 })
      }),
      { params: { id: retReq3B.id } }
    );
    const dataExceed = await approveResExceed.json();

    if (approveResExceed.ok || !dataExceed.error?.includes('exceeds')) {
      throw new Error(`Expected approval exceeding remaining balance to be rejected, got: ${JSON.stringify(dataExceed)}`);
    }

    console.log(green('TEST 3 PASSED: Proportional discounts applied and refund accurately capped at remaining balance!'));
    passed++;
  } catch (err: any) {
    console.error(red(`TEST 3 FAILED: ${err.message}`));
    failed++;
  }

  // =========================================================================
  // TEST 4: Strict QC Enforcement (Item Failed Quality Check)
  // =========================================================================
  console.log(cyan('\nTEST 4: Strict QC & Approval Flow (Item Failed QC)...'));
  try {
    const order4 = await prisma.order.create({
      data: {
        shopId: shop.id,
        customerId: testCustomer.id,
        totalPrice: 1500,
        subtotalPrice: 1500,
        paymentStatus: 'paid',
        status: 'delivered',
        fulfillmentStatus: 'fulfilled',
        paymentMethod: 'Prepaid',
        razorpayPaymentId: `pay_mock_test_qc_${Date.now()}`,
        internalOrderNumber: `ZB_QC_${Date.now()}`,
        items: {
          create: [{
            shopifyLineItemId: `sli_4_${Date.now()}`,
            productId: testProduct2.id,
            title: testProduct2.title,
            price: 1500,
            quantity: 1,
            sku: testProduct2.sku,
          }]
        },
        payments: {
          create: [{
            customerId: testCustomer.id,
            amount: 1500,
            type: 'charge',
            status: 'completed',
            gateway: 'razorpay'
          }]
        }
      }
    });

    // Return parcel arrived but FAILED Quality Check (e.g. customer washed/damaged item)
    const retReq4 = await prisma.returnRequest.create({
      data: {
        orderId: order4.id,
        customerId: testCustomer.id,
        status: 'qc_failed',
        receivedAt: new Date(),
        estimatedRefund: 1500,
        returns: {
          create: [{
            orderId: order4.id,
            customerId: testCustomer.id,
            productId: testProduct2.id,
            quantity: 1,
            sku: testProduct2.sku,
            reason: 'Customer damage detected',
            status: 'QC_FAILED',
            refundAmount: 1500,
            refundStatus: 'PENDING',
            refundMethod: 'original_method',
          }]
        }
      }
    });

    const { POST: approvePost } = await import('../app/api/admin/refunds/[id]/approve/route');
    const approveRes = await approvePost(
      new Request(`http://localhost/api/admin/refunds/${retReq4.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }),
      { params: { id: retReq4.id } }
    );
    const approveData = await approveRes.json();

    if (approveRes.ok || !approveData.error?.includes('Quality Check failed')) {
      throw new Error(`Expected QC failed return to be rejected, got: ${JSON.stringify(approveData)}`);
    }

    console.log(green('TEST 4 PASSED: Approving refund for item that failed QC was strictly blocked!'));
    passed++;
  } catch (err: any) {
    console.error(red(`TEST 4 FAILED: ${err.message}`));
    failed++;
  }

  // =========================================================================
  // TEST 5: Duplicate Approval & Race Condition Protection
  // =========================================================================
  console.log(cyan('\nTEST 5: Duplicate Approval & Idempotency Protection...'));
  try {
    const order5 = await prisma.order.create({
      data: {
        shopId: shop.id,
        customerId: testCustomer.id,
        totalPrice: 1500,
        subtotalPrice: 1500,
        paymentStatus: 'paid',
        status: 'delivered',
        fulfillmentStatus: 'fulfilled',
        paymentMethod: 'Prepaid',
        razorpayPaymentId: `pay_mock_test_dup_${Date.now()}`,
        internalOrderNumber: `ZB_DUP_${Date.now()}`,
        items: {
          create: [{
            shopifyLineItemId: `sli_5_${Date.now()}`,
            productId: testProduct2.id,
            title: testProduct2.title,
            price: 1500,
            quantity: 1,
            sku: testProduct2.sku,
          }]
        },
        payments: {
          create: [{
            customerId: testCustomer.id,
            amount: 1500,
            type: 'charge',
            status: 'completed',
            gateway: 'razorpay'
          }]
        }
      }
    });

    const retReq5 = await prisma.returnRequest.create({
      data: {
        orderId: order5.id,
        customerId: testCustomer.id,
        status: 'qc_passed',
        receivedAt: new Date(),
        estimatedRefund: 1500,
        returns: {
          create: [{
            orderId: order5.id,
            customerId: testCustomer.id,
            productId: testProduct2.id,
            quantity: 1,
            sku: testProduct2.sku,
            reason: 'Duplicate test',
            status: 'QC_PASSED',
            refundAmount: 1500,
            refundStatus: 'PENDING',
            refundMethod: 'original_method',
          }]
        }
      }
    });

    const { POST: approvePost } = await import('../app/api/admin/refunds/[id]/approve/route');

    // First approval
    const res1 = await approvePost(
      new Request(`http://localhost/api/admin/refunds/${retReq5.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }),
      { params: { id: retReq5.id } }
    );
    const data1 = await res1.json();
    if (!data1.success) {
      throw new Error(`First approval failed: ${JSON.stringify(data1)}`);
    }

    // Immediate second approval attempt (Duplicate)
    const res2 = await approvePost(
      new Request(`http://localhost/api/admin/refunds/${retReq5.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }),
      { params: { id: retReq5.id } }
    );
    const data2 = await res2.json();

    if (res2.ok || !data2.error?.includes('already been processed')) {
      throw new Error(`Expected second approval to be rejected, got: ${JSON.stringify(data2)}`);
    }

    // Verify only ONE refund payment was recorded
    const refundPayments = await prisma.payment.findMany({
      where: { orderId: order5.id, type: 'refund' }
    });

    if (refundPayments.length !== 1) {
      throw new Error(`Expected exactly 1 refund payment, found ${refundPayments.length}`);
    }

    console.log(green('TEST 5 PASSED: Duplicate approval prevented and exactly one refund recorded!'));
    passed++;
  } catch (err: any) {
    console.error(red(`TEST 5 FAILED: ${err.message}`));
    failed++;
  }

  // =========================================================================
  // TEST 6: Failed Refund Handling & Status Sync
  // =========================================================================
  console.log(cyan('\nTEST 6: Failed Refund Handling and Status Sync...'));
  try {
    const order6 = await prisma.order.create({
      data: {
        shopId: shop.id,
        customerId: testCustomer.id,
        totalPrice: 1500,
        subtotalPrice: 1500,
        paymentStatus: 'paid',
        status: 'delivered',
        fulfillmentStatus: 'fulfilled',
        paymentMethod: 'Prepaid',
        razorpayPaymentId: `pay_mock_test_fail_${Date.now()}`,
        internalOrderNumber: `ZB_FAIL_${Date.now()}`,
        items: {
          create: [{
            shopifyLineItemId: `sli_6_${Date.now()}`,
            productId: testProduct2.id,
            title: testProduct2.title,
            price: 1500,
            quantity: 1,
            sku: testProduct2.sku,
          }]
        },
        payments: {
          create: [{
            customerId: testCustomer.id,
            amount: 1500,
            type: 'charge',
            status: 'completed',
            gateway: 'razorpay'
          }]
        }
      }
    });

    const retReq6 = await prisma.returnRequest.create({
      data: {
        orderId: order6.id,
        customerId: testCustomer.id,
        status: 'refund_failed', // Simulating failed state
        receivedAt: new Date(),
        estimatedRefund: 1500,
        returns: {
          create: [{
            orderId: order6.id,
            customerId: testCustomer.id,
            productId: testProduct2.id,
            quantity: 1,
            sku: testProduct2.sku,
            reason: 'Size issue',
            status: 'QC_PASSED',
            refundAmount: 1500,
            refundStatus: 'FAILED',
            refundMethod: 'original_method',
          }]
        }
      }
    });

    await prisma.order.update({
      where: { id: order6.id },
      data: { refundStatus: 'failed', refundError: 'Customer card expired / bank declined refund' }
    });

    // Check that GET /api/admin/refunds marks this as FAILED with error message
    const { GET: getRefunds } = await import('../app/api/admin/refunds/route');
    const getRes = await getRefunds(new Request('http://localhost/api/admin/refunds?status=failed'));
    const getData = await getRes.json();

    const failedItem = getData.refunds.find((r: any) => r.id === retReq6.id);
    if (!failedItem) {
      throw new Error(`Failed return ${retReq6.id} was not returned by status=failed filter!`);
    }

    if (failedItem.refundStatus !== 'FAILED') {
      throw new Error(`Expected refundStatus 'FAILED', got '${failedItem.refundStatus}'`);
    }

    if (!failedItem.refundError?.includes('expired')) {
      throw new Error(`Expected refundError to be present, got '${failedItem.refundError}'`);
    }

    console.log(green('TEST 6 PASSED: Failed refund status, error explanation, and filter sync verified!'));
    passed++;
  } catch (err: any) {
    console.error(red(`TEST 6 FAILED: ${err.message}`));
    failed++;
  }

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log(bold('\n======================================================'));
  console.log(bold(`  TEST SUITE RESULTS: ${passed} PASSED, ${failed} FAILED`));
  console.log(bold('======================================================\n'));

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error running tests:', err);
  process.exit(1);
});
