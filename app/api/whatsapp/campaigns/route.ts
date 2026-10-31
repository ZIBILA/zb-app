/**
 * WhatsApp Campaign Management API Route
 * Location: app/api/whatsapp/campaigns/route.ts
 * 
 * Supports: GET (list all), PATCH (update status), DELETE (remove campaign)
 */

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { runBroadcastInBackground } from '../broadcast/helper';

export const dynamic = 'force-dynamic';

/**
 * GET — List all campaigns with optional filters
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const limit = parseInt(searchParams.get('limit') || '50');

    const where: any = {};

    if (status && status !== 'all') {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { templateName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const campaigns = await prisma.whatsAppCampaign.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return NextResponse.json({ campaigns });
  } catch (error: any) {
    console.error('[WhatsApp Campaigns API] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PATCH — Update campaign status (pause, cancel, resume)
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, action } = body;

    if (!id || !action) {
      return NextResponse.json({ error: 'Missing campaign id or action' }, { status: 400 });
    }

    const campaign = await prisma.whatsAppCampaign.findUnique({ where: { id } });
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    let newStatus = campaign.status;
    let restart = false;

    switch (action) {
      case 'pause':
        if (campaign.status === 'sending') {
          newStatus = 'paused';
        } else {
          return NextResponse.json({ error: 'Can only pause a campaign that is currently sending' }, { status: 400 });
        }
        break;
      case 'resume':
        if (campaign.status === 'paused') {
          newStatus = 'sending';
          restart = true;
        } else {
          return NextResponse.json({ error: 'Can only resume a paused campaign' }, { status: 400 });
        }
        break;
      case 'cancel':
        if (['sending', 'paused', 'scheduled', 'queued'].includes(campaign.status)) {
          newStatus = 'cancelled';
          // Mark all queued recipients as cancelled
          await prisma.whatsAppCampaignRecipient.updateMany({
            where: { campaignId: id, status: 'queued' },
            data: { status: 'cancelled', errorMessage: 'Campaign cancelled by admin' }
          });
        } else {
          return NextResponse.json({ error: 'Cannot cancel a campaign that is already completed or failed' }, { status: 400 });
        }
        break;
      case 'retry_failed': {
        if (!['completed', 'failed'].includes(campaign.status)) {
          return NextResponse.json({ error: 'Failed messages can be retried once the campaign has finished' }, { status: 400 });
        }
        const reset = await prisma.whatsAppCampaignRecipient.updateMany({
          where: { campaignId: id, status: 'failed' },
          data: { status: 'queued', errorMessage: null, nextRetryAt: null, retryCount: 0 }
        });
        if (reset.count === 0) {
          return NextResponse.json({ error: 'No failed messages to retry' }, { status: 400 });
        }
        await prisma.whatsAppCampaign.update({
          where: { id },
          data: { statsFailed: Math.max(0, campaign.statsFailed - reset.count) }
        });
        newStatus = 'sending';
        restart = true;
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    const updated = await prisma.whatsAppCampaign.update({
      where: { id },
      data: { status: newStatus }
    });

    if (restart) {
      const payload = updated.templateParams ? JSON.parse(updated.templateParams) : {};
      runBroadcastInBackground(updated.id, updated.templateName, payload).catch((e: any) => {
        console.error(`[WhatsApp Campaigns API] restart failed for ${updated.id}:`, e);
      });
    }

    return NextResponse.json({ success: true, campaign: updated });
  } catch (error: any) {
    console.error('[WhatsApp Campaigns API] PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE — Delete a campaign and all its recipients
 */
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing campaign id' }, { status: 400 });
    }

    const campaign = await prisma.whatsAppCampaign.findUnique({ where: { id } });
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Don't allow deleting active sending campaigns
    if (campaign.status === 'sending') {
      return NextResponse.json({ error: 'Cannot delete a campaign that is currently sending. Cancel it first.' }, { status: 400 });
    }

    // Recipients will cascade delete due to the relation onDelete: Cascade
    await prisma.whatsAppCampaign.delete({ where: { id } });

    return NextResponse.json({ success: true, message: 'Campaign deleted successfully' });
  } catch (error: any) {
    console.error('[WhatsApp Campaigns API] DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
