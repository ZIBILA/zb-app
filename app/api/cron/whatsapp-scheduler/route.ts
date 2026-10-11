import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';
import * as templates from '@/lib/whatsapp/templates';
import { runBroadcastInBackground, sendCampaignRecipient, finalizeCampaignIfComplete, SENDER_MAP } from '../../whatsapp/broadcast/helper';
import { WhatsAppService } from '@/lib/services/whatsapp.service';
import { getWhatsAppSetting } from '@/lib/whatsapp/logger';
import { formatPhone } from '@/lib/whatsapp/client';
import { isOrderValidConverted } from '@/lib/cartValidation';

export const dynamic = 'force-dynamic';

function getNextRetryTime(retryCount: number): Date | null {
  const intervals = [1, 5, 15, 60]; // minutes index [0, 1, 2, 3]
  if (retryCount >= 4) return null; // limit to 4 retries
  const minutes = intervals[retryCount] || 60;
  return new Date(Date.now() + minutes * 60 * 1000);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const secret = searchParams.get('secret');
  const cronSecret = process.env.CRON_SECRET;
  
  if (!cronSecret) {
    console.error('[WhatsApp Scheduler] CRON_SECRET is not set in environment variables.');
    return NextResponse.json({ error: 'Unauthorized (Config missing)' }, { status: 401 });
  }

  if (secret !== cronSecret && req.headers.get('Authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: any = {
    scheduledCampaignsProcessed: 0,
    strandedRecipientsRecovered: 0,
    campaignRecipientsRetried: 0,
    messagesRetried: 0,
    abandonedCartStep1Sent: 0,
    abandonedCartStep2Sent: 0,
    abandonedCartStep3Sent: 0,
    cartsExpired: 0,
    identityDuplicatesSkipped: 0,
    errors: []
  };

  let success = true;

  try {
    // 0. Expire stale carts (30-day lifecycle)
    // Run before any messaging to prevent sending recovery to 30-day-old carts.
    try {
      const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const expired = await db.cart.updateMany({
        where: {
          status: { in: ['active', 'abandoned'] },
          convertedOrderId: null,
          lastActivityAt: { lt: cutoff30 },
        },
        data: { status: 'expired' },
      });
      results.cartsExpired = expired.count;
    } catch (err: any) {
      results.errors.push(`Cart expiry error: ${err.message}`);
    }

    // 1. Process Scheduled Campaigns
    try {
      const now = new Date();
      const scheduledCampaigns = await db.whatsAppCampaign.findMany({
        where: {
          status: { in: ['scheduled', 'draft'] },
          scheduledAt: { lte: now }
        }
      });

      for (const campaign of scheduledCampaigns) {
        await db.whatsAppCampaign.update({
          where: { id: campaign.id },
          data: { status: 'sending' }
        });

        const payload = campaign.templateParams ? JSON.parse(campaign.templateParams) : {};
        
        // Run broadcast in background
        runBroadcastInBackground(campaign.id, campaign.templateName, payload).catch((e: any) => {
          console.error(`[Scheduler] Background broadcast error for campaign ${campaign.id}:`, e);
        });
        
        results.scheduledCampaignsProcessed++;
      }
    } catch (err: any) {
      results.errors.push(`Campaign schedule error: ${err.message}`);
    }

    // 1.5. Recover Stranded Queued Campaign Recipients
    // If the broadcast process dies mid-loop (deploy, crash, scale event),
    // recipients remain at status:'queued' forever. This step picks them up.
    try {
      const staleThreshold = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago

      const strandedRecipients = await db.whatsAppCampaignRecipient.findMany({
        where: {
          status: 'queued',
          campaign: {
            status: 'sending',
            updatedAt: { lte: staleThreshold }
          }
        },
        include: { campaign: true },
        take: 100 // Cap per cron run to avoid blowing execution time
      });

      const touchedCampaignIds = new Set<string>();

      for (const rec of strandedRecipients) {
        const campaign = rec.campaign;
        const payload = campaign.templateParams ? JSON.parse(campaign.templateParams) : {};

        await sendCampaignRecipient(rec, campaign.id, campaign.templateName, payload);
        touchedCampaignIds.add(campaign.id);
        results.strandedRecipientsRecovered++;

        // Rate limiting delay between sends (80ms)
        await new Promise(resolve => setTimeout(resolve, 80));
      }

      // Finalize campaigns that now have all recipients in terminal state
      for (const campaignId of touchedCampaignIds) {
        await finalizeCampaignIfComplete(campaignId);
      }
    } catch (err: any) {
      results.errors.push(`Stranded recipient recovery error: ${err.message}`);
    }

    // 2. Process Failed Campaign Recipients (Retry queue)
    try {
      const now = new Date();
      const failedRecipients = await db.whatsAppCampaignRecipient.findMany({
        where: {
          status: 'failed',
          retryCount: { lt: 4 },
          nextRetryAt: { lte: now }
        },
        include: { campaign: true }
      });

      for (const rec of failedRecipients) {
        const campaign = rec.campaign;
        const payload = campaign.templateParams ? JSON.parse(campaign.templateParams) : {};
        const nextRetryCount = rec.retryCount + 1;

        // Reset status to 'queued' so sendCampaignRecipient can process it,
        // then update retryCount regardless of outcome.
        // For both known (SENDER_MAP) and generic/custom templates, use the
        // shared sendCampaignRecipient which handles both paths.
        try {
          // Temporarily set status back to queued so sendCampaignRecipient
          // updates it to sent/failed correctly
          await db.whatsAppCampaignRecipient.update({
            where: { id: rec.id },
            data: { status: 'queued' }
          });

          const result = await sendCampaignRecipient(rec, campaign.id, campaign.templateName, payload);

          if (result.success) {
            // Update retryCount and clear error on success
            await db.whatsAppCampaignRecipient.update({
              where: { id: rec.id },
              data: {
                retryCount: nextRetryCount,
                errorMessage: null
              }
            });

            // Adjust campaign metrics: decrement the original failure count
            // (sendCampaignRecipient already incremented statsSent)
            await db.whatsAppCampaign.update({
              where: { id: campaign.id },
              data: {
                statsFailed: { decrement: 1 }
              }
            });
          } else {
            // sendCampaignRecipient already set status to 'failed' and
            // incremented statsFailed — but that double-counts since this
            // recipient was already counted as failed. Undo the increment.
            await db.whatsAppCampaign.update({
              where: { id: campaign.id },
              data: {
                statsFailed: { decrement: 1 }
              }
            });

            const nextRetryAt = getNextRetryTime(nextRetryCount);
            await db.whatsAppCampaignRecipient.update({
              where: { id: rec.id },
              data: {
                retryCount: nextRetryCount,
                nextRetryAt,
                errorMessage: result.error || 'Retry sending failed'
              }
            });
          }
        } catch (err: any) {
          const nextRetryAt = getNextRetryTime(nextRetryCount);
          await db.whatsAppCampaignRecipient.update({
            where: { id: rec.id },
            data: {
              status: 'failed',
              retryCount: nextRetryCount,
              nextRetryAt,
              errorMessage: err.message
            }
          });
        }
        results.campaignRecipientsRetried++;
      }
    } catch (err: any) {
      results.errors.push(`Campaign recipient retry error: ${err.message}`);
    }

    // 3. Process Failed Standard Outbound Messages (Retry queue)
    try {
      const now = new Date();
      const failedMessages = await db.whatsAppMessage.findMany({
        where: {
          direction: 'outbound',
          status: 'failed',
          retryCount: { lt: 4 },
          nextRetryAt: { lte: now }
        }
      });

      for (const msg of failedMessages) {
        const nextRetryCount = msg.retryCount + 1;
        try {
          let res: any = null;
          if (msg.templateName) {
            // Try to find a matching sender function that constructs proper components.
            // Dynamically resolve template names from settings so custom renames
            // (e.g. a1/a2/a3) route to the correct sender function.
            const TEMPLATE_SETTINGS: Array<{ key: string; defaultName: string; eventType: string }> = [
              { key: 'template_abandoned_cart', defaultName: 'abandoned_cart_a1', eventType: 'abandoned_cart' },
              { key: 'template_cart_followup', defaultName: 'abandoned_cart_a2', eventType: 'cart_followup' },
              { key: 'template_cart_final', defaultName: 'abandoned_cart_a3', eventType: 'cart_final' },
              { key: 'template_order_confirmed', defaultName: 'zica_order_confirmed_v1', eventType: 'order_confirmed' },
              { key: 'template_order_shipped', defaultName: 'zica_order_shipped', eventType: 'order_shipped' },
              { key: 'template_order_delivered', defaultName: 'zica_order_delivered_v1', eventType: 'order_delivered' },
              { key: 'template_out_for_delivery', defaultName: 'zb_out_for_delivery', eventType: 'out_for_delivery' },
              { key: 'template_return_confirmed', defaultName: 'zb_return_confirmed', eventType: 'return_confirmed' },
              { key: 'template_cod_confirmation', defaultName: 'zica_cod_confirmation_v1', eventType: 'cod_confirmation' },
              { key: 'template_order_status', defaultName: 'zb_order_status', eventType: 'order_status' },
              { key: 'template_order_tracking', defaultName: 'zb_order_tracking', eventType: 'order_tracking' },
            ];

            const templateToEvent: Record<string, string> = {};
            for (const s of TEMPLATE_SETTINGS) {
              const resolved = await getWhatsAppSetting(s.key, s.defaultName);
              templateToEvent[resolved] = s.eventType;       // custom name → event
              templateToEvent[s.defaultName] = s.eventType;  // old default → event (keep for compat)
            }

            const eventType = templateToEvent[msg.templateName];
            const senderFn = eventType ? (SENDER_MAP as Record<string, any>)[eventType] : null;

            if (senderFn) {
              // Use the proper sender function which constructs correct components
              // For cart recovery retries, load actual cart data from DB
              let retryParams: any = {
                phone: msg.phoneNumber,
                customerName: 'there',
                orderId: msg.orderId || '',
                checkoutUrl: '',
              };

              // If this is a cart recovery message, reconstruct full context from cart
              const isCartRecoveryRetry = ['abandoned_cart', 'cart_followup', 'cart_final'].includes(eventType);
              if (isCartRecoveryRetry && msg.cartId) {
                try {
                  const cart = await db.cart.findUnique({
                    where: { id: msg.cartId },
                    include: { customer: true, items: true }
                  });
                  if (cart) {
                    const firstItem = cart.items?.[0] || {} as any;
                    retryParams = {
                      phone: msg.phoneNumber,
                      customerName: cart.customer?.name || 'there',
                      checkoutUrl: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com'}/cart?recover=${cart.id}`,
                      productImageUrl: firstItem.image || '',
                      productName: firstItem.title || '',
                      productHandle: firstItem.handle || '',
                      cartTotal: String(cart.subtotal || '0.00'),
                      itemCount: cart.items?.length || 0,
                      cartId: cart.id,
                      discountCode: 'ZICA10',
                      productId: firstItem.productId || '',
                    };
                  }
                } catch (cartErr: any) {
                  console.warn(`[Scheduler] Failed to load cart ${msg.cartId} for retry:`, cartErr.message);
                }
              }

              res = await senderFn(retryParams);
              // senderFn returns { success, messageId, ... }
              if (res?.success) {
                try {
                  await db.whatsAppMessage.update({
                    where: { id: msg.id },
                    data: {
                      status: 'sent',
                      waMessageId: res.messageId || null,
                      sentAt: new Date(),
                      retryCount: nextRetryCount,
                      errorMessage: null
                    }
                  });
                } catch (updateErr: any) {
                  if (updateErr.code === 'P2002') {
                    console.warn(`[Scheduler] waMessageId collision for message ${msg.id}, updating status without waMessageId`);
                    await db.whatsAppMessage.update({
                      where: { id: msg.id },
                      data: {
                        status: 'sent',
                        sentAt: new Date(),
                        retryCount: nextRetryCount,
                        errorMessage: null
                      }
                    });
                  } else {
                    throw updateErr;
                  }
                }
              } else {
                throw new Error(res?.error || 'Sender function retry failed');
              }
            } else {
              // For custom/unknown templates, use sendTemplate from client.js
              // which now auto-resolves the correct language code from the DB
              const { sendTemplate } = await import('@/lib/whatsapp/client');
              res = await sendTemplate({
                to: msg.phoneNumber,
                templateName: msg.templateName,
                languageCode: 'en', // Will be overridden by resolveTemplateLanguage
                components: []
              });
              if (res) {
                try {
                  await db.whatsAppMessage.update({
                    where: { id: msg.id },
                    data: {
                      status: 'sent',
                      waMessageId: res.messages?.[0]?.id || null,
                      sentAt: new Date(),
                      retryCount: nextRetryCount,
                      errorMessage: null
                    }
                  });
                } catch (updateErr: any) {
                  if (updateErr.code === 'P2002') {
                    console.warn(`[Scheduler] waMessageId collision for message ${msg.id}, updating status without waMessageId`);
                    await db.whatsAppMessage.update({
                      where: { id: msg.id },
                      data: {
                        status: 'sent',
                        sentAt: new Date(),
                        retryCount: nextRetryCount,
                        errorMessage: null
                      }
                    });
                  } else {
                    throw updateErr;
                  }
                }
              } else {
                throw new Error('Template retry returned empty response');
              }
            }
          } else if (msg.body) {
            // If it was a text message, re-send text
            res = await WhatsAppService.sendTextMessage(msg.phoneNumber, msg.body);
            if (res) {
              try {
                await db.whatsAppMessage.update({
                  where: { id: msg.id },
                  data: {
                    status: 'sent',
                    waMessageId: res.messages?.[0]?.id || null,
                    sentAt: new Date(),
                    retryCount: nextRetryCount,
                    errorMessage: null
                  }
                });
              } catch (updateErr: any) {
                if (updateErr.code === 'P2002') {
                  console.warn(`[Scheduler] waMessageId collision for message ${msg.id}, updating status without waMessageId`);
                  await db.whatsAppMessage.update({
                    where: { id: msg.id },
                    data: {
                      status: 'sent',
                      sentAt: new Date(),
                      retryCount: nextRetryCount,
                      errorMessage: null
                    }
                  });
                } else {
                  throw updateErr;
                }
              }
            } else {
              throw new Error('Text message retry returned empty response');
            }
          }
        } catch (err: any) {
          try {
            const nextRetryAt = getNextRetryTime(nextRetryCount);
            await db.whatsAppMessage.update({
              where: { id: msg.id },
              data: {
                retryCount: nextRetryCount,
                nextRetryAt,
                errorMessage: err.message
              }
            });
          } catch (dbErr: any) {
            console.error(`[Scheduler] Failed to update retry status for message ${msg.id}:`, dbErr);
            results.errors.push(`Failed to update retry status for message ${msg.id}: ${dbErr.message}`);
          }
        }
        results.messagesRetried++;
      }
    } catch (err: any) {
      results.errors.push(`Standard message retry error: ${err.message}`);
    }

    // 4. Process Automated Cart Recovery Sequences
    try {
      const isStep1Enabled = await getWhatsAppSetting('cart_recovery_enabled', 'true') === 'true';
      const isStep2Enabled = await getWhatsAppSetting('cart_recovery_step2_enabled', 'true') === 'true';
      const isStep3Enabled = await getWhatsAppSetting('cart_recovery_step3_enabled', 'true') === 'true';

      const delay1 = parseInt(await getWhatsAppSetting('delay_abandoned_cart_step1', '5'), 10) || 5;
      const delay2 = parseInt(await getWhatsAppSetting('delay_abandoned_cart_step2', '1440'), 10) || 1440;
      const delay3 = parseInt(await getWhatsAppSetting('delay_abandoned_cart_step3', '10080'), 10) || 10080;

      const now = new Date();
      // Use the maximum configured delay + 1 day buffer as lookback window.
      // This ensures Step 3 carts (default 7 days = 10080 min) are still picked up.
      const maxDelayMinutes = Math.max(delay1, delay2, delay3);
      const lookbackMinutes = maxDelayMinutes + 1440; // max delay + 1 day buffer
      const cutoffDate = new Date(Date.now() - lookbackMinutes * 60 * 1000);

      const carts = await db.cart.findMany({
        where: {
          convertedOrderId: null,
          status: { notIn: ['converted', 'expired', 'merged'] },
          lastActivityAt: { gte: cutoffDate },
          items: { some: {} },
          OR: [
            { phone: { not: null } },
            { customer: { phone: { not: null } } }
          ]
        },
        include: {
          customer: true,
          items: true,
          convertedOrder: {
            select: {
              id: true,
              status: true,
              paymentStatus: true,
              paymentMethod: true
            }
          }
        },
        orderBy: { lastActivityAt: 'asc' },
        take: 50
      });

      // Resolve live-configured template names for each cart recovery step.
      // Include both old defaults AND current configured names so historical
      // messages (sent under old names before the rename) still count.
      const step1Template = await getWhatsAppSetting('template_abandoned_cart', 'abandoned_cart_a1');
      const step2Template = await getWhatsAppSetting('template_cart_followup', 'abandoned_cart_a2');
      const step3Template = await getWhatsAppSetting('template_cart_final', 'abandoned_cart_a3');

      const STEP1_DEFAULTS = ['abandoned_cart_a1', 'zica_cart_recovery_v1'];
      const STEP2_DEFAULTS = ['abandoned_cart_a2', 'zb_cart_followup'];
      const STEP3_DEFAULTS = ['abandoned_cart_a3', 'zb_cart_final'];

      const step1Names = [...new Set([step1Template, ...STEP1_DEFAULTS])];
      const step2Names = [...new Set([step2Template, ...STEP2_DEFAULTS])];
      const step3Names = [...new Set([step3Template, ...STEP3_DEFAULTS])];
      const allRecoveryNames = [...new Set([...step1Names, ...step2Names, ...step3Names])];

      // Optimize: Fetch all recovery messages sent in the last 30 days in one single query
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const recoveryMessages = await db.whatsAppMessage.findMany({
        where: {
          createdAt: { gte: thirtyDaysAgo },
          templateName: { in: allRecoveryNames }
        },
        orderBy: {
          createdAt: 'asc'
        }
      });

      // Fetch all messages linked to these carts specifically (including previous failures so we don't deadlock)
      const cartIds = carts.map((c: any) => c.id);
      const cartMessages = await db.whatsAppMessage.findMany({
        where: {
          cartId: { in: cartIds },
        }
      });

      // ── Identity-based dedup: collapse to one cart per person ──
      // Compute a normalized identity key per cart so two rows for the same
      // person can never both trigger the same recovery stage.
      const idKey = (c: any): string =>
        c.customerId
          ? `cid:${c.customerId}`
          : (c.phoneLast10 || (c.phone ? c.phone.replace(/\D/g, '').slice(-10) : null))
            ? `ph:${c.phoneLast10 || c.phone.replace(/\D/g, '').slice(-10)}`
            : (c.email ? `em:${c.email.trim().toLowerCase()}` : `cart:${c.id}`);

      // Build sentIdentityStages from already-sent recovery messages
      const sentIdentityStages = new Set<string>();

      // Map cartId → cart for identity resolution of existing messages
      const cartById = new Map<string, any>();
      for (const c of carts) {
        cartById.set(c.id, c);
      }

      // From cartMessages (linked by cartId): resolve identity via the cart
      for (const msg of cartMessages) {
        if (!msg.cartId || !msg.recoveryStage) continue;
        if (!['processing', 'sent', 'delivered', 'read'].includes(msg.status)) continue;
        const linkedCart = cartById.get(msg.cartId);
        if (linkedCart) {
          sentIdentityStages.add(`${idKey(linkedCart)}::${msg.recoveryStage}`);
        }
      }

      // From recoveryMessages (broader 30-day window): resolve by phoneNumber last-10
      for (const msg of recoveryMessages) {
        if (!msg.recoveryStage) continue;
        if (!['processing', 'sent', 'delivered', 'read'].includes(msg.status)) continue;
        const phoneLast10 = msg.phoneNumber ? msg.phoneNumber.replace(/\D/g, '').slice(-10) : null;
        if (phoneLast10) {
          sentIdentityStages.add(`ph:${phoneLast10}::${msg.recoveryStage}`);
        }
        // Also check by cartId if present
        if (msg.cartId) {
          const linkedCart = cartById.get(msg.cartId);
          if (linkedCart) {
            sentIdentityStages.add(`${idKey(linkedCart)}::${msg.recoveryStage}`);
          }
        }
      }

      // Collapse carts: process only one cart per identity (newest lastActivityAt)
      const seenIdentities = new Set<string>();

      for (const cart of carts) {
        if (cart.status === 'converted' || (cart.convertedOrder && isOrderValidConverted(cart.convertedOrder))) {
          console.log(`[WhatsApp Scheduler] Cart ${cart.id} is already converted. Skipping automated recovery.`);
          continue;
        }

        const cartIdentity = idKey(cart);
        if (seenIdentities.has(cartIdentity)) {
          // Already processing a newer cart for this identity; skip this one
          results.identityDuplicatesSkipped = (results.identityDuplicatesSkipped || 0) + 1;
          continue;
        }
        seenIdentities.add(cartIdentity);

        const phone = cart.phone || cart.customer?.phone;
        if (!phone) continue;
        
        const formattedPhone = formatPhone(phone);
        if (!formattedPhone) continue;

        // ── CRITICAL: Pre-send phone-based conversion check ──
        // Catch carts whose customer has already placed a valid order but
        // the cart.convertedOrderId wasn't linked yet (race condition).
        // This prevents converted customers from receiving recovery messages.
        let isPhoneConverted = false;
        try {
          const normDigits = formattedPhone.replace(/\D/g, "").slice(-10);
          if (normDigits.length >= 10) {
            const matchedOrder = await db.order.findFirst({
              where: {
                createdAt: { gte: new Date(cart.createdAt.getTime() - 60 * 60 * 1000) },
                NOT: [
                  { status: { in: ["failed", "FAILED", "payment_failed", "payment_pending", "cancelled", "CANCELLED", "draft", "voided"] } },
                  { paymentStatus: { in: ["failed", "FAILED", "payment_failed", "payment_pending", "cancelled", "CANCELLED", "voided"] } }
                ],
                OR: [
                  { paymentStatus: { in: ["paid", "cod_upfront_paid", "partially_paid", "refunded", "partially_refunded", "PAID", "SUCCESS", "success", "captured"] } },
                  {
                    AND: [
                      { paymentMethod: { in: ["COD", "cod", "Cash on Delivery", "cash_on_delivery"] } },
                      { status: { in: ["approved", "open", "fulfilled", "delivered", "shipped", "completed", "processing", "processed", "CONFIRMED", "confirmed", "placed"] } }
                    ]
                  }
                ],
                AND: [
                  {
                    OR: [
                      ...(cart.customerId ? [{ customerId: cart.customerId }] : []),
                      { customer: { phone: { contains: normDigits } } },
                      { shippingAddress: { contains: normDigits } },
                      ...(cart.email ? [{ customer: { email: { equals: cart.email, mode: "insensitive" as const } } }] : []),
                      ...(cart.email ? [{ shippingAddress: { contains: cart.email } }] : [])
                    ]
                  }
                ]
              },
              orderBy: { createdAt: "asc" }
            });

            if (matchedOrder) {
              isPhoneConverted = true;
              const { linkCartToOrderSafe } = await import("@/lib/cartConversion");
              await linkCartToOrderSafe(cart.id, matchedOrder.id, db as any).catch(() => {});
            }
          }
        } catch (reconErr: any) {
          console.warn(`[WhatsApp Scheduler] Pre-send conversion check failed for cart ${cart.id}:`, reconErr?.message);
        }

        if (isPhoneConverted) continue;

        // Fetch recoveries linked directly by cartId
        const sentForCart = cartMessages.filter((m: any) => m.cartId === cart.id);

        let step1Sent = sentForCart.filter((m: any) => m.recoveryStage === 1);
        let step2Sent = sentForCart.filter((m: any) => m.recoveryStage === 2);
        let step3Sent = sentForCart.filter((m: any) => m.recoveryStage === 3);

        const isStep1Done = step1Sent.some((m: any) => ['sent', 'delivered', 'read'].includes(m.status));
        const isStep2Done = step2Sent.some((m: any) => ['sent', 'delivered', 'read'].includes(m.status));
        const isStep3Done = step3Sent.some((m: any) => ['sent', 'delivered', 'read'].includes(m.status));

        // Fallback to legacy check if no direct relation records exist
        if (step1Sent.length === 0 || step2Sent.length === 0 || step3Sent.length === 0) {
          const legacySent = recoveryMessages.filter((msg: any) => 
            msg.phoneNumber === formattedPhone && 
            msg.body && msg.body.includes(cart.id)
          );
          if (step1Sent.length === 0) {
            step1Sent = legacySent.filter((m: any) => step1Names.includes(m.templateName));
          }
          if (step2Sent.length === 0) {
            step2Sent = legacySent.filter((m: any) => step2Names.includes(m.templateName));
          }
          if (step3Sent.length === 0) {
            step3Sent = legacySent.filter((m: any) => step3Names.includes(m.templateName));
          }
        }

        const lastActivityTime = new Date(cart.lastActivityAt).getTime();
        const elapsedMinutes = (now.getTime() - lastActivityTime) / (60 * 1000);

        // Determine the next eligible step based on progression & enablement status
        // P1-13 fix: allow Step 2 and 3 to fire even if Step 1 failed once elapsed time reaches delay2
        let nextStepToProcess = 1;
        if (isStep1Done || !isStep1Enabled || (step1Sent.length > 0 && elapsedMinutes >= delay2)) {
          nextStepToProcess = 2;
        }
        if (nextStepToProcess === 2 && (isStep2Done || !isStep2Enabled || (step2Sent.length > 0 && elapsedMinutes >= delay3))) {
          nextStepToProcess = 3;
        }
        if (nextStepToProcess === 3 && (isStep3Done || !isStep3Enabled || step3Sent.length > 0)) {
          nextStepToProcess = 4; // All steps sent, attempted, or disabled
        }

        if (nextStepToProcess === 1) {
          // Identity-based dedup check: skip if this stage was already sent for this person
          if (sentIdentityStages.has(`${cartIdentity}::1`)) {
            console.log(`[Scheduler] Cart ${cart.id} Step 1 already sent for identity ${cartIdentity}, skipping.`);
            continue;
          }
          // Step 1: Fired if elapsed time is at least delay1 (default 5m)
          if (elapsedMinutes >= delay1) {
            // Claim job atomically via DB write using upsert to avoid deadlock
            try {
              const existingClaim = step1Sent[0];
              if (existingClaim && existingClaim.status === 'processing') {
                const processingAge = (now.getTime() - new Date(existingClaim.sentAt || existingClaim.createdAt).getTime()) / (60 * 1000);
                if (processingAge < 15) {
                  console.log(`[Scheduler] Cart ${cart.id} Step 1 currently processing (${processingAge.toFixed(1)}m old), skipping.`);
                  continue;
                }
              }

              await db.whatsAppMessage.upsert({
                where: { cartId_recoveryStage: { cartId: cart.id, recoveryStage: 1 } },
                create: {
                  direction: 'outbound',
                  phoneNumber: formattedPhone,
                  cartId: cart.id,
                  recoveryStage: 1,
                  status: 'processing',
                  templateName: step1Template,
                  body: `Cart Recovery Step 1 claiming ${cart.id}`,
                  sentAt: new Date(),
                },
                update: {
                  status: 'processing',
                  templateName: step1Template,
                  body: `Cart Recovery Step 1 claiming ${cart.id}`,
                  sentAt: new Date(),
                }
              });
            } catch (claimErr) {
              console.log(`[Scheduler] Cart ${cart.id} Step 1 already claimed/processed, skipping.`);
              continue;
            }

            const firstItem = cart.items?.[0] || {};
            const res = await templates.sendAbandonedCart({
              phone: formattedPhone,
              customerName: cart.customer?.name || 'there',
              checkoutUrl: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com'}/cart?recover=${cart.id}`,
              productImageUrl: firstItem.image || '',
              productName: firstItem.title || '',
              cartTotal: String(cart.subtotal || '0.00'),
              itemCount: cart.items.length,
              productHandle: firstItem.handle || '',
              cartId: cart.id
            });

            // Handle skipped (converted cart protection triggered inside sendAndLog)
            if (res.skipped) {
              await db.whatsAppMessage.update({
                where: { cartId_recoveryStage: { cartId: cart.id, recoveryStage: 1 } },
                data: {
                  status: 'skipped',
                  body: `Template: ${step1Template} | SKIPPED (cart converted) | Cart: ${cart.id}`,
                  errorMessage: res.error || 'Cart already converted',
                }
              });
              console.log(`[Scheduler] Cart ${cart.id} Step 1 skipped — cart converted.`);
              continue;
            }

            if (res.success) {
              try {
                await db.whatsAppMessage.update({
                  where: { cartId_recoveryStage: { cartId: cart.id, recoveryStage: 1 } },
                  data: {
                    status: 'sent',
                    waMessageId: res.messageId || null,
                    body: `Template: ${step1Template} | Sent to: ${formattedPhone} | Cart: ${cart.id}`,
                    errorMessage: null,
                  }
                });
              } catch (updateErr: any) {
                if (updateErr.code === 'P2002') {
                  console.warn(`[Scheduler] waMessageId collision for cart recovery step 1 (cart ${cart.id}), updating status without waMessageId`);
                  await db.whatsAppMessage.update({
                    where: { cartId_recoveryStage: { cartId: cart.id, recoveryStage: 1 } },
                    data: {
                      status: 'sent',
                      body: `Template: ${step1Template} | Sent to: ${formattedPhone} | Cart: ${cart.id}`,
                      errorMessage: null,
                    }
                  });
                } else {
                  throw updateErr;
                }
              }

              if (cart.status === 'active') {
                await db.cart.update({
                  where: { id: cart.id },
                  data: { status: 'abandoned', abandonedAt: new Date() }
                });
              }
              results.abandonedCartStep1Sent++;
              // Record this identity+stage so later carts for same person are skipped
              sentIdentityStages.add(`${cartIdentity}::1`);
            } else {
              await db.whatsAppMessage.update({
                where: { cartId_recoveryStage: { cartId: cart.id, recoveryStage: 1 } },
                data: {
                  status: 'failed',
                  errorMessage: res.error || 'Failed to send template',
                  nextRetryAt: getNextRetryTime(0),
                  retryCount: 0
                }
              });
            }
          }
        } else if (nextStepToProcess === 2) {
          // Identity-based dedup check for Step 2
          if (sentIdentityStages.has(`${cartIdentity}::2`)) {
            console.log(`[Scheduler] Cart ${cart.id} Step 2 already sent for identity ${cartIdentity}, skipping.`);
            continue;
          }
          // Step 2: Fired if elapsed time is at least delay2 (default 60m)
          const lastStepTime = step1Sent.length > 0 
            ? new Date(step1Sent[step1Sent.length - 1].createdAt).getTime() 
            : lastActivityTime;
          const elapsedSinceLast = (now.getTime() - lastStepTime) / (60 * 1000);

          if (elapsedMinutes >= delay2 && elapsedSinceLast >= 15) {
            try {
              const existingClaim = step2Sent[0];
              if (existingClaim && existingClaim.status === 'processing') {
                const processingAge = (now.getTime() - new Date(existingClaim.sentAt || existingClaim.createdAt).getTime()) / (60 * 1000);
                if (processingAge < 15) {
                  console.log(`[Scheduler] Cart ${cart.id} Step 2 currently processing (${processingAge.toFixed(1)}m old), skipping.`);
                  continue;
                }
              }

              await db.whatsAppMessage.upsert({
                where: { cartId_recoveryStage: { cartId: cart.id, recoveryStage: 2 } },
                create: {
                  direction: 'outbound',
                  phoneNumber: formattedPhone,
                  cartId: cart.id,
                  recoveryStage: 2,
                  status: 'processing',
                  templateName: step2Template,
                  body: `Cart Recovery Step 2 claiming ${cart.id}`,
                  sentAt: new Date(),
                },
                update: {
                  status: 'processing',
                  templateName: step2Template,
                  body: `Cart Recovery Step 2 claiming ${cart.id}`,
                  sentAt: new Date(),
                }
              });
            } catch (claimErr) {
              console.log(`[Scheduler] Cart ${cart.id} Step 2 already claimed/processed, skipping.`);
              continue;
            }

            const firstItem = cart.items?.[0] || {};
            const res = await templates.sendCartRecoveryFollowUp({
              phone: formattedPhone,
              customerName: cart.customer?.name || 'there',
              discountCode: 'ZICA10',
              checkoutUrl: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com'}/cart?recover=${cart.id}`,
              productId: firstItem.productId || '',
              productImageUrl: firstItem.image || '',
              productName: firstItem.title || '',
              productHandle: firstItem.handle || '',
              cartTotal: String(cart.subtotal || '0.00'),
              itemCount: cart.items.length,
              cartId: cart.id
            });

            // Handle skipped (converted cart protection triggered inside sendAndLog)
            if (res.skipped) {
              await db.whatsAppMessage.update({
                where: { cartId_recoveryStage: { cartId: cart.id, recoveryStage: 2 } },
                data: {
                  status: 'skipped',
                  body: `Template: ${step2Template} | SKIPPED (cart converted) | Cart: ${cart.id}`,
                  errorMessage: res.error || 'Cart already converted',
                }
              });
              console.log(`[Scheduler] Cart ${cart.id} Step 2 skipped — cart converted.`);
              continue;
            }

            if (res.success) {
              try {
                await db.whatsAppMessage.update({
                  where: { cartId_recoveryStage: { cartId: cart.id, recoveryStage: 2 } },
                  data: {
                    status: 'sent',
                    waMessageId: res.messageId || null,
                    body: `Template: ${step2Template} | Sent to: ${formattedPhone} | Cart: ${cart.id}`,
                    errorMessage: null,
                  }
                });
              } catch (updateErr: any) {
                if (updateErr.code === 'P2002') {
                  console.warn(`[Scheduler] waMessageId collision for cart recovery step 2 (cart ${cart.id}), updating status without waMessageId`);
                  await db.whatsAppMessage.update({
                    where: { cartId_recoveryStage: { cartId: cart.id, recoveryStage: 2 } },
                    data: {
                      status: 'sent',
                      body: `Template: ${step2Template} | Sent to: ${formattedPhone} | Cart: ${cart.id}`,
                      errorMessage: null,
                    }
                  });
                } else {
                  throw updateErr;
                }
              }
              results.abandonedCartStep2Sent++;
              sentIdentityStages.add(`${cartIdentity}::2`);
            } else {
              await db.whatsAppMessage.update({
                where: { cartId_recoveryStage: { cartId: cart.id, recoveryStage: 2 } },
                data: {
                  status: 'failed',
                  errorMessage: res.error || 'Failed to send template',
                  nextRetryAt: getNextRetryTime(0),
                  retryCount: 0
                }
              });
            }
          }
        } else if (nextStepToProcess === 3) {
          // Identity-based dedup check for Step 3
          if (sentIdentityStages.has(`${cartIdentity}::3`)) {
            console.log(`[Scheduler] Cart ${cart.id} Step 3 already sent for identity ${cartIdentity}, skipping.`);
            continue;
          }
          // Step 3: Fired if elapsed time is between delay3 (default 7d) and 11520 minutes (8d)
          const lastStepTime = step2Sent.length > 0 
            ? new Date(step2Sent[step2Sent.length - 1].createdAt).getTime() 
            : lastActivityTime;
          const elapsedSinceLast = (now.getTime() - lastStepTime) / (60 * 1000);

          if (elapsedMinutes >= delay3 && elapsedSinceLast >= 1440) {
            try {
              const existingClaim = step3Sent[0];
              if (existingClaim && existingClaim.status === 'processing') {
                const processingAge = (now.getTime() - new Date(existingClaim.sentAt || existingClaim.createdAt).getTime()) / (60 * 1000);
                if (processingAge < 15) {
                  console.log(`[Scheduler] Cart ${cart.id} Step 3 currently processing (${processingAge.toFixed(1)}m old), skipping.`);
                  continue;
                }
              }

              await db.whatsAppMessage.upsert({
                where: { cartId_recoveryStage: { cartId: cart.id, recoveryStage: 3 } },
                create: {
                  direction: 'outbound',
                  phoneNumber: formattedPhone,
                  cartId: cart.id,
                  recoveryStage: 3,
                  status: 'processing',
                  templateName: step3Template,
                  body: `Cart Recovery Step 3 claiming ${cart.id}`,
                  sentAt: new Date(),
                },
                update: {
                  status: 'processing',
                  templateName: step3Template,
                  body: `Cart Recovery Step 3 claiming ${cart.id}`,
                  sentAt: new Date(),
                }
              });
            } catch (claimErr) {
              console.log(`[Scheduler] Cart ${cart.id} Step 3 already claimed/processed, skipping.`);
              continue;
            }

            const firstItem = cart.items?.[0] || {};
            const res = await templates.sendCartRecoveryFinalReminder({
              phone: formattedPhone,
              customerName: cart.customer?.name || 'there',
              checkoutUrl: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com'}/cart?recover=${cart.id}`,
              productId: firstItem.productId || '',
              productImageUrl: firstItem.image || '',
              productName: firstItem.title || '',
              productHandle: firstItem.handle || '',
              cartTotal: String(cart.subtotal || '0.00'),
              itemCount: cart.items.length,
              cartId: cart.id
            });

            // Handle skipped (converted cart protection triggered inside sendAndLog)
            if (res.skipped) {
              await db.whatsAppMessage.update({
                where: { cartId_recoveryStage: { cartId: cart.id, recoveryStage: 3 } },
                data: {
                  status: 'skipped',
                  body: `Template: ${step3Template} | SKIPPED (cart converted) | Cart: ${cart.id}`,
                  errorMessage: res.error || 'Cart already converted',
                }
              });
              console.log(`[Scheduler] Cart ${cart.id} Step 3 skipped — cart converted.`);
              continue;
            }

            if (res.success) {
              try {
                await db.whatsAppMessage.update({
                  where: { cartId_recoveryStage: { cartId: cart.id, recoveryStage: 3 } },
                  data: {
                    status: 'sent',
                    waMessageId: res.messageId || null,
                    body: `Template: ${step3Template} | Sent to: ${formattedPhone} | Cart: ${cart.id}`,
                    errorMessage: null,
                  }
                });
              } catch (updateErr: any) {
                if (updateErr.code === 'P2002') {
                  console.warn(`[Scheduler] waMessageId collision for cart recovery step 3 (cart ${cart.id}), updating status without waMessageId`);
                  await db.whatsAppMessage.update({
                    where: { cartId_recoveryStage: { cartId: cart.id, recoveryStage: 3 } },
                    data: {
                      status: 'sent',
                      body: `Template: ${step3Template} | Sent to: ${formattedPhone} | Cart: ${cart.id}`,
                      errorMessage: null,
                    }
                  });
                } else {
                  throw updateErr;
                }
              }
              results.abandonedCartStep3Sent++;
              sentIdentityStages.add(`${cartIdentity}::3`);
            } else {
              await db.whatsAppMessage.update({
                where: { cartId_recoveryStage: { cartId: cart.id, recoveryStage: 3 } },
                data: {
                  status: 'failed',
                  errorMessage: res.error || 'Failed to send template',
                  nextRetryAt: getNextRetryTime(0),
                  retryCount: 0
                }
              });
            }
          }
      }
    }
  } catch (err: any) {
      results.errors.push(`Abandoned cart automation error: ${err.message}`);
    }
  } catch (err: any) {
    success = false;
    results.errors.push(`Unhandled execution error: ${err.message}`);
  } finally {
    try {
      await db.whatsAppSchedulerRun.create({
        data: {
          campaignsProcessed: results.scheduledCampaignsProcessed || 0,
          strandedRecipientsRecovered: results.strandedRecipientsRecovered || 0,
          campaignRecipientsRetried: results.campaignRecipientsRetried || 0,
          messagesRetried: results.messagesRetried || 0,
          abandonedCartStep1Sent: results.abandonedCartStep1Sent || 0,
          abandonedCartStep2Sent: results.abandonedCartStep2Sent || 0,
          abandonedCartStep3Sent: results.abandonedCartStep3Sent || 0,
          errorCount: results.errors.length,
          errors: results.errors.length > 0 ? results.errors.join('\n') : null,
          success: success && results.errors.length === 0
        }
      });

      // Log ping to SyncLog for dead-man's-switch health tracking
      await db.syncLog.create({
        data: {
          orderId: 'system',
          action: 'CRON_PING_WHATSAPP_SCHEDULER',
          status: success && results.errors.length === 0 ? 'SUCCESS' : 'WARNING',
          payload: JSON.stringify(results)
        }
      });
    } catch (logErr: any) {
      console.error('[WhatsApp Scheduler] Failed to write run log to database:', logErr.message);
    }
  }

  return NextResponse.json({ success: success && results.errors.length === 0, results });
}
