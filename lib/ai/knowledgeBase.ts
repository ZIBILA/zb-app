/**
 * lib/ai/knowledgeBase.ts
 * Knowledge Base lookup service for Zica AI Support Agent.
 *
 * Fetches active, admin-configured policies, FAQs, shipping/exchange rules,
 * size guides, and support contact details to inject into system prompt context.
 */

import prisma from '@/lib/db';

export interface KBItem {
  id: string;
  category: string;
  title: string;
  content: string;
  keywords?: string | null;
  priority: number;
}

/** Official support contact — matches the site's structured data and policy pages. Used only when the KB has none. */
export const OFFICIAL_SUPPORT_WHATSAPP = '+91 92203 85011';
export const OFFICIAL_SUPPORT_EMAIL = 'support@zicabella.com';

/** Default fallback Knowledge Base policies used if DB table is unpopulated */
export const DEFAULT_KB_ENTRIES = [
  {
    category: 'SHIPPING',
    title: 'Shipping & Delivery Policy',
    content: `Shipping across India is free on all orders.
Standard delivery timeframe: 3 to 7 business days depending on location.
Dispatch timeframe: Orders are packed and dispatched within 24 to 48 hours.
Tracking: Once shipped, tracking details and live courier link are sent via SMS and Email.`,
    keywords: 'shipping, delivery, dispatch, tracking, courier, delivery time, charges, awb, where is my order',
    priority: 10,
  },
  {
    category: 'ORDER_CHANGES',
    title: 'Pre-AWB Address, Phone & Size Changes',
    content: `Before AWB generation, Zica AI can update the order automatically:
- Address change: collect full name, complete street address, city, state, 6-digit pincode, and 10-digit Indian mobile, then update the order.
- Phone change: collect a valid 10-digit Indian mobile starting with 6-9, then update the order.
- Size change: confirm the product and new size, check stock, then update the order.
After AWB is generated, address, phone, and size MUST NOT be changed. Direct the customer to human support for hold/RTO.
If the customer asks "Where is my order?", fetch and share real tracking (AWB, courier, status, tracking link). Never invent an AWB.`,
    keywords: 'address change, phone change, size change, awb, tracking, where is my order, update address, change size',
    priority: 10,
  },
  {
    category: 'RETURNS_EXCHANGE',
    title: 'Returns & Exchange Policy (Self-Pickup vs Self-Ship Rules)',
    content: `Exchange & Return Window: Customers can request a size exchange or return within 7 days of order delivery.
Condition: Items must be unworn, unwashed, with all original tags attached.
Pickup Rules:
1. Standard Serviceable Pin Codes: Our courier partner will perform reverse pickup directly from the customer's delivery address free of charge within 2-4 business days of request approval.
2. Non-Serviceable Pin Codes: If reverse pickup is unavailable at the customer's location, the customer will be requested to self-ship the item to our central warehouse. Zica Bella reimburses self-shipping costs up to ₹150 as Store Credit upon QC verification.
Process & Settlement: Size exchanges are dispatched immediately upon QC approval of returned item. Returns are settled via Store Credit or original payment source as per policy.`,
    keywords: 'return, exchange, pickup, self-ship, size exchange, return policy, refund, reverse pickup, non-serviceable',
    priority: 10,
  },
  {
    category: 'SIZE_GUIDE',
    title: 'Size & Fit Guidance',
    content: `Silhouette: All Zica Bella garments feature a signature relaxed, oversized streetwear fit.
Fit Advice:
- True-to-size: Ordering your regular size provides the intended oversized silhouette.
- Relaxed/Standard fit: Order one size down if a traditional/standard fit is preferred.
Unisex Design: All apparel is unisex and designed for standard chest and shoulder measurements. Size charts are available on every product page.`,
    keywords: 'size, fit, oversized, measurements, chart, small, medium, large, xl, chest',
    priority: 8,
  },
  {
    category: 'PAYMENT',
    title: 'Payment Methods & COD Rules',
    content: `Accepted Payment Modes: Prepaid (UPI, Debit/Credit Cards, NetBanking via Razorpay), Cash on Delivery (COD), and Store Credit.
COD Commitment Fee: Cash on Delivery orders require a ₹99 upfront commitment fee paid online at checkout. The remaining balance amount is payable in cash or UPI upon delivery to the courier executive.
Prepaid Orders: 100% prepaid orders qualify for priority processing and dispatch.`,
    keywords: 'payment, cod, cash on delivery, prepaid, upi, razorpay, 99 fee, balance due, card',
    priority: 8,
  },
  {
    category: 'CONTACT_ESCALATION',
    title: 'Official Support Contact & Human Handoff Details',
    content: `Support Channels:
- Customer Support Email: support@zicabella.com
- WhatsApp Support Number: +91 92203 85011 (Mon-Sat, 10:00 AM - 7:00 PM IST)
- Live Ticket Chat: Directly on the Zica Bella app & admin dashboard.
Escalation Policy: When a customer asks to speak to a human executive, asks for a supervisor/agent, or faces a payment/delivery dispute, provide these contact details and confirm that their ticket has been flagged for human review.`,
    keywords: 'contact, phone, whatsapp, email, speak to human, agent, support number, representative, escalation, help',
    priority: 10,
  },
];

