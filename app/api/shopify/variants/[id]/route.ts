import { NextResponse } from 'next/server';
import { updateVariant } from '@/lib/shopify-admin';
import { requireAdmin, handleAuthError } from "@/lib/auth/rbac";

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdmin('PRODUCTS', 'edit');

    const body = await req.json();
    const { sku, barcode, price } = body;
    
    if (!sku && !barcode && !price) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const updated = await updateVariant(params.id, { sku, barcode, price });
    return NextResponse.json({ variant: updated });
  } catch (error: any) {
    if (error?.message === '401' || error?.message === '403') {
      return handleAuthError(error);
    }
    console.error('Shopify Variant PATCH Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
