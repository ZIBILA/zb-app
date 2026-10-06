import prisma from '../lib/db';

async function main() {
  console.log('Seeding demo user and orders...');

  // Ensure Shop exists
  let shop = await prisma.shop.findFirst();
  if (!shop) {
    shop = await prisma.shop.create({
      data: {
        domain: 'demo-shop.myshopify.com',
        accessToken: 'demo-token',
      },
    });
  }

  // Demo user data
  const phone = '+919876543210';

  let customer = await prisma.customer.findFirst({
    where: { phone },
  });

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        shopId: shop.id,
        shopifyId: 'demo_user_shopify_id',
        name: 'Demo App Reviewer',
        phone: phone,
        email: 'appreview@apple.com',
        defaultAddress: '1 Apple Park Way, Cupertino, CA 95014',
      },
    });
    console.log('Created Demo User.');
  } else {
    console.log('Demo User already exists.');
  }

  // Create a product to use in orders
  const product = await prisma.product.upsert({
    where: { shopifyProductId: 'demo_product_1' },
    create: {
      shopId: shop.id,
      shopifyProductId: 'demo_product_1',
      title: 'Zica Bella Signature Hoodie',
      price: 4999.0,
      featuredImage: 'https://zicabella.com/demo-hoodie.jpg',
    },
    update: {},
  });

  // Create 3 orders with different statuses
  const ordersData = [
    {
      shopifyOrderId: 'demo_order_1',
      status: 'PROCESSING',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'UNFULFILLED',
      deliveryStatus: 'pending',
    },
    {
      shopifyOrderId: 'demo_order_2',
      status: 'SHIPPED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      deliveryStatus: 'in_transit',
    },
    {
      shopifyOrderId: 'demo_order_3',
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      fulfillmentStatus: 'FULFILLED',
      deliveryStatus: 'delivered',
    },
  ];

  for (const orderData of ordersData) {
    let order = await prisma.order.findUnique({
      where: { shopifyOrderId: orderData.shopifyOrderId },
    });

    if (!order) {
      order = await prisma.order.create({
        data: {
          shopId: shop.id,
          customerId: customer.id,
          shopifyOrderId: orderData.shopifyOrderId,
          status: orderData.status,
          totalPrice: 4999.0,
          paymentStatus: orderData.paymentStatus,
          fulfillmentStatus: orderData.fulfillmentStatus,
          deliveryStatus: orderData.deliveryStatus,
          shippingAddress: '1 Apple Park Way, Cupertino, CA 95014',
          items: {
            create: [
              {
                shopifyLineItemId: `line_${orderData.shopifyOrderId}`,
                productId: product.id,
                title: product.title,
                quantity: 1,
                price: product.price ?? 4999,
                image: product.featuredImage,
              },
            ],
          },
        },
      });
      console.log(`Created Order ${orderData.shopifyOrderId} with status ${orderData.status}`);
    } else {
      console.log(`Order ${orderData.shopifyOrderId} already exists.`);
    }
  }

  console.log('Seeding completed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
