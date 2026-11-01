/**
 * Customer lifecycle emails (Developer Brief #24): returns, exchanges, replacements, refunds,
 * out-for-delivery, feedback and store credit. Order confirmed / shipped / delivered / cancelled keep
 * their existing (dashboard-editable) templates in orderEmailService.
 *
 * Tracking links open the Zica Bella app (with a download fallback) as the brief asks.
 */

import { baseEmailLayout } from './base';
import type { CustomerEventType } from '@/lib/notifications/customer-events';

const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://zicabella.com';
export const APP_OPEN_URL = `${SITE}/app`;

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const inr = (amount: number) => `₹${Math.round(amount).toLocaleString('en-IN')}`;

export interface LifecycleEmailData {
  customerName?: string | null;
  orderRef?: string | null;
  replacementRef?: string | null;
  awb?: string | null;
  courier?: string | null;
  statusLabel?: string | null;
  amount?: number | null;
  refundMethod?: 'store_credit' | 'original_source' | string | null;
  balance?: number | null;
  daysLeft?: number | null;
  expiresOn?: string | null;
  reviewUrl?: string | null;
}

interface Built {
  subject: string;
  heading: string;
  intro: string;
  details?: Array<[string, string]>;
  cta?: { label: string; url: string };
  note?: string;
}

const COIN_NOTE = '1 store coin = ₹1. Store coins can be redeemed in the Zica Bella app.';

