import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

// GET: Fetch all discounts from both Discount (app) and WebStoreCoupon (webstore) tables and merge them
export async function GET() {
  try {
    await requirePermission('MARKETING', 'view');

    const [appDiscounts, webCoupons] = await Promise.all([
      db.discount.findMany({ orderBy: { createdAt: 'desc' } }),
      db.webStoreCoupon.findMany({ orderBy: { createdAt: 'desc' } })
    ]);

    // Merge by code (case-insensitive key, standard is uppercase)
    const campaignsMap = new Map<string, any>();

    // Process Web Store coupons
    for (const c of webCoupons) {
      const code = c.code.toUpperCase().trim();
      campaignsMap.set(code, {
        id: c.id,
        code,
        targets: ['webstore'],
        description: '',
        validFrom: c.validFrom,
        validUntil: c.validUntil,
        usageLimit: c.usageLimit,
        usedCount: c.usedCount,
        isActive: c.isActive,
        autoApply: c.autoApply,
        isSecure: c.isSecure,
        createdAt: c.createdAt,
        webstoreSettings: {
          discountType: c.discountType,
          discountValue: Number(c.discountValue),
          minOrderValue: Number(c.minOrderValue),
          applicability: c.applicability,
          prepaidDiscountType: c.prepaidDiscountType,
          prepaidDiscountValue: Number(c.prepaidDiscountValue),
          codDiscountType: c.codDiscountType,
          codDiscountValue: Number(c.codDiscountValue),
          applyAsStoreCredit: c.applyAsStoreCredit,
          cashbackEnabled: c.cashbackEnabled,
          cashbackType: c.cashbackType,
          cashbackValue: Number(c.cashbackValue),
        },
        appSettings: null
      });
    }

    // Process App discounts
    for (const d of appDiscounts) {
      const code = d.code.toUpperCase().trim();
      const existing = campaignsMap.get(code);

      if (existing) {
        existing.targets.push('app');
        existing.description = d.description || existing.description;
        existing.autoApply = existing.autoApply || d.autoApply;
        existing.isSecure = existing.isSecure || d.isSecure;
        existing.appSettings = {
          id: d.id,
          type: d.type,
          value: d.value,
          minOrderAmount: d.minOrderAmount,
          maxDiscount: d.maxDiscount,
          applicability: d.applicability,
          cashbackEnabled: d.cashbackEnabled,
          cashbackType: d.cashbackType,
          cashbackValue: d.cashbackValue,
        };
      } else {
        campaignsMap.set(code, {
          id: d.id,
          code,
          targets: ['app'],
          description: d.description || '',
          validFrom: d.startDate,
          validUntil: d.endDate ? d.endDate : null,
          usageLimit: d.usageLimit,
          usedCount: d.usageCount,
          isActive: d.isActive,
          autoApply: d.autoApply,
          isSecure: d.isSecure,
          createdAt: d.createdAt,
          webstoreSettings: null,
          appSettings: {
            id: d.id,
            type: d.type,
            value: d.value,
            minOrderAmount: d.minOrderAmount,
            maxDiscount: d.maxDiscount,
            applicability: d.applicability,
            cashbackEnabled: d.cashbackEnabled,
            cashbackType: d.cashbackType,
            cashbackValue: d.cashbackValue,
          }
        });
      }
    }

    const campaigns = Array.from(campaignsMap.values()).sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return NextResponse.json({ success: true, discounts: campaigns });
  } catch (error: any) {
    return handleAuthError(error);
  }
}

