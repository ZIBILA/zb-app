import { NextResponse } from 'next/server';
import { fetchCustomers } from '@/lib/shopify-admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const rawLimit = url.searchParams.get('limit') || url.searchParams.get('pageSize') || '50';
    const pageSize = Math.min(Math.max(parseInt(rawLimit, 10) || 50, 1), 250);

    // Single page only — do not walk the full customer list on every poll
    const customers = await fetchCustomers(pageSize);

    return NextResponse.json({ customers }, { status: 200 });
  } catch (error: any) {
    console.error('Shopify Customers API Error:', error?.message || 'fetch failed');
    return NextResponse.json(
      { customers: [], error: 'Failed to fetch customers' },
      { status: 200 },
    );
  }
}
