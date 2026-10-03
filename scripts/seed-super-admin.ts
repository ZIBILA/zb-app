import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import bcrypt from 'bcryptjs';

// Load environment variables
const envLocalPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else {
  dotenv.config();
}

}

const dbUrl = process.env.POSTGRES_PRISMA_URL || 
              process.env.POSTGRES_URL || 
              process.env.DATABASE_URL;

async function main() {
  if (!dbUrl) {
    console.error('❌ Error: No database URL found in environment variables');
    process.exit(1);
  }

  const sanitizedPgUrl = dbUrl.includes('sslmode=require') 
    ? dbUrl.replace('sslmode=require', 'sslmode=no-verify')
    : dbUrl;

  console.log(`📡 Database URL detected: ${sanitizedPgUrl.substring(0, 15)}...`);

  let prisma: PrismaClient;
  let pool: Pool | undefined;

  try {
    pool = new Pool({ 
      connectionString: sanitizedPgUrl,
      ssl: { rejectUnauthorized: false }
    });
    const adapter = new PrismaPg(pool as any);
    prisma = new PrismaClient({ adapter });

    const email = process.env.SUPER_ADMIN_EMAIL || 'admin@zicabella.com';
    const password = process.env.SUPER_ADMIN_PASSWORD;

    if (!password) {
      console.error('❌ Error: SUPER_ADMIN_PASSWORD is not set in environment variables');
      process.exit(1);
    }

    console.log(`🚀 Processing Super Admin: ${email}...`);

    const hashedPassword = await bcrypt.hash(password, 12);

    const superAdmin = await prisma.user.upsert({
      where: { email: email.toLowerCase().trim() },
      update: {
        passwordHash: hashedPassword,
        role: 'SUPER_ADMIN',
        isActive: true,
        needsPasswordChange: false,
        failedLoginAttempts: 0,
        lockUntil: null,
      },
      create: {
        email: email.toLowerCase().trim(),
        passwordHash: hashedPassword,
        name: 'Super Admin',
        role: 'SUPER_ADMIN',
        isActive: true,
        needsPasswordChange: false,
        failedLoginAttempts: 0,
        lockUntil: null,
      }
    });

    console.log(`✅ Super Admin ${superAdmin.email} processed.`);

    // Updated module list matching the expanded enum
    const modules = [
      'DASHBOARD_HOME', 'SUPPORT', 'ORDERS', 'MOBILE_ORDERS', 'CUSTOMERS',
      'PRODUCTS', 'INVENTORY', 'LOGISTICS', 'RETURNS_EXCHANGES', 'STOREFRONT',
      'COMMUNITY', 'MARKETING', 'MANUFACTURING', 'FINANCIAL', 'INTEGRATIONS',
      'SETTINGS', 'ADMIN_USERS', 'AUDIT_LOG'
    ];

    console.log('🚀 Granting full permissions for all modules...');

    for (const moduleName of modules) {
      await prisma.permission.upsert({
        where: {
          userId_module: {
            userId: superAdmin.id,
            module: moduleName as any,
          }
        },
        update: {
          canView: true,
          canEdit: true,
          canDelete: true,
        },
        create: {
          userId: superAdmin.id,
          module: moduleName as any,
          canView: true,
          canEdit: true,
          canDelete: true,
        }
      });
    }

    console.log('✅ Full permissions granted.');
    
    // Consistency check with legacy Admin table
    try {
      const legacyAdmin = await (prisma as any).admin.findUnique({
        where: { username: 'admin' }
      });
      if (legacyAdmin) {
        await (prisma as any).admin.update({
          where: { username: 'admin' },
          data: { password: hashedPassword }
        });
        console.log('✅ Legacy Admin table synchronized.');
      }
    } catch (e) {}

  } catch (err) {
    console.error('❌ Failed:', err);
    throw err;
  } finally {
    if (pool) await pool.end();
  }
}

main().catch((e) => {
  console.error('❌ FATAL:', e);
  process.exit(1);
});
