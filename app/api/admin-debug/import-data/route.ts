import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import prisma from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  
  const expectedSecret = process.env.ADMIN_SESSION_TOKEN;
  
  if (!expectedSecret || !secret || secret !== expectedSecret) {
    return NextResponse.json({ 
      error: 'Unauthorized. Please provide the correct ?secret= query parameter.' 
    }, { status: 401 });
  }

  const projectRoot = process.cwd();
  console.log(`[IMPORT-DATA] Running database data import in ${projectRoot}...`);

  try {
    const targetDomain = process.env.SHOPIFY_STORE_DOMAIN || '8tiahf-bk.myshopify.com';
    const targetShopId = 'cmmo2q3he0000gyuemfwdy2z9';

    // Delete any existing shop with conflicting domain or ID to prevent unique/primary key conflicts
    await prisma.shop.deleteMany({
      where: {
        OR: [
          { domain: targetDomain },
          { id: targetShopId }
        ]
      }
    });

    // Step 1: Create the precise Shop ID record so that foreign key constraints pass
    const shop = await prisma.shop.create({
      data: {
        id: targetShopId,
        domain: targetDomain,
        accessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '',
      }
    });

    console.log(`[IMPORT-DATA] Shop record synchronized successfully: ${shop.id}`);

    return new Promise<Response>((resolve) => {
      // Step 2: Import customers from customers_export.csv
      exec('npx tsx scripts/import-customers.ts', { cwd: projectRoot }, (custError, custStdout, custStderr) => {
        const custLogs = {
          error: custError ? custError.message : null,
          stdout: custStdout.trim(),
          stderr: custStderr.trim()
        };

        if (custError) {
          console.error('[IMPORT-DATA] Customer import failed:', custError);
          resolve(NextResponse.json({
            success: false,
            stage: 'customer_import_failed',
            custLogs
          }));
          return;
        }

        console.log('[IMPORT-DATA] Customer import completed successfully. Seeding orders...');

        // Step 3: Import orders from orders_export_1.csv
        exec('npx tsx scripts/import-orders.ts', { cwd: projectRoot }, (orderError, orderStdout, orderStderr) => {
          const orderLogs = {
            error: orderError ? orderError.message : null,
            stdout: orderStdout.trim(),
            stderr: orderStderr.trim()
          };

          resolve(NextResponse.json({
            success: !orderError,
            stage: orderError ? 'order_import_failed' : 'completed',
            custLogs,
            orderLogs
          }));
        });
      });
    });

  } catch (error: any) {
    console.error('[IMPORT-DATA] Database pre-setup failed:', error);
    return NextResponse.json({
      success: false,
      stage: 'db_setup_failed',
      error: error.message
    }, { status: 500 });
  }
}
