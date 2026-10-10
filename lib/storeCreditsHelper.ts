import prisma from "@/lib/db";

/**
 * Checks for expired store credit transactions for a customer,
 * voids them, and decrements their store credit balance.
 */
export async function voidExpiredCredits(customerId: string) {
  const now = new Date();

  try {
    // Find all active credit transactions (amount > 0) that have expired and still have remainingAmount > 0
    const expiredCredits = await prisma.storeCredit.findMany({
      where: {
        customerId,
        amount: { gt: 0 },
        expiresAt: { lte: now },
        remainingAmount: { gt: 0 }
      }
    });

    if (expiredCredits.length === 0) return;

    for (const cred of expiredCredits) {
      const toVoid = cred.remainingAmount;
      if (toVoid <= 0) continue;

      await prisma.$transaction(async (tx: any) => {
        // Double check within transaction
        const currentCred = await tx.storeCredit.findUnique({
          where: { id: cred.id }
        });
        if (!currentCred || currentCred.remainingAmount <= 0) return;

        const actualVoid = currentCred.remainingAmount;

        // 1. Create a void transaction
        await tx.storeCredit.create({
          data: {
            customerId,
            amount: -actualVoid,
            type: "EXPIRED_VOID",
            description: `Expired: ₹${actualVoid} store credit from transaction #${cred.id} expired`,
            orderId: cred.orderId,
            expiresAt: null,
            remainingAmount: 0
          }
        });

        // 2. Mark the original transaction as expired/remainingAmount = 0
        await tx.storeCredit.update({
          where: { id: cred.id },
          data: { remainingAmount: 0 }
        });

        // 3. Decrement from customer's storeCredits balance
        await tx.customer.update({
          where: { id: customerId },
          data: {
            storeCredits: {
              decrement: actualVoid
            }
          }
        });
      });
      console.log(`[Store Credits Helper] Voided expired credit of ₹${toVoid} for customer ${customerId}`);
    }
  } catch (err: any) {
    console.error(`[Store Credits Helper] Error in voidExpiredCredits for customer ${customerId}:`, err.message);
  }
}

/**
 * Debits store credits from a customer's balance using a FIFO ledger approach.
 * Expiring credits are used up first.
 */
