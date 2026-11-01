/**
 * WhatsApp Database Logging and Settings Subsystem via Prisma ORM
 * Location: lib/whatsapp/logger.js
 */

import prisma from '@/lib/db';
import { formatPhone } from './client';
import { planRecipientStatusUpdate } from './campaign-status';

/**
 * Logs a WhatsApp message transmission.
 */
export async function logMessage(params) {
  if (prisma._isMock) {
    console.log('[WhatsApp Mock Log]', params);
    return true;
  }

  try {
    const phone = params.to_number || params.recipient_phone;
    if (!phone) return false;

    const formatted = formatPhone(phone);
    const status = params.status || 'sent';
    const messageId = params.message_id;
    const templateName = params.template_name;

    let body = params.message_body || null;
    if (!body && params.payload) {
      body = JSON.stringify(params.payload);
    }
    if (!body && params.message_type) {
      body = `Type: ${params.message_type}`;
    }

    let errorMsg = params.error || params.errorMessage || null;
    let errorCode = params.errorCode || null;
    if (params.error_details) {
      if (typeof params.error_details === 'object') {
        errorMsg = params.error_details.error || params.error_details.message || errorMsg || JSON.stringify(params.error_details);
        errorCode = params.error_details.code?.toString() || params.error_details.errorCode?.toString() || errorCode;
      } else {
        errorMsg = String(params.error_details);
      }
    }

    // Find customer if exists
    let userId = null;
    try {
      const customer = await prisma.customer.findFirst({
        where: {
          phone: {
            endsWith: formatted.slice(-10)
          }
        }
      });
      if (customer) userId = customer.id;
    } catch {}

    // Create or update message log using Prisma
    let validCartId = null;
    if (params.cartId) {
      try {
        const cartExists = await prisma.cart.findUnique({
          where: { id: params.cartId },
          select: { id: true }
        });
        if (cartExists) validCartId = params.cartId;
      } catch {}
    }

    const mediaUrl = params.mediaUrl || params.media_url || null;
    const mediaType = params.mediaType || params.media_type || null;
    const orderIdStr = params.orderId || params.order_id ? String(params.orderId || params.order_id) : null;

    let createdRecord = false;
    if (validCartId && params.recoveryStage) {
      try {
        await prisma.whatsAppMessage.upsert({
          where: {
            cartId_recoveryStage: {
              cartId: validCartId,
              recoveryStage: Number(params.recoveryStage)
            }
          },
          update: {
            waMessageId: messageId || undefined,
            phoneNumber: formatted,
            userId: userId || undefined,
            templateName,
            body,
            mediaUrl: mediaUrl || undefined,
            mediaType: mediaType || undefined,
            status,
            orderId: orderIdStr || undefined,
            errorCode: errorCode || null,
            errorMessage: errorMsg || null,
            sentAt: new Date(),
          },
          create: {
            direction: 'outbound',
            waMessageId: messageId || undefined,
            phoneNumber: formatted,
            userId,
            templateName,
            body,
            mediaUrl,
            mediaType,
            status,
            orderId: orderIdStr || undefined,
            errorCode,
            errorMessage: errorMsg,
            sentAt: new Date(),
            cartId: validCartId,
            recoveryStage: Number(params.recoveryStage)
          }
        });
        createdRecord = true;
      } catch (upsertErr) {
        console.warn('[WhatsApp Logger] Cart-stage upsert failed, attempting standard log creation:', upsertErr.message);
      }
    }

    if (!createdRecord) {
      try {
        await prisma.whatsAppMessage.create({
          data: {
            direction: 'outbound',
            waMessageId: messageId || undefined,
            phoneNumber: formatted,
            userId: userId || undefined,
            templateName,
            body,
            mediaUrl,
            mediaType,
            status,
            orderId: orderIdStr || undefined,
            errorCode,
            errorMessage: errorMsg,
            sentAt: new Date(),
            cartId: validCartId || undefined,
            recoveryStage: params.recoveryStage ? Number(params.recoveryStage) : undefined
          }
        });
      } catch (createErr) {
        console.error('[WhatsApp Logger] Failed to create message log entry:', createErr.message);
      }
    }

    // Update delivery status table — only when we have a valid messageId
    // (failed messages don't receive a Meta message ID, so skip to avoid
    // null unique constraint errors)
    if (messageId) {
      await prisma.whatsAppDeliveryStatus.upsert({
        where: { messageId },
        update: {
          status,
          errorCode,
          errorText: errorMsg,
          updatedAt: new Date()
        },
        create: {
          messageId,
          phoneNumber: formatted,
          status,
          errorCode,
          errorText: errorMsg
        }
      });
    }

    // Track template sent events and campaign sent events
    if (templateName) {
      const marketingTemplates = ['abandoned_cart_a1', 'abandoned_cart_a2', 'abandoned_cart_a3', 'zica_cart_recovery_v1', 'zb_abandoned_cart', 'zb_new_collection', 'zb_sale_alert', 'zb_restock_alert', 'zb_welcome'];
      const isMarketing = marketingTemplates.includes(templateName);
      const eventName = isMarketing ? 'Promotional Template Sent' : 'Transactional Template Sent';

      try {
        const { eventTracker } = await import('@/lib/services/eventTracker');
        await eventTracker.track({
          eventName,
          customerId: userId,
          customerPhone: formatted,
          eventSource: 'system',
          metadata: {
            templateName,
            messageId,
            body
          }
        });
      } catch (err) {
        console.error('[WhatsApp Logger] Event tracking template send failed:', err.message);
      }
    }

    if (params.campaignId) {
      try {
        const { eventTracker } = await import('@/lib/services/eventTracker');
        await eventTracker.track({
          eventName: 'WhatsApp Campaign Sent',
          customerId: userId,
          customerPhone: formatted,
          eventSource: 'system',
          metadata: {
            campaignId: params.campaignId,
            templateName,
            messageId
          }
        });
      } catch (err) {
        console.error('[WhatsApp Logger] Event tracking campaign send failed:', err.message);
      }
    }

    return true;
  } catch (error) {
    console.error('[WhatsApp Logger] Failed to log message:', error);
    return false;
  }
}

