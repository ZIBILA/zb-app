import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { searchCustomerByPhone } from "@/lib/shopify-admin";
import { signAccessToken, signRefreshToken } from "@/lib/appAuth";
import { SmsService } from "@/lib/services/sms.service";
import { maskPhone } from "@/lib/pii-mask";

export const dynamic = "force-dynamic";

import { checkRateLimit, rateLimit } from "@/lib/rate-limit";
import { getClientIP } from "@/lib/ip-geo";
import { resolveEventGeo } from "@/lib/resolve-event-geo";
import { DEMO_OTP, isDemoPhone } from "@/lib/demo-auth";

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
    console.error('[Mobile Verify] Auto opt-in failed:', err.message);
  }
}

export async function POST(req: Request) {
  const rateLimitResult = await checkRateLimit(req, "auth-mobile-verify", { maxRequests: 30, windowMs: 60_000 });
  if (!rateLimitResult.allowed && rateLimitResult.response) {
    return rateLimitResult.response;
  }
  try {
    const { phone, otp, name, clientGeo } = await req.json();
    const geo = await resolveEventGeo(req, clientGeo);

    if (!phone || !otp) {
      return NextResponse.json({ error: "Phone and OTP are required" }, { status: 400 });
    }

    // Validate OTP format
    if (!/^\d{6}$/.test(otp)) {
      return NextResponse.json({ error: "OTP must be exactly 6 digits" }, { status: 400 });
    }

    const phoneDigits = phone.replace(/\D/g, "");
    const normalizedPhone = phoneDigits.slice(-10);

    let isVerified = false;

    // Special case: Demo User Bypass
    if (isDemoPhone(normalizedPhone) && otp === DEMO_OTP) {
      isVerified = true;
    }

    // Per-phone failed verification lockout (max 5 failed attempts per 10 minutes)
    if (process.env.NODE_ENV === "production" && !isDemoPhone(normalizedPhone)) {
      const lockKey = `otp-verify-failures:${normalizedPhone}`;
      const failCountResult: any[] = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int as count FROM "RateLimitLog" WHERE "key" = $1 AND "timestamp" >= $2`,
        lockKey,
        new Date(Date.now() - 10 * 60 * 1000)
      ).catch(() => []);
      const failedAttempts = failCountResult[0]?.count ?? 0;
      if (failedAttempts >= 5) {
        return NextResponse.json(
          { error: "Too many incorrect OTP attempts. Please wait 10 minutes or request a new OTP." },
          { status: 429 }
        );
      }
    }

    // 1. Try local DB check first (instantaneous, timezone desync-safe)
    if (!isVerified) {
      const verification = await prisma.verificationCode.findFirst({
        where: {
          phone: { contains: normalizedPhone },
          code: otp
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
        const verifyCheck = await SmsService.checkVerification(phone, otp);
        if (verifyCheck === true) {
          isVerified = true;
          console.log(`[Mobile Verify] OTP verified via Twilio Verify for phone`);
          // Cache the verified code locally so that duplicate calls
          // hit the DB fast-path instead of Twilio (single-use codes).
          await prisma.verificationCode.create({
            data: {
              phone: phone,
              code: otp,
              expiresAt: new Date(Date.now() + 2 * 60 * 1000), // 2 min TTL
            }
          }).catch((e: any) => console.log("[Mobile Verify] Cache verified OTP:", e.message));
        } else {
          console.log(`[Mobile Verify] Twilio Verify check returned false/null`);
        }
      } catch (err: any) {
        console.warn(`[Mobile Verify] Twilio Verify check failed: ${err.message}`);
      }
    }

    if (!isVerified) {
      // Record failed attempt for per-phone lockout
      if (process.env.NODE_ENV === "production" && !isDemoPhone(normalizedPhone)) {
        await rateLimit(`otp-verify-failures:${normalizedPhone}`, { maxRequests: 5, windowMs: 10 * 60 * 1000 }).catch(() => {});
      }

      // Log failed attempt (non-blocking)
      prisma.appLogin.create({
        data: {
          phone: phone,
          status: "FAILED",
          userAgent: req.headers.get("user-agent") || "Mobile App",
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

      return NextResponse.json({ error: "Invalid or expired OTP" }, { status: 401 });
    }

    // Clean up expired codes (non-blocking)
    prisma.verificationCode.deleteMany({
      where: {
        phone: { contains: normalizedPhone },
        expiresAt: { lt: new Date() }
      }
    }).catch(() => {});

    const fullPhone = `+${phoneDigits}`;

    // Get default shop
    let shop = await prisma.shop.findFirst();
    if (!shop) {
      shop = await prisma.shop.create({
        data: {
          domain: process.env.SHOPIFY_STORE_DOMAIN || "8tiahf-bk.myshopify.com",
          accessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || "",
        }
      });
    }
    const shopId = shop.id;

    // ── FAST PATH: Look up local customer first ──
    // Prioritize canonical customers with valid shopifyId (not starting with otp_ or mobile_)
    let customers = await prisma.customer.findMany({
      where: {
        OR: [
          { phone: fullPhone },
          { phone: phoneDigits },
          { phone: { contains: normalizedPhone } },
        ]
      },
      include: { communityMember: true }
    });

    let customer = customers.find((c: any) => c.shopifyId && !c.shopifyId.startsWith("otp_") && !c.shopifyId.startsWith("mobile_"))
      || customers[0]
      || null;

    if (customer) {
      // ── EXISTING USER: Return immediately ──
      console.log(`[Mobile Verify] Fast-path: existing customer ${customer.id}`);

      // Ensure customer has phone populated if missing
      if (!customer.phone) {
        customer = await prisma.customer.update({
          where: { id: customer.id },
          data: { phone: fullPhone },
          include: { communityMember: true }
        });
      }

      // Update name if provided and missing
      if (name && (!customer.name || customer.name === "New User" || customer.name === "User" || customer.name === "Valued Customer")) {
        customer = await prisma.customer.update({
          where: { id: customer.id },
          data: { name },
          include: { communityMember: true }
        });
      }

      // Update last login (non-blocking)
      prisma.customer.update({
        where: { id: customer.id },
        data: { lastLoginAt: new Date() }
      }).catch(console.error);

      // Log success (non-blocking)
      prisma.appLogin.create({
        data: {
          phone: fullPhone,
          status: "SUCCESS",
          userAgent: req.headers.get("user-agent") || "Mobile App",
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

      const tokenPayload = {
        customerId: customer.id,
        customerEmail: customer.email ?? null,
        customerPhone: customer.phone ?? null,
        tokenVersion: (customer as any).tokenVersion ?? 0,
      };
      const token = signAccessToken(tokenPayload);
      const refreshToken = signRefreshToken(tokenPayload);

      // ── BACKGROUND: Shopify sync (fire-and-forget) ──
      const bgCustomerId = customer.id;
      const bgCustomerPhone = customer.phone;
      const bgCustomerName = customer.name;
      (async () => {
        try {
          const results = await Promise.all([
            searchCustomerByPhone(fullPhone).catch(() => null),
            searchCustomerByPhone(phoneDigits).catch(() => null),
            searchCustomerByPhone(normalizedPhone).catch(() => null),
          ]);
          const shopifyCustomer = results.find(r => r !== null) || null;
          if (!shopifyCustomer) return;

          console.log(`[Mobile Verify-BG] Syncing Shopify customer ${shopifyCustomer.id}`);
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
              console.warn(`[Mobile Verify-BG] Unique constraint on shopifyId for customer ${bgCustomerId}. Retrying sync without shopifyId...`);
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
              }).catch((err: any) => console.error("[Mobile Verify-BG] Retry sync failed:", err.message));
            } else {
              console.error("[Mobile Verify-BG] Update error:", e.message || e);
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
        } catch (bgErr: any) {
          console.error("[Mobile Verify-BG] Sync error:", bgErr.message);
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

      return NextResponse.json({
        user: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          image: (customer as any).image,
          isCommunityMember: !!customer.communityMember
        },
        token,
        refreshToken,
      });
    }

    // ── NEW USER PATH: No local customer found ──
    console.log(`[Mobile Verify] New user path for ${maskPhone(fullPhone)}`);

    // Search Shopify in parallel
    let shopifyCustomer = null;
    try {
      const results = await Promise.all([
        searchCustomerByPhone(fullPhone).catch(() => null),
        searchCustomerByPhone(phoneDigits).catch(() => null),
        searchCustomerByPhone(normalizedPhone).catch(() => null),
      ]);
      shopifyCustomer = results.find(r => r !== null) || null;
    } catch (e: any) {
      console.error("[Mobile Verify] Shopify search error:", e.message);
    }

    if (shopifyCustomer) {
      try {
        customer = await prisma.customer.upsert({
          where: { shopifyId: String(shopifyCustomer.id) },
          create: {
            shopifyId: String(shopifyCustomer.id),
            shopId: shopId,
            email: shopifyCustomer.email,
            name: name || `${shopifyCustomer.first_name || ""} ${shopifyCustomer.last_name || ""}`.trim() || "User",
            phone: shopifyCustomer.phone || fullPhone,
            ordersCount: shopifyCustomer.orders_count || 0,
            totalSpent: parseFloat(shopifyCustomer.total_spent || "0"),
          },
          update: {
            email: shopifyCustomer.email || undefined,
            name: name || `${shopifyCustomer.first_name || ""} ${shopifyCustomer.last_name || ""}`.trim() || undefined,
            phone: shopifyCustomer.phone || undefined,
            ordersCount: shopifyCustomer.orders_count || 0,
            totalSpent: parseFloat(shopifyCustomer.total_spent || "0"),
          },
          include: { communityMember: true }
        });

        // Background: import addresses
        const bgCustId = customer.id;
        const bgCustPhone = customer.phone;
        const bgCustName = customer.name;
        const bgShopifyCust = shopifyCustomer;
        (async () => {
          try {
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
          } catch (bgErr) {
            console.error("[Mobile Verify-BG] Address sync error:", bgErr);
          }
        })();
      } catch (syncError: any) {
        console.error("[Mobile Verify] Shopify upsert error:", syncError.message);
      }
    }

    // Fallback: create guest customer
    if (!customer) {
      customer = await prisma.customer.create({
        data: {
          phone: fullPhone,
          shopId: shopId,
          shopifyId: `mobile_${Date.now()}`,
          name: name || "New User",
        },
        include: { communityMember: true }
      });
    }

    // Update last login & log success (non-blocking)
    prisma.customer.update({
      where: { id: customer.id },
      data: { lastLoginAt: new Date() }
    }).catch(console.error);

    prisma.appLogin.create({
      data: {
        phone: fullPhone,
        status: "SUCCESS",
        userAgent: req.headers.get("user-agent") || "Mobile App",
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

    const tokenPayload = {
      customerId: customer.id,
      customerEmail: customer.email ?? null,
      customerPhone: customer.phone ?? null,
      tokenVersion: (customer as any).tokenVersion ?? 0,
    };
    const token = signAccessToken(tokenPayload);
    const refreshToken = signRefreshToken(tokenPayload);

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

    return NextResponse.json({
      user: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        image: (customer as any).image,
        isCommunityMember: !!customer.communityMember
      },
      token,
      refreshToken,
    });
  } catch (error: any) {
    console.error("Mobile verify error:", error);
    return NextResponse.json({ error: "Verification failed. Please try again." }, { status: 500 });
  }
}
