import prisma from '@/lib/db';
import { isValidName } from '@/lib/utils/customerName';

export interface CheckoutAddressPayload {
  name: string;
  email: string;
  phone: string;
  street?: string;
  houseNo?: string;
  landmark?: string;
  apartment?: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
  lat?: number | string | null;
  lng?: number | string | null;
  placeId?: string | null;
  [key: string]: any;
}

export async function resolveAndSyncCustomerAddress(
  shopId: string,
  rawAddress: CheckoutAddressPayload,
  sessionUserId?: string | null,
  opts?: { skipSideEffects?: boolean }
) {
  // skipSideEffects: find/create customer only — merge + Address writes run deferred
  const skipSideEffects = Boolean(opts?.skipSideEffects);

  // Combine address lines into a single street string for storage
  const streetParts = [rawAddress.houseNo, rawAddress.street, rawAddress.landmark, rawAddress.apartment].filter(Boolean);
  const fullStreet = streetParts.length > 0 ? streetParts.join(', ') : (rawAddress.street || 'Default Street');

  const normalizedAddress = {
    ...rawAddress,
    street: fullStreet,
    country: rawAddress.country || 'India',
  };

  const email = normalizedAddress.email?.trim().toLowerCase() || null;
  const rawPhone = normalizedAddress.phone?.trim() || null;
  const phoneDigits = rawPhone ? rawPhone.replace(/\D/g, '').slice(-10) : '';
  const phone = rawPhone || null;
  const rawRecipientName = normalizedAddress.name?.trim() || null;
  const validIncomingName = isValidName(rawRecipientName) ? rawRecipientName : null;

  // 1. Find Customer
  let localCustomer = null;

  if (sessionUserId) {
    localCustomer = await prisma.customer.findUnique({
      where: { id: sessionUserId },
    });
  }

  if (!localCustomer && (email || phoneDigits.length === 10)) {
    const orConditions: any[] = [];
    if (email) orConditions.push({ email });
    if (phoneDigits.length === 10) {
      orConditions.push({ phone: { contains: phoneDigits } });
    } else if (phone) {
      orConditions.push({ phone });
    }

    localCustomer = await prisma.customer.findFirst({
      where: { OR: orConditions },
    });
  }

  // 2. Create Customer if not found
  if (!localCustomer) {
    localCustomer = await prisma.customer.create({
      data: {
        shopId,
        email: email || `guest_${Date.now()}@zicabella.com`,
        phone: phone || '',
        name: validIncomingName, // null if missing or generic, never store 'Valued Customer'
        shopifyId: `temp_${Date.now()}`,
        defaultAddress: JSON.stringify(normalizedAddress),
      },
    });
  } else {
    // Update existing customer profile details WITHOUT overwriting valid customer name, email, or phone
    const updateData: any = {
      defaultAddress: JSON.stringify(normalizedAddress),
    };
    if (!isValidName(localCustomer.name) && validIncomingName) {
      updateData.name = validIncomingName;
      localCustomer.name = validIncomingName;
    }
    if (!localCustomer.email && email) {
      updateData.email = email;
    }
    if (!localCustomer.phone && phone) {
      updateData.phone = phone;
    }

    await prisma.customer.update({
      where: { id: localCustomer.id },
      data: updateData,
    });
  }

  if (!skipSideEffects) {
    // 3. Merge duplicate accounts if another customer record exists with the same phone
    if (phone && localCustomer) {
      try {
        const duplicateCustomer = await prisma.customer.findFirst({
          where: {
            phone,
            id: { not: localCustomer.id },
          },
        });

        if (duplicateCustomer) {
          console.log(`[CustomerService] Merging duplicate customer account: ${duplicateCustomer.id} -> ${localCustomer.id}`);

          if (!isValidName(localCustomer.name) && isValidName(duplicateCustomer.name)) {
            await prisma.customer.update({
              where: { id: localCustomer.id },
              data: { name: duplicateCustomer.name }
            });
            localCustomer.name = duplicateCustomer.name;
          }

          await prisma.$transaction([
            prisma.order.updateMany({
              where: { customerId: duplicateCustomer.id },
              data: { customerId: localCustomer.id },
            }),
            prisma.address.updateMany({
              where: { customerId: duplicateCustomer.id },
              data: { customerId: localCustomer.id },
            }),
            prisma.payment.updateMany({
              where: { customerId: duplicateCustomer.id },
              data: { customerId: localCustomer.id },
            }),
            prisma.cart.deleteMany({
              where: { customerId: duplicateCustomer.id },
            }),
          ]);

          await prisma.customer.delete({
            where: { id: duplicateCustomer.id },
          }).catch(() => null);
        }
      } catch (mergeErr: any) {
        console.warn('[CustomerService] Account merge notice:', mergeErr.message);
      }
    }

    // 4. Save/Sync to Address Table
    try {
      const existingAddr = await prisma.address.findFirst({
        where: {
          customerId: localCustomer.id,
          address1: fullStreet,
          city: normalizedAddress.city,
          zip: normalizedAddress.zip,
        },
      });

      if (!existingAddr) {
        const count = await prisma.address.count({
          where: { customerId: localCustomer.id },
        });

        await prisma.address.create({
          data: {
            customerId: localCustomer.id,
            name: rawRecipientName || localCustomer.name || 'Customer',
            phone: phone || '',
            email: email || '',
            address1: fullStreet,
            address2: normalizedAddress.apartment || '',
            city: normalizedAddress.city,
            state: normalizedAddress.state,
            zip: normalizedAddress.zip,
            country: normalizedAddress.country,
            isDefault: count === 0,
            lat: normalizedAddress.lat != null ? parseFloat(String(normalizedAddress.lat)) : null,
            lng: normalizedAddress.lng != null ? parseFloat(String(normalizedAddress.lng)) : null,
            placeId: normalizedAddress.placeId || null,
          },
        });
        console.log(`[CustomerService] Saved new address to Address table for customer: ${localCustomer.id}`);
      }
    } catch (addrErr: any) {
      console.error('[CustomerService] Error saving Address table entry:', addrErr.message);
    }
  }

  return { customer: localCustomer, normalizedAddress };
}
