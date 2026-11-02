import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { withoutShopifyRefundMirrors } from '@/lib/returns-filter';

export async function POST(req: Request) {
  try {
    const { customerId, shopDomain, orderId, itemId, type, reason, newProductId } = await req.json();

    if (!customerId || !shopDomain || !orderId || !itemId || !type || !reason) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
    if (!shop) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
    }

    const orderItem = await prisma.orderItem.findUnique({ where: { id: itemId } });
    if (!orderItem) {
      return NextResponse.json({ error: 'Order item not found' }, { status: 404 });
    }

    if (type === 'return') {
      const existingReturn = await prisma.return.findFirst({
        where: withoutShopifyRefundMirrors({ orderId, productId: orderItem.productId as string })
      });
      if (existingReturn) {
        return NextResponse.json({ error: 'Return request already exists for this item' }, { status: 400 });
      }

      await prisma.return.create({
        data: {
          orderId,
          productId: orderItem.productId as string,
          customerId,
          sku: orderItem.sku,
          reason,
          status: 'requested'
        }
      });
    } else if (type === 'exchange') {
      if (!newProductId) {
        return NextResponse.json({ error: 'Missing new product selection for exchange' }, { status: 400 });
      }

      const existingExchange = await prisma.exchange.findFirst({
        where: { orderId, originalProductId: orderItem.productId as string }
      });
      if (existingExchange) {
        return NextResponse.json({ error: 'Exchange request already exists for this item' }, { status: 400 });
      }

      const originalProduct = await prisma.product.findUnique({ where: { id: orderItem.productId as string } });
      const newProductItem = await prisma.product.findUnique({ where: { id: newProductId } });

      if (!originalProduct || !newProductItem) {
        return NextResponse.json({ error: 'Product not found' }, { status: 404 });
      }

      // Basic price difference calculation (assuming price is needed; in real life, get from DB)
      // Since we don't have price on Product model, we assume $0 diff for mock
      const priceDifference = 0; 
      
      await prisma.exchange.create({
        data: {
          orderId,
          originalProductId: orderItem.productId as string,
          newProductId,
          status: 'requested',
          priceDifference
        }
      });
    } else {
      return NextResponse.json({ error: 'Invalid request type' }, { status: 400 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Portal Request API Error:', error);
    return NextResponse.json({ error: 'Failed to submit request' }, { status: 500 });
  }
}