export async function debitStoreCredits(customerId: string, amountToDebit: number, orderId?: string) {
  if (amountToDebit <= 0) return;

  // First run expiration cleanup
  await voidExpiredCredits(customerId);

  // Retrieve customer to check balance
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { storeCredits: true }
  });

  if (!customer) {
    throw new Error("Customer not found");
  }

  if (customer.storeCredits < amountToDebit) {
    throw new Error(`Insufficient store credit balance. Available: ₹${customer.storeCredits}`);
  }

  // Find positive credit transactions with remainingAmount > 0
  const activeCredits = await prisma.storeCredit.findMany({
    where: {
      customerId,
      amount: { gt: 0 },
      remainingAmount: { gt: 0 }
    }
  });

  // Sort: credits with expiresAt (expiring first) should be used first, then order by oldest createdAt
  const sortedCredits = [...activeCredits].sort((a, b) => {
    if (a.expiresAt && !b.expiresAt) return -1;
    if (!a.expiresAt && b.expiresAt) return 1;
    if (a.expiresAt && b.expiresAt) {
      return a.expiresAt.getTime() - b.expiresAt.getTime();
    }
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  let remainingDebit = amountToDebit;

  await prisma.$transaction(async (tx: any) => {
    for (const cred of sortedCredits) {
      if (remainingDebit <= 0) break;

      // Lock row to prevent concurrency issues
      const currentCred = await tx.storeCredit.findUnique({
        where: { id: cred.id }
      });
      if (!currentCred || currentCred.remainingAmount <= 0) continue;

      const deduct = Math.min(currentCred.remainingAmount, remainingDebit);

      await tx.storeCredit.update({
        where: { id: cred.id },
        data: {
          remainingAmount: {
            decrement: deduct
          }
        }
      });

      remainingDebit -= deduct;
    }

    // Create the DEBIT transaction
    await tx.storeCredit.create({
      data: {
        customerId,
        amount: -amountToDebit,
        type: "DEBIT",
        description: `Applied to order ${orderId || 'checkout'}`,
        orderId: orderId || null,
        expiresAt: null,
        remainingAmount: 0
      }
    });

    // Update customer's balance
    await tx.customer.update({
      where: { id: customerId },
      data: {
        storeCredits: {
          decrement: amountToDebit
        }
      }
    });
  });

  console.log(`[Store Credits Helper] Successfully debited ₹${amountToDebit} from customer ${customerId}`);
}

/**
 * Utility to check and void all expired credits for all customers at once.
 */
export async function voidAllExpiredCredits() {
  const now = new Date();
  try {
    const expiredCredits = await prisma.storeCredit.findMany({
      where: {
        amount: { gt: 0 },
        expiresAt: { lte: now },
        remainingAmount: { gt: 0 }
      },
      select: {
        customerId: true
      },
      distinct: ['customerId']
    });

    for (const item of expiredCredits) {
      await voidExpiredCredits(item.customerId);
    }
  } catch (err: any) {
    console.error(`[Store Credits Helper] Error in voidAllExpiredCredits:`, err.message);
  }
}

/**
 * Issues store credits to a customer and updates their ledger and balance.
 */
export async function issueStoreCredits({
  customerId,
  amount,
  description,
  orderId,
  returnId,
  expiresAt,
  type = 'exchange_adjustment',
}: {
  customerId: string;
  amount: number;
  description: string;
  orderId?: string;
  returnId?: string;
  expiresAt?: Date | null;
  type?: string;
}) {
  if (amount <= 0) return;

  const result = await prisma.$transaction(async (tx: any) => {
    const cred = await tx.storeCredit.create({
      data: {
        customerId,
        amount,
        type,
        description,
        orderId: orderId || null,
        returnId: returnId || null,
        remainingAmount: amount,
        expiresAt: expiresAt || null,
      }
    });

    await tx.customer.update({
      where: { id: customerId },
      data: {
        storeCredits: {
          increment: amount
        }
      }
    });

    return cred;
  });

  console.log(`[Store Credits Helper] Issued ₹${amount} store credit to customer ${customerId}`);
  return result;
}

/**
 * Record coupon cashback as pending — credited only after delivery.
 * Does not increment the customer's spendable balance yet.
 */
export async function recordPendingCouponCashback({
  customerId,
  amount,
  orderId,
  couponCode,
}: {
  customerId: string;
  amount: number;
  orderId: string;
  couponCode: string;
}) {
  if (amount <= 0) return null;

  const existing = await prisma.storeCredit.findFirst({
    where: {
      orderId,
      type: { in: ['PENDING_COUPON_REBATE', 'COUPON_REBATE'] },
      amount: { gt: 0 },
    },
  });
  if (existing) return existing;

  return prisma.storeCredit.create({
    data: {
      customerId,
      amount,
      type: 'PENDING_COUPON_REBATE',
      description: `Pending cashback for coupon ${couponCode} (releases on delivery)`,
      orderId,
      remainingAmount: amount,
      expiresAt: null,
    },
  });
}

/** Release pending coupon cashback into spendable Store Coins once the order is delivered. */
export async function releasePendingCouponCashback(orderId: string) {
  const pending = await prisma.storeCredit.findFirst({
    where: { orderId, type: 'PENDING_COUPON_REBATE', amount: { gt: 0 } },
  });
  if (!pending) return null;

  const alreadyReleased = await prisma.storeCredit.findFirst({
    where: { orderId, type: 'COUPON_REBATE', amount: { gt: 0 } },
  });
  if (alreadyReleased) {
    await prisma.storeCredit.update({
      where: { id: pending.id },
      data: { remainingAmount: 0, description: `${pending.description} (superseded)` },
    });
    return alreadyReleased;
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 90);

  return prisma.$transaction(async (tx: any) => {
    await tx.storeCredit.update({
      where: { id: pending.id },
      data: {
        type: 'COUPON_REBATE',
        description: pending.description.replace('Pending cashback', 'Cashback'),
        remainingAmount: pending.amount,
        expiresAt,
      },
    });
    await tx.customer.update({
      where: { id: pending.customerId },
      data: { storeCredits: { increment: pending.amount } },
    });
    return pending;
  });
}

/**
 * Claw back coupon cashback when items are returned.
 * Prefer pending (pre-delivery) void; otherwise debit released COUPON_REBATE proportionally.
 */
export async function reverseCouponCashbackForReturn({
  orderId,
  customerId,
  refundAmount,
  orderPaidAmount,
}: {
  orderId: string;
  customerId: string;
  refundAmount: number;
  orderPaidAmount: number;
}) {
  if (refundAmount <= 0) return;

  const pending = await prisma.storeCredit.findFirst({
    where: { orderId, type: 'PENDING_COUPON_REBATE', remainingAmount: { gt: 0 } },
  });
  if (pending) {
    const ratio =
      orderPaidAmount > 0 ? Math.min(1, refundAmount / orderPaidAmount) : 1;
    const clawback = Math.round(pending.amount * ratio * 100) / 100;
    if (clawback <= 0) return;
    await prisma.storeCredit.update({
      where: { id: pending.id },
      data: {
        remainingAmount: Math.max(0, pending.remainingAmount - clawback),
        amount: Math.max(0, pending.amount - clawback),
        description: `${pending.description} · reversed ₹${clawback} on return`,
      },
    });
    return;
  }

  const released = await prisma.storeCredit.findFirst({
    where: { orderId, type: 'COUPON_REBATE', amount: { gt: 0 } },
  });
  if (!released) return;

  const ratio = orderPaidAmount > 0 ? Math.min(1, refundAmount / orderPaidAmount) : 1;
  const clawback = Math.min(
    released.remainingAmount > 0 ? released.remainingAmount : released.amount,
    Math.round(released.amount * ratio * 100) / 100
  );
  if (clawback <= 0) return;

  try {
    // debitStoreCredits writes the ledger DEBIT + decrements balance (FIFO).
    await debitStoreCredits(customerId, clawback, orderId);
  } catch (err: any) {
    console.error(`[Store Credits] Cashback reversal failed for order ${orderId}:`, err?.message);
  }
}

