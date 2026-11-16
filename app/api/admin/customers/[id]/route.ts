import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { updateCustomer, fetchOrdersByCustomerId } from '@/lib/shopify-admin';
import { requirePermission, handleAuthError } from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission('CUSTOMERS', 'view');

    const customer = await prisma.customer.findUnique({
      where: { id: params.id },
      include: {
        addresses: true,
        orders: {
          include: {
            items: true
          }
        }
      }
    });

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    let updatedName = customer.name;
    let updatedEmail = customer.email;
    let updatedPhone = customer.phone;
    let detailsChanged = false;

    // 1. Extract Details and Addresses from Shopify Orders
    if (customer.shopifyId && !customer.shopifyId.startsWith('otp_') && !customer.shopifyId.startsWith('mobile_') && !customer.shopifyId.startsWith('temp_') && !customer.shopifyId.startsWith('google_') && !customer.shopifyId.startsWith('apple_')) {
      try {
        const shopifyOrders = await fetchOrdersByCustomerId(customer.shopifyId);
        for (const order of shopifyOrders) {
          if (order.customer) {
            if (!updatedName) {
              updatedName = `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim();
              detailsChanged = true;
            }
            if (!updatedEmail && order.customer.email) {
              updatedEmail = order.customer.email;
              detailsChanged = true;
            }
            if (!updatedPhone && order.customer.phone) {
              updatedPhone = order.customer.phone;
              detailsChanged = true;
            }
          }

          const addressesToSync = [];
          if (order.shipping_address) addressesToSync.push(order.shipping_address);
          if (order.billing_address) addressesToSync.push(order.billing_address);

          for (const addr of addressesToSync) {
            const address1 = addr.address1;
            const city = addr.city;
            const zip = addr.zip;
            if (!address1 || !city || !zip) continue;

            const exists = await prisma.address.findFirst({
              where: {
                customerId: customer.id,
                address1,
                city,
                zip
              }
            });

            if (!exists) {
              await prisma.address.create({
                data: {
                  customerId: customer.id,
                  name: `${addr.first_name || ""} ${addr.last_name || ""}`.trim() || updatedName || "Customer",
                  phone: addr.phone || updatedPhone,
                  address1,
                  address2: addr.address2 || "",
                  city,
                  state: addr.province || "",
                  zip,
                  country: addr.country || "India",
                  isDefault: false
                }
              }).catch(() => {});
            }
          }
        }
      } catch (shopifyErr: any) {
        console.error(`[Shopify Orders Extraction Failed] ID: ${customer.shopifyId}`, shopifyErr.message);
      }
    }

    // 2. Extract Details and Addresses from Local Database Orders
    for (const order of customer.orders) {
      let shippingAddr = null;
      let billingAddr = null;
      try {
        if (order.shippingAddress) shippingAddr = JSON.parse(order.shippingAddress);
      } catch {}
      try {
        if (order.billingAddress) billingAddr = JSON.parse(order.billingAddress);
      } catch {}

      const localAddresses = [];
      if (shippingAddr) localAddresses.push(shippingAddr);
      if (billingAddr) localAddresses.push(billingAddr);

      for (const addr of localAddresses) {
        const address1 = addr.address1 || addr.street || addr.address;
        const city = addr.city;
        const zip = addr.zip;
        if (!address1 || !city || !zip) continue;

        if (!updatedName && addr.name) {
          updatedName = addr.name;
          detailsChanged = true;
        }
        if (!updatedEmail && addr.email) {
          updatedEmail = addr.email;
          detailsChanged = true;
        }
        if (!updatedPhone && addr.phone) {
          updatedPhone = addr.phone;
          detailsChanged = true;
        }

        const exists = await prisma.address.findFirst({
          where: {
            customerId: customer.id,
            address1,
            city,
            zip
          }
        });

        if (!exists) {
          await prisma.address.create({
            data: {
              customerId: customer.id,
              name: addr.name || updatedName || "Customer",
              phone: addr.phone || updatedPhone,
              address1,
              address2: addr.address2 || "",
              city,
              state: addr.state || addr.province || "",
              zip,
              country: addr.country || "India",
              isDefault: false
            }
          }).catch(() => {});
        }
      }
    }

    if (detailsChanged) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: {
          name: updatedName,
          email: updatedEmail,
          phone: updatedPhone
        }
      });
    }

    const finalCustomer = await prisma.customer.findUnique({
      where: { id: params.id },
      include: {
        addresses: {
          orderBy: { isDefault: 'desc' }
        },
        wishlist: {
          include: {
            product: true
          }
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          include: {
            items: true
          }
        }
      }
    });

    const { getCustomerStats } = await import('@/lib/services/customerStats');
    const stats = await getCustomerStats(params.id).catch(() => null);

    return NextResponse.json({
      success: true,
      customer: finalCustomer ? { ...finalCustomer, ...(stats ? { placedOrders: stats.orders, lifetimeRevenue: stats.revenue } : {}) } : finalCustomer
    });
  } catch (error) {
    return handleAuthError(error);
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    await requirePermission('CUSTOMERS', 'edit');
    const { name, email, phone, whatsappOptedOut } = await req.json();

    const customer = await prisma.customer.findUnique({
      where: { id: params.id }
    });

    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    }

    const cleanEmail = email ? String(email).trim().toLowerCase() : null;
    const cleanPhone = phone ? String(phone).trim() : null;
    const cleanName = name ? String(name).trim() : customer.name;

    // Check if another customer record exists with this email or phone
    if (cleanEmail || cleanPhone) {
      const phoneDigits = cleanPhone ? cleanPhone.replace(/\D/g, '').slice(-10) : '';
      const duplicate = await prisma.customer.findFirst({
        where: {
          id: { not: customer.id },
          OR: [
            ...(cleanEmail ? [{ email: cleanEmail }] : []),
            ...(phoneDigits.length === 10 ? [{ phone: { contains: phoneDigits } }] : []),
          ]
        }
      });

      if (duplicate) {
        // Trigger customer deduplication to merge relations into primary record
        const { mergeAllDuplicateCustomers } = await import('@/lib/services/customerDeduplicationService');
        await mergeAllDuplicateCustomers();
      }
    }

    // 1. Update Shopify if they are synced
    if (customer.shopifyId && !customer.shopifyId.startsWith('otp_') && !customer.shopifyId.startsWith('mobile_') && !customer.shopifyId.startsWith('temp_') && !customer.shopifyId.startsWith('google_') && !customer.shopifyId.startsWith('apple_')) {
      try {
        const nameParts = (cleanName || '').trim().split(/\s+/);
        const firstName = nameParts[0] || '';
        const lastName = nameParts.slice(1).join(' ') || '.';

        await updateCustomer(customer.shopifyId, {
          first_name: firstName,
          last_name: lastName,
          email: cleanEmail || undefined,
          phone: cleanPhone || undefined
        });
      } catch (shopifyErr: any) {
        console.error(`[Shopify Customer Update Failed] ID: ${customer.shopifyId}`, shopifyErr.message);
      }
    }

    // 2. Update local DB
    const updatedCustomer = await prisma.customer.update({
      where: { id: params.id },
      data: {
        name: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        whatsappOptedOut: whatsappOptedOut !== undefined ? whatsappOptedOut : undefined
      }
    });

    return NextResponse.json({
      success: true,
      customer: updatedCustomer
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