/**
 * Updates status of a WhatsApp message from a webhook callback.
 */
export async function updateMessageStatus(messageId, status, errorDetails = null) {
  if (prisma._isMock) {
    console.log('[WhatsApp Mock Update]', { messageId, status, errorDetails });
    return true;
  }

  try {
    let errorMsg = null;
    let errorCode = null;
    if (errorDetails) {
      errorCode = errorDetails.code?.toString();
      errorMsg = errorDetails.title || errorDetails.message || JSON.stringify(errorDetails);
    }

    const updateData = {
      status,
      updatedAt: new Date()
    };

    if (status === 'delivered') {
      updateData.deliveredAt = new Date();
    } else if (status === 'read') {
      updateData.readAt = new Date();
    }

    if (errorMsg) {
      updateData.errorMessage = errorMsg;
    }
    if (errorCode) {
      updateData.errorCode = errorCode;
    }

    // Update message log
    await prisma.whatsAppMessage.updateMany({
      where: { waMessageId: messageId },
      data: updateData
    });

    // Update delivery status table
    const deliveryUpdate = {
      status,
      updatedAt: new Date()
    };
    if (status === 'delivered') deliveryUpdate.deliveredAt = new Date();
    if (status === 'read') deliveryUpdate.readAt = new Date();
    if (errorMsg) deliveryUpdate.errorText = errorMsg;
    if (errorCode) deliveryUpdate.errorCode = errorCode;

    await prisma.whatsAppDeliveryStatus.upsert({
      where: { messageId },
      update: deliveryUpdate,
      create: {
        messageId,
        phoneNumber: '', // Will remain empty if not set on creation, but update covers it
        status,
        errorCode,
        errorText: errorMsg,
        deliveredAt: status === 'delivered' ? new Date() : null,
        readAt: status === 'read' ? new Date() : null
      }
    });

    // Retrieve full message to update related campaigns
    const msg = await prisma.whatsAppMessage.findFirst({
      where: { waMessageId: messageId }
    });

    if (msg) {
      // Update campaign metrics if linked
      if (msg.campaignId) {
        const recipient = await prisma.whatsAppCampaignRecipient.findFirst({
          where: { campaignId: msg.campaignId, messageId }
        });

        if (recipient) {
          const plan = planRecipientStatusUpdate(recipient.status, status);
          if (plan.apply) {
            const now = new Date();
            await prisma.whatsAppCampaignRecipient.update({
              where: { id: recipient.id },
              data: {
                status,
                deliveredAt: plan.inc.delivered ? now : undefined,
                readAt: plan.inc.read ? now : undefined,
                errorMessage: status === 'failed' ? errorMsg : undefined
              }
            });

            const updateFields = {};
            if (plan.inc.delivered) {
              updateFields.statsDelivered = { increment: 1 };
              updateFields.delivered = { increment: 1 };
            }
            if (plan.inc.read) {
              updateFields.statsRead = { increment: 1 };
              updateFields.read_count = { increment: 1 };
            }
            if (plan.inc.failed) updateFields.statsFailed = { increment: 1 };
            if (Object.keys(updateFields).length > 0) {
              await prisma.whatsAppCampaign.update({
                where: { id: msg.campaignId },
                data: updateFields
              });
            }
          }
        }
      }

      // Track delivery and read events inside Conversions API tracker
      if (status === 'delivered' || status === 'read') {
        const eventName = status === 'delivered' ? 'WhatsApp Campaign Delivered' : 'WhatsApp Campaign Read';
        try {
          const { eventTracker } = await import('@/lib/services/eventTracker');
          await eventTracker.track({
            eventName,
            customerId: msg.userId,
            customerPhone: msg.phoneNumber,
            eventSource: 'whatsapp',
            metadata: {
              campaignId: msg.campaignId || null,
              messageId: msg.waMessageId,
              templateName: msg.templateName
            }
          });
        } catch (err) {
          console.error('[WhatsApp Logger] Event tracking status callback failed:', err.message);
        }
      }
    }

    return true;
  } catch (error) {
    console.error('[WhatsApp Logger] Failed to update message status:', error);
    return false;
  }
}