// POST: Create or update a discount campaign in the respective tables based on target selection
export async function POST(req: Request) {
  try {
    await requirePermission('MARKETING', 'edit');

    const body = await req.json();
    const {
      code,
      targets, // Array e.g., ['webstore', 'app']
      description,
      validFrom,
      validUntil,
      usageLimit,
      isActive,
      autoApply,
      isSecure,
      webstoreSettings,
      appSettings
    } = body;

    if (!code || !targets || !Array.isArray(targets) || targets.length === 0) {
      return NextResponse.json({ success: false, error: 'Promo code and target channel selection are required' }, { status: 400 });
    }

    const formattedCode = String(code).toUpperCase().trim();

    await db.$transaction(async (tx: any) => {
      // 1. Delete existing codes in both tables to avoid conflicts and perform a clean upsert
      await tx.webStoreCoupon.deleteMany({
        where: { code: formattedCode }
      });
      await tx.discount.deleteMany({
        where: { code: formattedCode }
      });

      // 2. Create in WebStoreCoupon table if webstore is targeted
      if (targets.includes('webstore') && webstoreSettings) {
        await tx.webStoreCoupon.create({
          data: {
            code: formattedCode,
            discountType: webstoreSettings.discountType || 'percentage',
            discountValue: parseFloat(webstoreSettings.discountValue || 0),
            minOrderValue: parseFloat(webstoreSettings.minOrderValue || 0),
            usageLimit: usageLimit ? parseInt(usageLimit) : null,
            usedCount: 0,
            validFrom: validFrom ? new Date(validFrom) : new Date(),
            validUntil: validUntil ? new Date(validUntil) : new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000), // 100 years fallback
            isActive: isActive !== undefined ? !!isActive : true,
            autoApply: autoApply !== undefined ? !!autoApply : false,
            isSecure: isSecure !== undefined ? !!isSecure : false,
            applicability: webstoreSettings.applicability || 'ALL',
            prepaidDiscountType: webstoreSettings.prepaidDiscountType || 'percentage',
            prepaidDiscountValue: parseFloat(webstoreSettings.prepaidDiscountValue || 0),
            codDiscountType: webstoreSettings.codDiscountType || 'percentage',
            codDiscountValue: parseFloat(webstoreSettings.codDiscountValue || 0),
            applyAsStoreCredit: webstoreSettings.applyAsStoreCredit !== undefined ? !!webstoreSettings.applyAsStoreCredit : false,
            cashbackEnabled: webstoreSettings.cashbackEnabled !== undefined ? !!webstoreSettings.cashbackEnabled : false,
            cashbackType: webstoreSettings.cashbackType || 'percentage',
            cashbackValue: parseFloat(webstoreSettings.cashbackValue || 0),
          }
        });
      }

      // 3. Create in Discount table if app is targeted
      if (targets.includes('app') && appSettings) {
        await tx.discount.create({
          data: {
            code: formattedCode,
            type: appSettings.type || 'percentage',
            value: parseFloat(appSettings.value || 0),
            minOrderAmount: parseFloat(appSettings.minOrderAmount || 0),
            maxDiscount: appSettings.maxDiscount ? parseFloat(appSettings.maxDiscount) : null,
            startDate: validFrom ? new Date(validFrom) : new Date(),
            endDate: validUntil ? new Date(validUntil) : null,
            usageLimit: usageLimit ? parseInt(usageLimit) : null,
            usageCount: 0,
            isActive: isActive !== undefined ? !!isActive : true,
            autoApply: autoApply !== undefined ? !!autoApply : false,
            isSecure: isSecure !== undefined ? !!isSecure : false,
            applicability: appSettings.applicability === 'PREPAID_ONLY' ? 'PREPAID_ONLY' : 'ALL',
            description: description || '',
            cashbackEnabled: appSettings.cashbackEnabled !== undefined ? !!appSettings.cashbackEnabled : false,
            cashbackType: appSettings.cashbackType || 'percentage',
            cashbackValue: parseFloat(appSettings.cashbackValue || 0),
          }
        });
      }
    });

    return NextResponse.json({ success: true, message: 'Discount campaign saved successfully!' });
  } catch (error: any) {
    if (error.code === 'P2002') {
      return NextResponse.json({ success: false, error: 'Promo code already exists' }, { status: 400 });
    }
    return handleAuthError(error);
  }
}

// DELETE: Delete discount campaign from both tables
export async function DELETE(req: Request) {
  try {
    await requirePermission('MARKETING', 'edit');

    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const id = searchParams.get('id');

    if (!code && !id) {
      return NextResponse.json({ error: 'Missing code or id' }, { status: 400 });
    }

    let targetCode = code;
    if (!targetCode && id) {
      // Find code by ID from either table
      const wCoupon = await db.webStoreCoupon.findUnique({ where: { id } });
      if (wCoupon) {
        targetCode = wCoupon.code;
      } else {
        const appDisc = await db.discount.findUnique({ where: { id } });
        if (appDisc) targetCode = appDisc.code;
      }
    }

    if (!targetCode) {
      return NextResponse.json({ error: 'Discount not found' }, { status: 404 });
    }

    const formattedCode = targetCode.toUpperCase().trim();

    await db.$transaction(async (tx: any) => {
      await tx.webStoreCoupon.deleteMany({
        where: { code: formattedCode }
      });
      await tx.discount.deleteMany({
        where: { code: formattedCode }
      });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return handleAuthError(error);
  }
}
