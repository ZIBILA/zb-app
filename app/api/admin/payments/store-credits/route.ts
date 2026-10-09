import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { voidAllExpiredCredits, voidExpiredCredits } from "@/lib/storeCreditsHelper";
import { requirePermission, handleAuthError } from "@/lib/auth/rbac";

export async function GET(req: Request) {
  try {
    await requirePermission('FINANCIAL', 'view');
    const { searchParams } = new URL(req.url);
    const customerId = searchParams.get("customerId");
    const search = searchParams.get("search")?.trim();
    const limit = parseInt(searchParams.get("limit") || "100", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    if (customerId) {
      await voidExpiredCredits(customerId);
      const history = await prisma.storeCredit.findMany({
        where: { customerId },
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json({ history });
    }

    // Process expired credits for all customers
    await voidAllExpiredCredits();

    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { shopifyId: { contains: search } },
      ];
    }

    const customers = await prisma.customer.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        storeCredits: true,
        shopifyId: true,
      },
      orderBy: { storeCredits: "desc" },
      take: limit,
      skip: offset,
    });

    const total = await prisma.customer.count({ where });

    // Calculate aggregated metrics for the overview panel
    const aggregate = await prisma.customer.aggregate({
      _sum: {
        storeCredits: true,
      },
      _count: {
        id: true,
      },
      where: {
        storeCredits: {
          gt: 0,
        },
      },
    });

    const overview = {
      totalOutstanding: aggregate._sum.storeCredits || 0,
      activeCustomers: aggregate._count.id || 0,
    };

    return NextResponse.json({ customers, total, overview });
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    console.error("Store Credit GET Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await requirePermission('FINANCIAL', 'edit');
    const body = await req.json();
    const { customerId, amount, type, description, orderId, returnId } = body;

    if (!customerId || amount === undefined) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx: any) => {
      // 1. Create the transaction record
      const txn = await tx.storeCredit.create({
        data: {
          customerId,
          amount: parseFloat(amount),
          type: type || "MANUAL",
          description: description || "Manual adjustment",
          orderId,
          returnId,
          // Only positive adjustments are spendable credit; negative ones are ledger debits.
          remainingAmount: Math.max(0, parseFloat(amount)),
        },
      });

      // 2. Update the customer's balance
      const customer = await tx.customer.update({
        where: { id: customerId },
        data: {
          storeCredits: {
            increment: parseFloat(amount),
          },
        },
      });

      return { txn, balance: customer.storeCredits };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    console.error("Store Credit POST Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
