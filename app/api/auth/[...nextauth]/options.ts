import GoogleProvider from "next-auth/providers/google";
import AppleProvider from "next-auth/providers/apple";
import CredentialsProvider from "next-auth/providers/credentials";
import prisma from "@/lib/db";
import { AuthOptions } from "next-auth";
import { searchCustomerByPhone, fetchOrdersByCustomerId } from "@/lib/shopify-admin";
import bcrypt from "bcryptjs";
import { SmsService } from "@/lib/services/sms.service";
import { resolveEventGeoFromIp, ClientGeoInput } from "@/lib/resolve-event-geo";

// Shopify Storefront API customer access token
async function shopifyCustomerLogin(email: string, password: string) {
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const storefrontToken = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
  
  if (!storeDomain || !storefrontToken) {
    throw new Error("Shopify configuration missing");
  }

  const query = `
    mutation customerAccessTokenCreate($input: CustomerAccessTokenCreateInput!) {
      customerAccessTokenCreate(input: $input) {
        customerAccessToken {
          accessToken
          expiresAt
        }
        customerUserErrors {
          code
          field
          message
        }
      }
    }
  `;

  const res = await fetch(`https://${storeDomain}/api/2024-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": storefrontToken,
    },
    body: JSON.stringify({
      query,
      variables: { input: { email, password } },
    }),
  });

  const data = await res.json();
  const result = data?.data?.customerAccessTokenCreate;

  if (result?.customerUserErrors?.length > 0) {
    throw new Error(result.customerUserErrors[0].message);
  }

  if (!result?.customerAccessToken?.accessToken) {
    throw new Error("Invalid credentials");
  }

  // Fetch customer details using the access token
  const customerQuery = `
    query {
      customer(customerAccessToken: "${result.customerAccessToken.accessToken}") {
        id
        firstName
        lastName
        email
        phone
      }
    }
  `;

  const customerRes = await fetch(`https://${storeDomain}/api/2024-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": storefrontToken,
    },
    body: JSON.stringify({ query: customerQuery }),
  });

  const customerData = await customerRes.json();
  return customerData?.data?.customer;
}

function getCustomerImageProxy(customerId: string, imageStr: string | null): string | null {
  if (!imageStr) return null;
  if (imageStr.startsWith("data:") || imageStr.length > 2048) {
    return `/api/customers/avatar?id=${customerId}`;
  }
  return imageStr;
}

async function autoOptInCustomer(phone: string, customerId: string) {
  try {
    const { formatPhone } = await import('@/lib/whatsapp/client');
    const formatted = formatPhone(phone);
    if (!formatted) return;

    const now = new Date();

    // Check WhatsAppOptIn
    const existing = await prisma.whatsAppOptIn.findUnique({
      where: { phone: formatted }
    });

    let isWaOptedOut = false;

    if (!existing) {
      // Create as opted_in
      await prisma.whatsAppOptIn.create({
        data: {
          phone: formatted,
          status: 'opted_in',
          consentDate: now,
          source: 'webstore_login'
        }
      });
    } else if (existing.source === 'webhook_optout' && existing.status === 'opted_out') {
      // Keep explicit STOP opt-out
      isWaOptedOut = true;
    } else {
      // Update existing record
      await prisma.whatsAppOptIn.update({
        where: { phone: formatted },
        data: {
          status: 'opted_in',
          consentDate: now,
          source: 'webstore_login'
        }
      });
    }

    // Upsert EmailOptIn
    await prisma.emailOptIn.upsert({
      where: { phone: formatted },
      update: {
        status: 'opted_in',
        consentDate: now,
        source: 'webstore_login'
      },
      create: {
        phone: formatted,
        status: 'opted_in',
        consentDate: now,
        source: 'webstore_login'
      }
    });

    // Update customer table
    await prisma.customer.update({
      where: { id: customerId },
      data: {
        whatsappOptedOut: isWaOptedOut,
        emailOptedOut: false
      }
    });

    // Sync communityMember if exists
    try {
      const communityMember = await prisma.communityMember.findUnique({
        where: { customerId }
      });
      if (communityMember) {
        await prisma.communityMember.update({
          where: { id: communityMember.id },
          data: { whatsappOptIn: !isWaOptedOut }
        });
      }
    } catch (e) {}
  } catch (err: any) {
    console.error('[AUTH] Auto opt-in failed:', err.message);
  }
}