function build(event: CustomerEventType, d: LifecycleEmailData): Built {
  const order = d.orderRef ? `#${d.orderRef}` : 'your order';
  const tracking: Array<[string, string]> = [
    ...(d.awb ? ([['Tracking number', d.awb]] as Array<[string, string]>) : []),
    ...(d.courier ? ([['Courier', d.courier]] as Array<[string, string]>) : []),
    ...(d.statusLabel ? ([['Status', d.statusLabel]] as Array<[string, string]>) : []),
  ];
  const trackCta = { label: 'Track in the app', url: APP_OPEN_URL };

  switch (event) {
    case 'ORDER_OUT_FOR_DELIVERY':
      return {
        subject: `Out for delivery today — ${order}`,
        heading: 'Out for delivery',
        intro: `Good news — ${order} is out for delivery and should reach you today. Please keep your phone handy for the courier.`,
        details: tracking,
        cta: trackCta,
      };
    case 'RETURN_ACCEPTED':
      return {
        subject: `Your return is approved — ${order}`,
        heading: 'Return approved',
        intro: `We've approved your return for ${order}. Our courier partner will pick the item up from your address — we'll email you the pickup details.`,
        note: 'Please pack the item with its tags attached.',
        cta: trackCta,
      };
    case 'RETURN_PICKUP_UPDATE':
      return {
        subject: `Return pickup update — ${order}`,
        heading: 'Return pickup update',
        intro: `Here's the latest on the pickup for your return from ${order}.`,
        details: tracking,
        cta: trackCta,
      };
    case 'RETURN_RECEIVED':
      return {
        subject: `We've received your return — ${order}`,
        heading: 'Return received',
        intro: `Your returned item from ${order} has reached us and passed our checks. We're processing your refund now.`,
      };
    case 'REFUND_PROCESSED': {
      const toCredit = d.refundMethod === 'store_credit';
      return {
        subject: `Refund processed${d.amount ? ` — ${inr(d.amount)}` : ''}`,
        heading: 'Refund processed',
        intro: toCredit
          ? `We've added ${d.amount ? inr(d.amount) : 'your refund'} to your Zica Bella store coins for ${order}.`
          : `We've refunded ${d.amount ? inr(d.amount) : 'your payment'} for ${order} to your original payment method. Banks usually take 5–7 working days to show it.`,
        note: toCredit ? COIN_NOTE : undefined,
        cta: toCredit ? { label: 'Open the app', url: APP_OPEN_URL } : undefined,
      };
    }
    case 'EXCHANGE_CONFIRMED':
      return {
        subject: `Your exchange is confirmed — ${order}`,
        heading: 'Exchange confirmed',
        intro: `We've approved your exchange for ${order}. We'll pick up the original item first; once it passes our quality check we'll ship your replacement.`,
        cta: trackCta,
      };
    case 'EXCHANGE_PICKUP_UPDATE':
      return {
        subject: `Exchange pickup update — ${order}`,
        heading: 'Exchange pickup update',
        intro: `Here's the latest on the pickup of the item you're exchanging from ${order}.`,
        details: tracking,
        cta: trackCta,
      };
    case 'EXCHANGE_QC_PASSED':
      return {
        subject: `Quality check passed — your replacement is next`,
        heading: 'Quality check passed',
        intro: `The item you sent back from ${order} passed our quality check. We're creating your replacement order now.`,
      };
    case 'REPLACEMENT_CREATED':
      return {
        subject: `Replacement order created${d.replacementRef ? ` — #${d.replacementRef}` : ''}`,
        heading: 'Replacement order created',
        intro: `Your replacement for ${order} has been placed${d.replacementRef ? ` as order #${d.replacementRef}` : ''}. We'll email you as soon as it ships.`,
        cta: trackCta,
      };
    case 'REPLACEMENT_SHIPPED':
      return {
        subject: `Your replacement has shipped`,
        heading: 'Replacement shipped',
        intro: `Your replacement${d.replacementRef ? ` (order #${d.replacementRef})` : ''} is on its way.`,
        details: tracking,
        cta: trackCta,
      };
    case 'REPLACEMENT_OUT_FOR_DELIVERY':
      return {
        subject: `Your replacement is out for delivery`,
        heading: 'Replacement out for delivery',
        intro: `Your replacement${d.replacementRef ? ` (order #${d.replacementRef})` : ''} is out for delivery and should reach you today.`,
        details: tracking,
        cta: trackCta,
      };
    case 'REPLACEMENT_DELIVERED':
      return {
        subject: `Your replacement has been delivered`,
        heading: 'Replacement delivered',
        intro: `Your replacement${d.replacementRef ? ` (order #${d.replacementRef})` : ''} has been delivered. We hope it fits perfectly.`,
      };
    case 'FEEDBACK_REQUEST':
      return {
        subject: `How's your Zica Bella order?`,
        heading: 'Tell us what you think',
        intro: `It's been a few days since ${order} arrived. A quick rating and a photo help other customers pick the right fit.`,
        cta: { label: 'Write a review', url: d.reviewUrl || `${SITE}/orders` },
      };
    case 'STORE_CREDIT_EARNED':
      return {
        subject: `You've earned ${d.amount ? `${Math.round(d.amount)} store coins` : 'store coins'}`,
        heading: 'Store coins earned',
        intro: `${d.amount ? `${Math.round(d.amount)} store coins (${inr(d.amount)})` : 'Store coins'} have been added to your account${d.orderRef ? ` for ${order}` : ''}.${d.balance ? ` Your balance is now ${Math.round(d.balance)} coins.` : ''}`,
        details: d.expiresOn ? [['Valid until', d.expiresOn]] : undefined,
        note: COIN_NOTE,
        cta: { label: 'Open the app', url: APP_OPEN_URL },
      };
    case 'STORE_CREDIT_EXPIRING': {
      const when = d.daysLeft === 0 ? 'today' : `in ${d.daysLeft} day${d.daysLeft === 1 ? '' : 's'}`;
      return {
        subject: d.daysLeft === 0 ? `Your store coins expire today` : `Your store coins expire ${when}`,
        heading: d.daysLeft === 0 ? 'Last day to use your coins' : 'Your store coins are expiring',
        intro: `${d.amount ? `${Math.round(d.amount)} store coins (${inr(d.amount)})` : 'Some of your store coins'} expire ${when}${d.expiresOn ? `, on ${d.expiresOn}` : ''}. Use them on your next order before they're gone.`,
        note: COIN_NOTE,
        cta: { label: 'Shop in the app', url: APP_OPEN_URL },
      };
    }
    default:
      throw new Error(`No lifecycle email template for ${event}`);
  }
}

export function lifecycleEmail(event: CustomerEventType, data: LifecycleEmailData) {
  const b = build(event, data);
  const greeting = `Hi ${esc(data.customerName?.split(' ')[0] || 'there')},`;
  const details = b.details?.length
    ? `<div class="glass-box">${b.details
        .map(([k, v]) => `<p><strong style="color:#ffffff;">${esc(k)}:</strong> ${esc(v)}</p>`)
        .join('')}</div>`
    : '';
  const cta = b.cta ? `<p style="text-align:center;"><a href="${esc(b.cta.url)}" class="cta-btn">${esc(b.cta.label)}</a></p>` : '';
  const note = b.note ? `<p style="font-size:11px;color:#8a8a8f;">${esc(b.note)}</p>` : '';

  const html = baseEmailLayout(
    `<h1>${esc(b.heading)}</h1><p>${greeting}</p><p>${esc(b.intro)}</p>${details}${cta}${note}`,
    esc(b.intro.slice(0, 120))
  );
  const text = [
    greeting,
    b.intro,
    ...(b.details || []).map(([k, v]) => `${k}: ${v}`),
    b.cta ? `${b.cta.label}: ${b.cta.url}` : '',
    b.note || '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return { subject: b.subject, html, text };
}