/**
 * Retrieves paginated log entries, filtered optionally by template name search.
 */
export async function getLogs({ page = 1, limit = 10, type = '' }) {
  if (prisma._isMock) {
    return { logs: [], totalCount: 0 };
  }

  try {
    const offset = (page - 1) * limit;
    const where = {};
    if (type) {
      where.templateName = { contains: type, mode: 'insensitive' };
    }

    const totalCount = await prisma.whatsAppMessage.count({ where });
    const list = await prisma.whatsAppMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit
    });

    // Map database models to standard frontend logging format
    const logs = list.map(m => ({
      id: m.id,
      recipient_phone: m.phoneNumber,
      to_number: m.phoneNumber,
      message_type: m.templateName ? 'template' : 'text',
      template_name: m.templateName || 'N/A',
      message_body: m.body,
      message_id: m.waMessageId,
      status: m.status,
      error_code: m.errorCode || null,
      error_message: m.errorMessage || null,
      sent_at: m.sentAt || m.createdAt,
      payload: m.errorMessage ? { error: m.errorMessage } : null
    }));

    return { logs, totalCount };
  } catch (error) {
    console.error('[WhatsApp Logger] Failed to fetch logs:', error);
    return { logs: [], totalCount: 0 };
  }
}

/**
 * Gets a WhatsApp configuration toggle/setting value.
 */
export async function getWhatsAppSetting(key, defaultValue = 'true') {
  if (prisma._isMock) {
    return defaultValue;
  }

  try {
    const record = await prisma.whatsAppSetting.findUnique({
      where: { key }
    });
    return record ? record.value : defaultValue;
  } catch (error) {
    console.warn(`[WhatsApp Settings] Failed to read key ${key}:`, error);
    return defaultValue;
  }
}

/**
 * Sets a WhatsApp configuration toggle/setting value.
 */
export async function setWhatsAppSetting(key, value) {
  if (prisma._isMock) {
    return true;
  }

  try {
    await prisma.whatsAppSetting.upsert({
      where: { key },
      update: { value: String(value) },
      create: { key, value: String(value) }
    });
    return true;
  } catch (error) {
    console.error(`[WhatsApp Settings] Failed to save key ${key}:`, error);
    return false;
  }
}