export const authOptions: AuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    }),
    AppleProvider({
      clientId: process.env.APPLE_ID || "",
      clientSecret: process.env.APPLE_SECRET || "",
    }),
    CredentialsProvider({
      id: "otp",
      name: "OTP",
      credentials: {
        phone: { label: "Phone", type: "text" },
        otp: { label: "OTP", type: "text" },
        name: { label: "Name", type: "text" },
        userAgent: { label: "UserAgent", type: "text" },
        ip: { label: "IP", type: "text" },
        clientGeo: { label: "ClientGeo", type: "text" },
      },
      async authorize(credentials) {
        try {
          const providedOtp = String(credentials?.otp || "").trim();
          const providedPhone = String(credentials?.phone || "").trim();
          const providedName = String(credentials?.name || "").trim();
          const providedUserAgent = String(credentials?.userAgent || "Web Browser").trim();
          const providedIp = String(credentials?.ip || "").trim() || null;

          let clientGeo: ClientGeoInput | undefined;
          try {
            clientGeo = credentials?.clientGeo ? JSON.parse(String(credentials.clientGeo)) : undefined;
          } catch {
            clientGeo = undefined;
          }
          const geo = await resolveEventGeoFromIp(providedIp, clientGeo);

          // Validate OTP format
          if (!/^\d{6}$/.test(providedOtp)) {
            return null;
          }

          const phoneDigits = providedPhone.replace(/\D/g, "");
          const normalizedPhone = phoneDigits.slice(-10);
          const fullPhone = `+${phoneDigits}`;

          let isVerified = false;

          // Special case: Demo User Bypass
          if (normalizedPhone === "9999999999" && providedOtp === "123456") {
            isVerified = true;
          }

          // 1. Try local DB check first (instantaneous, timezone desync-safe)
          if (!isVerified) {
            const verification = await prisma.verificationCode.findFirst({
              where: {
                OR: [
                  { phone: providedPhone },
                  { phone: fullPhone },
                  { phone: { contains: normalizedPhone } }
                ],
                code: providedOtp
              },
              orderBy: { createdAt: 'desc' }
            });

            if (verification) {
              const now = new Date();
              // Check if code has expired
              if (now < new Date(verification.expiresAt)) {
                isVerified = true;
                // Set expiresAt to 15 seconds in the future to allow duplicate concurrent requests
                // but prevent reuse after that.
                await prisma.verificationCode.update({
                  where: { id: verification.id },
                  data: { expiresAt: new Date(Date.now() + 15 * 1000) }
                }).catch(console.error);
              }
            }
          }

          // 2. Fallback to Twilio Verify check (secondary — for codes sent via
          //    Twilio Verify before the fix to always use manual SMS was deployed)
          if (!isVerified) {
            try {
              const verifyCheck = await SmsService.checkVerification(fullPhone, providedOtp);
              if (verifyCheck === true) {
                isVerified = true;
                console.log(`[AUTH] OTP verified via Twilio Verify for ${fullPhone}`);
                // Cache the verified code locally so that duplicate signIn calls
                // (mobile auto-submit + manual tap race) hit the DB fast-path
                // instead of calling Twilio again (Twilio codes are single-use).
                await prisma.verificationCode.create({
                  data: {
                    phone: fullPhone,
                    code: providedOtp,
                    expiresAt: new Date(Date.now() + 2 * 60 * 1000), // 2 min TTL
                  }
                }).catch((e: any) => console.log("[AUTH] Cache verified OTP:", e.message));
              } else {
                console.log(`[AUTH] Twilio Verify check returned false/null for ${fullPhone}`);
              }
            } catch (err: any) {
              console.warn(`[AUTH] Twilio Verify check failed for ${fullPhone}: ${err.message}`);
            }
          }

          if (!isVerified) {
            console.warn(`[AUTH] Invalid OTP attempt for phone: ${fullPhone}`);
            
            // Log failed verification attempt (non-blocking)
            prisma.appLogin.create({
              data: {
                phone: fullPhone,
                status: "OTP_INVALID",
                userAgent: providedUserAgent,
                ip: geo.ip,
                geoSource: geo.geoSource,
                city: geo.city,
                region: geo.region,
                country: geo.country,
                countryCode: geo.countryCode,
                zip: geo.zip,
                latitude: geo.latitude,
                longitude: geo.longitude,
              }
            }).catch(console.error);

            return null;
          }

          console.log(`[AUTH] OTP verified for ${fullPhone}`);

          // ── FAST PATH: Look up local customer first ──
          // Prioritize customers with a canonical shopifyId (not starting with otp_ or mobile_)
          let customers = await prisma.customer.findMany({
            where: {
              OR: [
                { phone: fullPhone },
                { phone: phoneDigits },
                { phone: { contains: normalizedPhone } },
              ]
            }
          });

          let customer = customers.find((c: any) => c.shopifyId && !c.shopifyId.startsWith("otp_") && !c.shopifyId.startsWith("mobile_"))
            || customers[0]
            || null;

          let shop = await prisma.shop.findFirst();
          if (!shop) {
            shop = await prisma.shop.create({
              data: {
                domain: process.env.SHOPIFY_STORE_DOMAIN || "8tiahf-bk.myshopify.com",
                accessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "",
              }
            });
          }
          const shopId = (shop as any)?.id || 'default_shop_id';

          if (customer) {
            // ── EXISTING USER: Return immediately, sync Shopify in background ──
            console.log(`[AUTH] Fast-path: existing customer ${customer.id}`);

            // Ensure customer phone is populated if missing
            if (!customer.phone) {
              customer = await prisma.customer.update({
                where: { id: customer.id },
                data: { phone: fullPhone },
              });
            }

            // Update name if provided and missing
            if (providedName && (!customer.name || customer.name === "New User" || customer.name === "User" || customer.name === "Valued Customer")) {
              customer = await prisma.customer.update({
                where: { id: customer.id },
                data: { name: providedName },
              });
            }

            // Log success (non-blocking)
            prisma.appLogin.create({
              data: {
                phone: fullPhone,
                status: "LOGGED_IN",
                userAgent: providedUserAgent,
                ip: geo.ip,
                geoSource: geo.geoSource,
                city: geo.city,
                region: geo.region,
                country: geo.country,
                countryCode: geo.countryCode,
                zip: geo.zip,
                latitude: geo.latitude,
                longitude: geo.longitude,
              }
            }).catch(console.error);

            // ── BACKGROUND: Shopify sync (non-blocking, fire-and-forget) ──
            const bgCustomerId = customer.id;
            const bgCustomerPhone = customer.phone;
            const bgCustomerName = customer.name;
            (async () => {
              try {
                // Parallel Shopify search across phone formats
                const results = await Promise.all([
                  searchCustomerByPhone(fullPhone).catch(() => null),
                  searchCustomerByPhone(phoneDigits).catch(() => null),
                  searchCustomerByPhone(normalizedPhone).catch(() => null),
                ]);
                const shopifyCustomer = results.find(r => r !== null) || null;

                if (!shopifyCustomer) {
                  console.log(`[AUTH-BG] No Shopify customer found for ${fullPhone}`);
                  return;
                }

                console.log(`[AUTH-BG] Syncing Shopify customer ${shopifyCustomer.id} for local ${bgCustomerId}`);

                // Update local customer with Shopify data without overwriting existing email or phone
                try {
                  const currentCustomer = await prisma.customer.findUnique({
                    where: { id: bgCustomerId },
                    select: { email: true, phone: true }
                  });
                  await prisma.customer.update({
                    where: { id: bgCustomerId },
                    data: {
                      shopifyId: String(shopifyCustomer.id),
                      email: currentCustomer?.email ? undefined : (shopifyCustomer.email || undefined),
                      name: `${shopifyCustomer.first_name || ""} ${shopifyCustomer.last_name || ""}`.trim() || undefined,
                      phone: currentCustomer?.phone ? undefined : (shopifyCustomer.phone || undefined),
                      ordersCount: shopifyCustomer.orders_count || 0,
                      totalSpent: parseFloat(shopifyCustomer.total_spent || "0"),
                    }
                  });
                } catch (e: any) {
                  // Handle unique constraint violation on shopifyId defensively
                  if (e.code === 'P2002' && (e.meta?.target?.includes('shopifyId') || JSON.stringify(e).includes('shopifyId'))) {
                    console.warn(`[AUTH-BG] Unique constraint on shopifyId for customer ${bgCustomerId}. Retrying sync without shopifyId...`);
                    const currentCustomer = await prisma.customer.findUnique({
                      where: { id: bgCustomerId },
                      select: { email: true, phone: true }
                    });
                    await prisma.customer.update({
                      where: { id: bgCustomerId },
                      data: {
                        email: currentCustomer?.email ? undefined : (shopifyCustomer.email || undefined),
                        name: `${shopifyCustomer.first_name || ""} ${shopifyCustomer.last_name || ""}`.trim() || undefined,
                        phone: currentCustomer?.phone ? undefined : (shopifyCustomer.phone || undefined),
                        ordersCount: shopifyCustomer.orders_count || 0,
                        totalSpent: parseFloat(shopifyCustomer.total_spent || "0"),
                      }
                    }).catch((err: any) => console.error("[AUTH-BG] Retry sync failed:", err.message));
                  } else {
                    console.error("[AUTH-BG] Customer update error:", e.message || e);
                  }
                }

                // Import addresses
                if (shopifyCustomer.addresses && Array.isArray(shopifyCustomer.addresses)) {
                  for (const addr of shopifyCustomer.addresses) {
                    const a = addr as any;
                    const exists = await prisma.address.findFirst({
                      where: { customerId: bgCustomerId, address1: a.address1, city: a.city, zip: a.zip }
                    });
                    if (!exists) {
                      await prisma.address.create({
                        data: {
                          customerId: bgCustomerId,
                          name: `${a.first_name || ""} ${a.last_name || ""}`.trim() || bgCustomerName || "User",
                          phone: a.phone || bgCustomerPhone || fullPhone,
                          address1: a.address1, address2: a.address2 || "",
                          city: a.city, state: a.province || "", zip: a.zip,
                          country: a.country || "India", isDefault: a.default || false
                        }
                      }).catch(console.error);
                    }
                  }
                }

                // Import orders
                try {
                  const shopifyOrders = await fetchOrdersByCustomerId(String(shopifyCustomer.id));
                  
                  // Fetch local products to build images and cuid lookup maps
                  const localProducts = await prisma.product.findMany({
                    select: { id: true, shopifyProductId: true, featuredImage: true }
                  });
                  const productImageMap = new Map<string, string>();
                  const productCuidMap = new Map<string, string>();
                  for (const lp of localProducts) {
                    if (lp.featuredImage) productImageMap.set(lp.shopifyProductId, lp.featuredImage);
                    productCuidMap.set(lp.shopifyProductId, lp.id);
                  }

                  for (const o of shopifyOrders) {
                    const dbOrder = await prisma.order.upsert({
                      where: { shopifyOrderId: String(o.id) },
                      create: {
                        shopId: shopId, shopifyOrderId: String(o.id), customerId: bgCustomerId,
                        status: 'active', totalPrice: parseFloat(o.total_price || '0'),
                        currency: o.currency || 'INR', paymentStatus: o.financial_status || 'pending',
                        fulfillmentStatus: o.fulfillment_status || 'unfulfilled', createdAt: new Date(o.created_at),
                      },
                      update: {
                        status: 'active', totalPrice: parseFloat(o.total_price || '0'),
                        paymentStatus: o.financial_status || 'pending',
                        fulfillmentStatus: o.fulfillment_status || 'unfulfilled',
                      }
                    });

                    // Sync Order Items
                    if (o.line_items && Array.isArray(o.line_items)) {
                      const shopifyItemIds = o.line_items.map((item: any) => String(item.id));
                      await prisma.orderItem.deleteMany({
                        where: {
                          orderId: dbOrder.id,
                          shopifyLineItemId: { notIn: shopifyItemIds }
                        }
                      }).catch(console.error);

                      for (const item of o.line_items) {
                        const shopifyProductId = item.product_id ? String(item.product_id) : null;
                        const dbProductId = shopifyProductId ? productCuidMap.get(shopifyProductId) : null;
                        const itemImage = shopifyProductId ? productImageMap.get(shopifyProductId) : null;

                        await prisma.orderItem.upsert({
                          where: { shopifyLineItemId: String(item.id) },
                          create: {
                            orderId: dbOrder.id,
                            shopifyLineItemId: String(item.id),
                            productId: dbProductId,
                            title: item.title,
                            quantity: item.quantity,
                            price: parseFloat(item.price || '0'),
                            sku: item.sku || null,
                            image: itemImage || null,
                          },
                          update: {
                            quantity: item.quantity,
                            price: parseFloat(item.price || '0'),
                            sku: item.sku || null,
                            image: itemImage || null,
                          }
                        }).catch((e: any) => console.error("[AUTH-BG] Order item upsert error:", e.message));
                      }
                    }
                  }
                  console.log(`[AUTH-BG] Synced ${shopifyOrders.length} orders for customer ${bgCustomerId}`);
                } catch (orderErr) {
                  console.error("[AUTH-BG] Order sync error:", orderErr);
                }
              } catch (bgError: any) {
                console.error("[AUTH-BG] Background sync error:", bgError.message);
              }
            })();

            await autoOptInCustomer(fullPhone, customer.id);

            // Fire-and-forget: Account Created WhatsApp message (UTILITY, no consent gate)
            const acCustomer = customer;
            (async () => {
              try {
                if (!acCustomer.phone) return;
                const { getWhatsAppSetting } = await import('@/lib/whatsapp/logger');
                const settingEnabled = await getWhatsAppSetting('account_created_enabled', 'true');
                if (settingEnabled !== 'true') return;

                const fresh = await prisma.customer.findUnique({
                  where: { id: acCustomer.id },
                  select: { accountCreatedMsgSentAt: true }
                });
                if (fresh?.accountCreatedMsgSentAt) return;

                const { sendAccountCreated } = await import('@/lib/whatsapp/templates');
                const result = await sendAccountCreated({
                  phone: acCustomer.phone,
                  customerName: acCustomer.name || 'there'
                });

                if (result?.success) {
                  await prisma.customer.update({
                    where: { id: acCustomer.id },
                    data: { accountCreatedMsgSentAt: new Date() }
                  });
                }
              } catch (err: any) {
                console.error('[Account Created WhatsApp] send failed:', err.message);
              }
            })();

            return {
              id: customer.id,
              name: customer.name ?? "User",
              email: customer.email ?? null,
              phone: customer.phone,
              image: getCustomerImageProxy(customer.id, (customer as any).image ?? null),
            };
          }

          // ── NEW USER PATH: No local customer found ──
          console.log(`[AUTH] New user path for ${fullPhone}`);

          // Search Shopify in parallel (all formats at once)
          let shopifyCustomer = null;
          try {
            const results = await Promise.all([
              searchCustomerByPhone(fullPhone).catch(() => null),
              searchCustomerByPhone(phoneDigits).catch(() => null),
              searchCustomerByPhone(normalizedPhone).catch(() => null),
            ]);
            shopifyCustomer = results.find(r => r !== null) || null;
            console.log(`[AUTH] Shopify Customer found: ${shopifyCustomer ? 'YES (ID: ' + shopifyCustomer.id + ')' : 'NO'}`);
          } catch (e: any) {
            console.error("[AUTH] Shopify search error:", e.message);
          }

          if (shopifyCustomer) {
            // Create/upsert local customer from Shopify data
            try {
              customer = await prisma.customer.upsert({
                where: { shopifyId: String(shopifyCustomer.id) },
                create: {
                  shopifyId: String(shopifyCustomer.id),
                  shopId: shopId,
                  email: shopifyCustomer.email,
                  name: providedName || `${shopifyCustomer.first_name || ""} ${shopifyCustomer.last_name || ""}`.trim() || "User",
                  phone: shopifyCustomer.phone || fullPhone,
                  ordersCount: shopifyCustomer.orders_count || 0,
                  totalSpent: parseFloat(shopifyCustomer.total_spent || "0"),
                },
                update: {
                  email: shopifyCustomer.email || undefined,
                  name: providedName || `${shopifyCustomer.first_name || ""} ${shopifyCustomer.last_name || ""}`.trim() || undefined,
                  phone: shopifyCustomer.phone || undefined,
                  ordersCount: shopifyCustomer.orders_count,
                  totalSpent: parseFloat(shopifyCustomer.total_spent || "0"),
                }
              });

              // Background: sync addresses and orders
              const bgCustId = customer.id;
              const bgCustPhone = customer.phone;
              const bgCustName = customer.name;
              const bgShopifyCust = shopifyCustomer;
              (async () => {
                try {
                  // Import addresses
                  if (bgShopifyCust.addresses && Array.isArray(bgShopifyCust.addresses)) {
                    for (const addr of bgShopifyCust.addresses) {
                      const a = addr as any;
                      const exists = await prisma.address.findFirst({
                        where: { customerId: bgCustId, address1: a.address1, city: a.city, zip: a.zip }
                      });
                      if (!exists) {
                        await prisma.address.create({
                          data: {
                            customerId: bgCustId,
                            name: `${a.first_name || ""} ${a.last_name || ""}`.trim() || bgCustName || "User",
                            phone: a.phone || bgCustPhone || fullPhone,
                            address1: a.address1, address2: a.address2 || "",
                            city: a.city, state: a.province || "", zip: a.zip,
                            country: a.country || "India", isDefault: a.default || false
                          }
                        }).catch(console.error);
                      }
                    }
                  }
                  // Import orders
                  const shopifyOrders = await fetchOrdersByCustomerId(String(bgShopifyCust.id));
                  
                  // Fetch local products to build images and cuid lookup maps
                  const localProducts = await prisma.product.findMany({
                    select: { id: true, shopifyProductId: true, featuredImage: true }
                  });
                  const productImageMap = new Map<string, string>();
                  const productCuidMap = new Map<string, string>();
                  for (const lp of localProducts) {
                    if (lp.featuredImage) productImageMap.set(lp.shopifyProductId, lp.featuredImage);
                    productCuidMap.set(lp.shopifyProductId, lp.id);
                  }

                  for (const o of shopifyOrders) {
                    const dbOrder = await prisma.order.upsert({
                      where: { shopifyOrderId: String(o.id) },
                      create: {
                        shopId: shopId, shopifyOrderId: String(o.id), customerId: bgCustId,
                        status: 'active', totalPrice: parseFloat(o.total_price || '0'),
                        currency: o.currency || 'INR', paymentStatus: o.financial_status || 'pending',
                        fulfillmentStatus: o.fulfillment_status || 'unfulfilled', createdAt: new Date(o.created_at),
                      },
                      update: {
                        customerId: bgCustId,
                        status: 'active', totalPrice: parseFloat(o.total_price || '0'),
                        paymentStatus: o.financial_status || 'pending',
                        fulfillmentStatus: o.fulfillment_status || 'unfulfilled',
                      }
                    });

                    // Sync Order Items
                    if (o.line_items && Array.isArray(o.line_items)) {
                      const shopifyItemIds = o.line_items.map((item: any) => String(item.id));
                      await prisma.orderItem.deleteMany({
                        where: {
                          orderId: dbOrder.id,
                          shopifyLineItemId: { notIn: shopifyItemIds }
                        }
                      }).catch(console.error);

                      for (const item of o.line_items) {
                        const shopifyProductId = item.product_id ? String(item.product_id) : null;
                        const dbProductId = shopifyProductId ? productCuidMap.get(shopifyProductId) : null;
                        const itemImage = shopifyProductId ? productImageMap.get(shopifyProductId) : null;

                        await prisma.orderItem.upsert({
                          where: { shopifyLineItemId: String(item.id) },
                          create: {
                            orderId: dbOrder.id,
                            shopifyLineItemId: String(item.id),
                            productId: dbProductId,
                            title: item.title,
                            quantity: item.quantity,
                            price: parseFloat(item.price || '0'),
                            sku: item.sku || null,
                            image: itemImage || null,
                          },
                          update: {
                            quantity: item.quantity,
                            price: parseFloat(item.price || '0'),
                            sku: item.sku || null,
                            image: itemImage || null,
                          }
                        }).catch((e: any) => console.error("[AUTH-BG] Order item upsert error:", e.message));
                      }
                    }
                  }
                  console.log(`[AUTH-BG] New user: synced ${shopifyOrders.length} orders for ${bgCustId}`);
                } catch (bgErr) {
                  console.error("[AUTH-BG] New user sync error:", bgErr);
                }
              })();
            } catch (syncError: any) {
              console.error("[AUTH] Shopify upsert error:", syncError.message);
            }
          }

          // Fallback: create a guest customer if nothing matched
          if (!customer) {
            customer = await prisma.customer.create({
              data: {
                phone: fullPhone,
                shopId: shopId,
                shopifyId: `otp_${Date.now()}`,
                name: providedName || "New User",
              },
            });
          }

          // Log success (non-blocking)
          prisma.appLogin.create({
            data: {
              phone: fullPhone,
              status: "ACCOUNT_CREATED",
              userAgent: providedUserAgent,
              ip: geo.ip,
              geoSource: geo.geoSource,
              city: geo.city,
              region: geo.region,
              country: geo.country,
              countryCode: geo.countryCode,
              zip: geo.zip,
              latitude: geo.latitude,
              longitude: geo.longitude,
            }
          }).catch(console.error);

          await autoOptInCustomer(fullPhone, customer.id);

          // Fire-and-forget: Account Created WhatsApp message (UTILITY, no consent gate)
          const acCustomerNew = customer;
          (async () => {
            try {
              if (!acCustomerNew.phone) return;
              const { getWhatsAppSetting } = await import('@/lib/whatsapp/logger');
              const settingEnabled = await getWhatsAppSetting('account_created_enabled', 'true');
              if (settingEnabled !== 'true') return;

              const fresh = await prisma.customer.findUnique({
                where: { id: acCustomerNew.id },
                select: { accountCreatedMsgSentAt: true }
              });
              if (fresh?.accountCreatedMsgSentAt) return;

              const { sendAccountCreated } = await import('@/lib/whatsapp/templates');
              const result = await sendAccountCreated({
                phone: acCustomerNew.phone,
                customerName: acCustomerNew.name || 'there'
              });

              if (result?.success) {
                await prisma.customer.update({
                  where: { id: acCustomerNew.id },
                  data: { accountCreatedMsgSentAt: new Date() }
                });
              }
            } catch (err: any) {
              console.error('[Account Created WhatsApp] send failed:', err.message);
            }
          })();

          return {
            id: customer.id,
            name: customer.name ?? "User",
            email: customer.email ?? null,
            phone: customer.phone,
            image: getCustomerImageProxy(customer.id, (customer as any).image ?? null),
          };
        } catch (error: any) {
          console.error("[AUTH] OTP authorize error:", error);
          return null;
        }
      },
    }),
    CredentialsProvider({
      id: "shopify-customer",
      name: "Shopify Account",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.email || !credentials?.password) return null;

          const shopifyCustomer = await shopifyCustomerLogin(
            credentials.email,
            credentials.password
          );

          if (!shopifyCustomer) {
            throw new Error("Invalid email or password");
          }

          let customer = await prisma.customer.findFirst({
            where: { email: shopifyCustomer.email },
          });

          if (!customer) {
            let shop = await prisma.shop.findFirst();
            if (!shop) {
              console.log("[AUTH] No shop found in shopify-customer, creating default...");
              shop = await prisma.shop.create({
                data: {
                  domain: process.env.SHOPIFY_STORE_DOMAIN || "8tiahf-bk.myshopify.com",
                  accessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "",
                }
              });
            }
            const shopId = (shop as any)?.id || 'default_shop_id';

            customer = await prisma.customer.create({
              data: {
                email: shopifyCustomer.email,
                name: `${shopifyCustomer.firstName || ""} ${shopifyCustomer.lastName || ""}`.trim() || "Shopify User",
                  phone: shopifyCustomer.phone || null,
                  shopId: shopId,
                shopifyId: shopifyCustomer.id,
              },
            });
          }

          return {
            id: customer.id,
            name: customer.name ?? "User",
            email: customer.email ?? null,
            phone: customer.phone ?? null,
            image: getCustomerImageProxy(customer.id, (customer as any).image ?? null),
          };
        } catch (error: any) {
          console.error("[AUTH] Shopify authorize error:", error);
          throw new Error(error.message || "Login failed");
        }
      },
    }),
    CredentialsProvider({
      id: "admin-login",
      name: "Admin Login",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        try {
          if (!credentials?.email || !credentials?.password) return null;

          const email = credentials.email.toLowerCase().trim();
          const providedPassword = credentials.password.trim();

          const superAdminEmail = (process.env.SUPER_ADMIN_EMAIL || 'admin@zicabella.com').toLowerCase().trim();
          const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD ? process.env.SUPER_ADMIN_PASSWORD.trim() : null;

          const allModules = [
            'DASHBOARD_HOME', 'SUPPORT', 'ORDERS', 'MOBILE_ORDERS', 'CUSTOMERS',
            'PRODUCTS', 'INVENTORY', 'LOGISTICS', 'RETURNS_EXCHANGES', 'STOREFRONT',
            'COMMUNITY', 'MARKETING', 'MANUFACTURING', 'FINANCIAL', 'INTEGRATIONS',
            'AI_SERVICES', 'SETTINGS', 'ADMIN_USERS', 'AUDIT_LOG'
          ];
          const superAdminPermissions = allModules.map(m => ({ module: m, canView: true, canEdit: true, canDelete: true, pages: null }));

          let user: any = null;
          try {
            user = await prisma.user.findUnique({
              where: { email },
            });
            if (user && ((user as any)._isMock || !user.passwordHash)) {
              user = null;
            }
          } catch (dbErr: any) {
            console.error('[AUTH] DB user query error:', dbErr.message);
            user = null;
          }

          // ── SUPER ADMIN FALLBACK: Check env credentials if DB fails or user not found ──
          if (!user && email === superAdminEmail && providedPassword === superAdminPassword) {
            console.log('[AUTH] Super admin fallback login granted for:', email);
            try {
              const hashedPassword = await bcrypt.hash(superAdminPassword, 12);
              user = await prisma.user.create({
                data: {
                  email,
                  passwordHash: hashedPassword,
                  name: 'Super Admin',
                  role: 'SUPER_ADMIN',
                  isActive: true,
                },
              }).catch(() => null);
            } catch (seedErr: any) {
              console.warn('[AUTH] Auto-seed background creation skipped:', seedErr.message);
            }

            return {
              id: user?.id || 'super_admin_env_id',
              name: 'Super Admin',
              email: superAdminEmail,
              role: 'SUPER_ADMIN',
              permissions: superAdminPermissions,
            };
          }

          if (!user || !user.isActive) {
            if (email === superAdminEmail && providedPassword === superAdminPassword) {
              console.log('[AUTH] Super-admin credential override for inactive/missing user:', email);
              return {
                id: user?.id || 'super_admin_env_id',
                name: 'Super Admin',
                email: superAdminEmail,
                role: 'SUPER_ADMIN',
                permissions: superAdminPermissions,
              };
            }
            return null;
          }

          // Check if locked
          if (user.lockUntil && user.lockUntil > new Date()) {
            if (email === superAdminEmail && providedPassword === superAdminPassword) {
              console.log('[AUTH] Bypassing lock for super admin env credential match');
            } else {
              throw new Error(`Account locked until ${user.lockUntil.toLocaleTimeString()}`);
            }
          }

          let isValid = false;
          try {
            isValid = await bcrypt.compare(providedPassword, user.passwordHash);
          } catch (bcryptErr: any) {
            console.error('[AUTH] bcrypt compare error:', bcryptErr.message);
          }

          if (!isValid && email === superAdminEmail && providedPassword === superAdminPassword) {
            console.log('[AUTH] Password matched SUPER_ADMIN_PASSWORD fallback!');
            isValid = true;
          }

          if (!isValid) {
            try {
              const newAttempts = (user.failedLoginAttempts || 0) + 1;
              let lockUntil = user.lockUntil;
              if (newAttempts >= 5) {
                lockUntil = new Date(Date.now() + 15 * 60 * 1000);
              }
              await prisma.user.update({
                where: { id: user.id },
                data: { failedLoginAttempts: newAttempts, lockUntil: lockUntil }
              }).catch(() => {});
            } catch (e) {}
            return null;
          }

          // Reset attempts on success
          try {
            if (user.failedLoginAttempts > 0 || user.lockUntil) {
              await prisma.user.update({
                where: { id: user.id },
                data: { failedLoginAttempts: 0, lockUntil: null }
              }).catch(() => {});
            }
          } catch (e) {}

          let permissions: any[] = [];
          try {
            permissions = await prisma.permission.findMany({
              where: { userId: user.id }
            });
          } catch (pErr: any) {
            console.error('[AUTH] Permission query error:', pErr.message);
          }

          if ((user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') && permissions.length === 0) {
            permissions = superAdminPermissions as any;
          }

          return {
            id: user.id,
            name: user.name || "Admin",
            email: user.email,
            role: user.role,
            permissions: permissions.map((p: any) => ({
              module: p.module,
              canView: p.canView,
              canEdit: p.canEdit,
              canDelete: p.canDelete,
              pages: p.pages,
            }))
          };
        } catch (error: any) {
          console.error("[AUTH] Admin authorize error:", error);
          if (process.env.SUPER_ADMIN_PASSWORD && credentials?.email?.toLowerCase().trim() === (process.env.SUPER_ADMIN_EMAIL || 'admin@zicabella.com').toLowerCase().trim()
              && credentials?.password?.trim() === process.env.SUPER_ADMIN_PASSWORD.trim()) {
            console.log('[AUTH] Emergency fallback authorization for super admin!');
            const allModules = [
              'DASHBOARD_HOME', 'SUPPORT', 'ORDERS', 'MOBILE_ORDERS', 'CUSTOMERS',
              'PRODUCTS', 'INVENTORY', 'LOGISTICS', 'RETURNS_EXCHANGES', 'STOREFRONT',
              'COMMUNITY', 'MARKETING', 'MANUFACTURING', 'FINANCIAL', 'INTEGRATIONS',
              'AI_SERVICES', 'SETTINGS', 'ADMIN_USERS', 'AUDIT_LOG'
            ];
            return {
              id: 'super_admin_env_id',
              name: 'Super Admin',
              email: credentials.email.toLowerCase().trim(),
              role: 'SUPER_ADMIN',
              permissions: allModules.map(m => ({ module: m, canView: true, canEdit: true, canDelete: true, pages: null })),
            };
          }
          throw new Error(error.message || "Invalid credentials");
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "google" || account?.provider === "apple") {
        const email = user.email;
        if (!email) return false;

        let customer = await prisma.customer.findFirst({
          where: { email },
        });

        if (!customer) {
          let shop = await prisma.shop.findFirst();
          if (!shop) {
            shop = await prisma.shop.create({
              data: {
                domain: process.env.SHOPIFY_STORE_DOMAIN || "8tiahf-bk.myshopify.com",
                accessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "",
              }
            });
          }

          await prisma.customer.create({
            data: {
              email,
              name: user.name || "Apple User",
              shopId: shop.id,
              shopifyId: `${account.provider}_${Date.now()}`,
              image: user.image,
            },
          });
        }
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (user) {
        // Default role
        let role = "CUSTOMER";
        let permissions = null;
        let phone = (user as any).phone ?? null;
        let id = user.id;
        let image = (user as any).image ?? null;
        let email = (user as any).email ?? null;

        // If OAuth login, match and get local DB customer details
        if (account && (account.provider === "google" || account.provider === "apple") && email) {
          const customer = await prisma.customer.findFirst({
            where: { email }
          });
          if (customer) {
            id = customer.id;
            phone = customer.phone || null;
            image = customer.image || null;
          }
        } else if ((user as any).role) {
          // If admin/staff login, preserve role and permissions
          role = (user as any).role;
          permissions = (user as any).permissions ?? null;
        }

        token.id = id;
        token.role = role;
        token.permissions = permissions;
        token.loginTime = Math.floor(Date.now() / 1000);
        token.lastActivity = Math.floor(Date.now() / 1000);
        token.needsPasswordChange = (user as any).needsPasswordChange ?? null;
        token.phone = phone;
        token.email = email;
        
        // Proxy and normalize image / picture to prevent large base64 strings in the token
        const proxiedImage = getCustomerImageProxy(id, image);
        token.image = proxiedImage;
        token.picture = proxiedImage;
      }

      // Safeguard: sanitize token properties on every execution (e.g. session/active checks)
      const customerId = token.id || token.sub;
      if (customerId) {
        for (const key of ['picture', 'image']) {
          const val = token[key];
          if (typeof val === 'string' && (val.startsWith('data:') || val.length > 2048)) {
            token[key] = `/api/customers/avatar?id=${customerId}`;
          }
        }
      }

      // ── Admin Session Enforcement ──
      if (token.role === "ADMIN" || token.role === "SUPER_ADMIN") {
        const currentTime = Math.floor(Date.now() / 1000);

        // 1. Absolute 8-hour limit (hard cap)
        const eightHoursInSeconds = 8 * 60 * 60;
        if (token.loginTime && (currentTime - (token.loginTime as number)) > eightHoursInSeconds) {
          console.log(`[AUTH] Admin session expired (8h absolute limit) for user ${token.id}`);
          return null as any; // Invalidates the token
        }

        // 2. Inactivity timeout: 1 hour
        // The lastActivity is bumped by the client via /api/auth/session calls
        // triggered by user interaction (mouse, keyboard, scroll).
        const oneHourInSeconds = 60 * 60;
        if (token.lastActivity && (currentTime - (token.lastActivity as number)) > oneHourInSeconds) {
          console.log(`[AUTH] Admin session expired (1h inactivity) for user ${token.id}`);
          return null as any; // Invalidates the token
        }

        // Bump lastActivity on each token refresh (triggered by getSession/useSession)
        token.lastActivity = currentTime;
      }

      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as any).id = token.id ?? null;
        (session.user as any).role = token.role ?? "CUSTOMER";
        (session.user as any).needsPasswordChange = token.needsPasswordChange ?? null;
        (session.user as any).phone = token.phone ?? null;
        (session.user as any).email = token.email || session.user.email || null;
        (session.user as any).image = token.image || session.user.image || null;
        
        // Fetch fresh permissions from DB in real-time for administrators
        if (token.role === "ADMIN" || token.role === "SUPER_ADMIN") {
          try {
            const freshPermissions = await prisma.permission.findMany({
              where: { userId: token.id as string }
            });
            (session.user as any).permissions = freshPermissions.map((p: any) => ({
              module: p.module,
              canView: p.canView,
              canEdit: p.canEdit,
              canDelete: p.canDelete,
              pages: p.pages,
            }));
          } catch (err) {
            console.error("[Session fresh permissions] Error fetching fresh permissions:", err);
            (session.user as any).permissions = token.permissions ?? null;
          }
        } else {
          (session.user as any).permissions = null;
        }
        
        // Populate session.customer object to match frontend usage
        (session as any).customer = {
          id: token.id ?? null,
          phone: token.phone ?? null,
          email: token.email || session.user.email || null,
          name: session.user.name ?? "User",
          image: token.image || session.user.image || null
        };
      }
      return session;
    },
  },
  pages: {
    signIn: "/dashboard/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 10 * 24 * 60 * 60, // 10 days — webstore customers stay logged in
    // Admin sessions are enforced via JWT callback (1h inactivity + 8h absolute)
  },
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === "production" ? "__Secure-next-auth.session-token" : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: process.env.NODE_ENV === "production",
      },
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NODE_ENV === "development",
};
