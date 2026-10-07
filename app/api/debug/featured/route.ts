import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Show which DB we're connecting to (masked)
    const dbUrl = process.env.DATABASE_URL || '';
    const maskedUrl = dbUrl.replace(/:[^:@]+@/, ':***@').substring(0, 80);
    
    // Test 1: Raw count
    const count = await prisma.featuredUser.count();
    
    // Test 2: findMany without any filter
    const allUsers = await prisma.featuredUser.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        isTopFeatured: true,
        imageUrl: true,
      }
    });
    
    // Test 3: All table counts via raw SQL
    let tableCounts: any = {};
    try {
      const tables = ['Shop', 'Customer', 'Order', 'OrderItem', 'FeaturedUser', 'Review', 'Admin', 'BlogPost'];
      for (const table of tables) {
        const result: any = await prisma.$queryRawUnsafe(`SELECT count(*) as c FROM "${table}"`);
        tableCounts[table] = Number(result[0]?.c || 0);
      }
    } catch (e: any) {
      tableCounts = { error: e.message };
    }
    
    // Test 4: Raw SQL for FeaturedUser
    let rawResult: any = [];
    try {
      rawResult = await prisma.$queryRawUnsafe('SELECT id, name, status FROM "FeaturedUser" LIMIT 10');
    } catch (e: any) {
      rawResult = { error: e.message };
    }

    return NextResponse.json({
      dbUrlPrefix: maskedUrl,
      totalCount: count,
      allUsers,
      tableCounts,
      rawResult,
      prismaIsMock: (prisma as any)._isMock || false,
      timestamp: new Date().toISOString(),
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
      }
    });
  } catch (error: any) {
    return NextResponse.json({ 
      error: error.message,
      stack: error.stack?.substring(0, 500),
      dbUrl: (process.env.DATABASE_URL || '').replace(/:[^:@]+@/, ':***@').substring(0, 80),
    }, { status: 500 });
  }
}
