/**
 * WhatsApp Campaign Broadcast API Endpoint with Asynchronous Processing
 * Location: app/api/whatsapp/broadcast/route.js
 */

import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { formatPhone, getConfig } from '@/lib/whatsapp/client';

export const dynamic = 'force-dynamic';

import { SENDER_MAP, runBroadcastInBackground, isCampaignEligible, findMissingVariables } from './helper';

/**
 * POST — Initialize campaign and queue background broadcast
 */
export async function POST(req) {
  const config = await getConfig();

  if (!config.configured) {
    return NextResponse.json(
      { error: 'WhatsApp not configured' },
      { status: 503 }
    );
  }

  try {
    const { type, recipients, payload, name, scheduledAt, audience } = await req.json();

    if (!type || !recipients || !Array.isArray(recipients)) {
      return NextResponse.json(
        { error: 'Missing campaign type or recipients array' },
        { status: 400 }
      );
    }

    const payloadObj = payload && typeof payload === 'object' ? payload : {};
    const isScheduled = scheduledAt && !isNaN(Date.parse(scheduledAt)) && new Date(scheduledAt) > new Date();

    // Built-in senders use their own approved templates. Anything else must be an
    // APPROVED Meta template from the library with every input filled in.
    if (!SENDER_MAP[type]) {
      const template = await prisma.whatsAppTemplate.findUnique({ where: { name: type } });
      if (!template) {
        return NextResponse.json({ error: `Unknown template: ${type}` }, { status: 400 });
      }
      if (template.status !== 'APPROVED') {
        return NextResponse.json(
          { error: `Template "${type}" is ${String(template.status).toLowerCase()}, not approved by Meta yet.` },
          { status: 400 }
        );
      }
      const components = Array.isArray(template.components) ? template.components : [];
      const bodyText = components.find(c => c.type === 'BODY')?.text || '';
      const varNames = Array.from(bodyText.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)).map(m => m[1]);
      const missing = findMissingVariables(varNames, payloadObj, components);
      if (missing.length > 0) {
        return NextResponse.json({ error: `Fill in: ${missing.join(', ')}` }, { status: 400 });
      }
    }

    // 1. Only eligible, opted-in numbers are queued (never trust the browser's list)
    const seen = new Set();
    const eligible = [];
    let skippedNotOptedIn = 0;
    let skippedInvalid = 0;
    for (const r of recipients) {
      const phone = formatPhone(r.phone);
      if (!phone || phone.length < 10) { skippedInvalid++; continue; }
      if (seen.has(phone)) continue;
      seen.add(phone);
      if (!(await isCampaignEligible(phone))) { skippedNotOptedIn++; continue; }
      eligible.push({ phone, name: r.customerName || r.name || 'Customer' });
    }

    if (eligible.length === 0) {
      return NextResponse.json(
        { error: 'No eligible recipients. Campaigns are sent only to opted-in customers.', skippedNotOptedIn, skippedInvalid },
        { status: 400 }
      );
    }

    // 2. Create campaign in database
    const campaign = await prisma.whatsAppCampaign.create({
      data: {
        name: name || `Broadcast - ${type} - ${new Date().toLocaleDateString('en-IN')}`,
        templateName: type,
        templateParams: JSON.stringify(payloadObj),
        targetSegment: audience || 'custom',
        status: isScheduled ? 'scheduled' : 'sending',
        scheduledAt: isScheduled ? new Date(scheduledAt) : null,
        statsSent: 0,
        statsDelivered: 0,
        statsRead: 0,
        statsFailed: 0
      }
    });

    const campaignRecipients = eligible.map(r => ({
      campaignId: campaign.id,
      phone: r.phone,
      name: r.name,
      status: 'queued'
    }));
    await prisma.whatsAppCampaignRecipient.createMany({ data: campaignRecipients });

    // 3. Fire background worker without blocking (only if not scheduled in future)
    if (!isScheduled) {
      runBroadcastInBackground(campaign.id, type, payload);
    }

    return NextResponse.json({
      success: true,
      campaignId: campaign.id,
      message: isScheduled ? 'Campaign scheduled successfully.' : 'Campaign broadcast queued successfully.',
      totalQueued: campaignRecipients.length,
      skippedNotOptedIn,
      skippedInvalid,
      status: isScheduled ? 'scheduled' : 'sending'
    });

  } catch (error) {
    console.error('[WhatsApp Broadcast API Route] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }
}
