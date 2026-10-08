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
export async function debitStoreCredits(
  customerId: string,
  amountToDebit: number,
  orderId?: string,
  options: { idempotencyKey?: string } = {},
): Promise<{ applied: boolean }> {
  if (amountToDebit <= 0) return { applied: false };

  // Idempotency: one DEBIT per redemption reference. A retried / duplicate request
  // for the same order is a no-op (the first debit stands). The unique column also
  // makes two concurrent requests safe: the second insert fails and its whole
  // transaction rolls back, so the balance is decremented exactly once.
  const idempotencyKey = options.idempotencyKey?.trim() || undefined;
  if (idempotencyKey) {
    const already = await prisma.storeCredit.findUnique({ where: { idempotencyKey }, select: { id: true } });
    if (already) {
      console.log(`[Store Credits Helper] Debit ${idempotencyKey} already applied — skipping duplicate`);
      return { applied: false };
    }
  }

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

  const duplicate = await prisma.$transaction(async (tx: any) => {
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
        remainingAmount: 0,
        ...(idempotencyKey ? { idempotencyKey } : {}),
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
  }).then(
    () => false,
    (err: any) => {
      // Concurrent duplicate of the same redemption: the other request's debit won
      // and this transaction was rolled back in full.
      if (idempotencyKey && err?.code === 'P2002') return true;
      throw err;
    },
  );
  if (duplicate) {
    console.log(`[Store Credits Helper] Concurrent duplicate debit ${idempotencyKey} rolled back`);
    return { applied: false };
  }

  console.log(`[Store Credits Helper] Successfully debited ₹${amountToDebit} from customer ${customerId}`);
  return { applied: true };
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
}: {
  customerId: string;
  amount: number;
  description: string;
  orderId?: string;
  returnId?: string;
  expiresAt?: Date | null;
}) {
  if (amount <= 0) return;

  const result = await prisma.$transaction(async (tx: any) => {
    const cred = await tx.storeCredit.create({
      data: {
        customerId,
        amount,
        type: 'exchange_adjustment',
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