/**
 * Fetch and construct Knowledge Base context string to inject into AI system prompt.
 *
 * @param query Optional customer message text to match keywords against
 * @returns Formatted knowledge base section for system prompt
 */
export async function getRelevantKnowledgeContext(query?: string): Promise<string> {
  try {
    let entries: KBItem[] = [];

    // Attempt DB query
    try {
      entries = await prisma.supportKnowledgeBase.findMany({
        where: { isActive: true },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, category: true, title: true, content: true, keywords: true, priority: true },
      });
    } catch (dbErr) {
      console.warn('[KnowledgeBase] Database fetch fallback to defaults:', dbErr);
    }

    // Fallback to default entries if DB returns empty
    if (!entries || entries.length === 0) {
      entries = DEFAULT_KB_ENTRIES.map((e, idx) => ({
        id: `default-${idx}`,
        ...e,
      }));
    }

    // Filter/rank entries if query is provided
    let selected = entries;
    if (query && query.trim().length > 0) {
      const qLower = query.toLowerCase();
      selected = entries.filter((item) => {
        if (item.priority >= 10) return true; // Always include high priority items (e.g. shipping, returns, contact)
        const kw = (item.keywords || '').toLowerCase();
        const title = item.title.toLowerCase();
        return (
          kw.split(',').some((k) => qLower.includes(k.trim())) ||
          title.split(' ').some((word) => word.length > 3 && qLower.includes(word))
        );
      });
      // Ensure we don't drop everything if keywords didn't hit
      if (selected.length === 0) {
        selected = entries.slice(0, 5);
      }
    }

    // Format selected entries for system prompt context
    const formatted = selected
      .map(
        (item) => `[${item.title.toUpperCase()}]
${item.content}`
      )
      .join('\n\n');

    return `OFFICIAL ZICA BELLA KNOWLEDGE BASE & STORE POLICIES:\n${formatted}`;
  } catch (err) {
    console.error('[KnowledgeBase] Error retrieving knowledge context:', err);
    return `OFFICIAL ZICA BELLA KNOWLEDGE BASE & STORE POLICIES:\nFree shipping across India (3-7 days). 7-day unworn return/exchange policy. Support email: ${OFFICIAL_SUPPORT_EMAIL}, WhatsApp Support: ${OFFICIAL_SUPPORT_WHATSAPP}.`;
  }
}

/**
 * Support WhatsApp number + email for fixed (non-AI) replies and prompt rules, read from the admin
 * Knowledge Base so the dashboard stays the single source of truth. Falls back to the official
 * contact if the KB has no contact entry or the DB is unreachable.
 */
export async function getSupportContact(): Promise<{ whatsapp: string; email: string }> {
  const fallback = { whatsapp: OFFICIAL_SUPPORT_WHATSAPP, email: OFFICIAL_SUPPORT_EMAIL };
  try {
    const entries: Pick<KBItem, 'category' | 'title' | 'content' | 'keywords'>[] =
      await prisma.supportKnowledgeBase.findMany({
        where: { isActive: true },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        select: { category: true, title: true, content: true, keywords: true },
      });
    const isContact = (e: { category: string; title: string; keywords?: string | null }) =>
      /CONTACT|ESCALATION/i.test(e.category) || /contact|support/i.test(e.title) || /whatsapp/i.test(e.keywords || '');
    const contactEntries = [...entries.filter(isContact), ...entries.filter((e) => !isContact(e))];

    let whatsapp: string | null = null;
    let email: string | null = null;
    for (const e of contactEntries) {
      // Prefer a number on a line that mentions WhatsApp/phone; otherwise the first Indian mobile in the entry
      const line = e.content.split('\n').find((l: string) => /whatsapp|phone|call|mobile/i.test(l) && /\d{5}/.test(l)) || e.content;
      const phone = line.match(/(\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/);
      if (!whatsapp && phone) {
        const digits = phone[0].replace(/\D/g, '').slice(-10);
        whatsapp = `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
      }
      const mail = e.content.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
      if (!email && mail) email = mail[0];
      if (whatsapp && email) break;
    }
    return { whatsapp: whatsapp || fallback.whatsapp, email: email || fallback.email };
  } catch (err) {
    console.warn('[KnowledgeBase] Support contact lookup failed, using official contact:', err);
    return fallback;
  }
}
