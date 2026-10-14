import prisma from '../lib/db';

async function main() {
  const apply = process.argv.includes('--apply');

  console.log(`Checking for orders with stale cancelledBy / cancelledAt on paid orders... (apply=${apply})`);

  // 1. Orders that are paid/delivered/active but still have cancelledBy lingering from checkout modal dismissals
  const staleCancelledOrders = await prisma.order.findMany({
    where: {
      paymentStatus: { in: ['paid', 'cod_upfront_paid', 'partially_paid'] },
      cancelledBy: { not: null },
    },
    select: {
      id: true,
      internalOrderNumber: true,
      status: true,
      paymentStatus: true,
      deliveryStatus: true,
      cancelledBy: true,
      cancelledAt: true,
      createdAt: true,
    },
  });

  console.log(`Found ${staleCancelledOrders.length} orders with paymentStatus in paid-like but cancelledBy set:`);
  for (const o of staleCancelledOrders) {
    console.log(`- ${o.internalOrderNumber || o.id}: status=${o.status}, paymentStatus=${o.paymentStatus}, deliveryStatus=${o.deliveryStatus}, cancelledBy=${o.cancelledBy}, cancelledAt=${o.cancelledAt}`);
  }

  if (staleCancelledOrders.length > 0 && apply) {
    const ids = staleCancelledOrders.map(o => o.id);
    const updated = await prisma.order.updateMany({
      where: { id: { in: ids } },
      data: {
        cancelledBy: null,
        cancelledAt: null,
        // If status was marked 'cancelled' on a paid order, restore to 'approved' or 'active'
        status: 'approved',
      },
    });
    console.log(`Successfully cleared stale cancelledBy on ${updated.count} orders.`);
  }

  // 2. Also check WebStoreOrder table if it exists
  try {
    const staleWso = await prisma.webStoreOrder.findMany({
      where: {
        paymentStatus: { in: ['paid', 'cod_upfront_paid', 'partially_paid'] },
        status: { in: ['cancelled', 'canceled'] },
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
      },
    });
    console.log(`Found ${staleWso.length} WebStoreOrder rows with paid paymentStatus but cancelled status:`);
    for (const w of staleWso) {
      console.log(`- WSO ${w.orderNumber}: status=${w.status}, paymentStatus=${w.paymentStatus}`);
    }
    if (staleWso.length > 0 && apply) {
      const wsoIds = staleWso.map(w => w.id);
      await prisma.webStoreOrder.updateMany({
        where: { id: { in: wsoIds } },
        data: {
          status: 'confirmed',
        },
      });
      console.log(`Successfully restored ${staleWso.length} WebStoreOrder rows.`);
    }
  } catch (err: any) {
    console.log(`WebStoreOrder check skipped or completed: ${err?.message}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
