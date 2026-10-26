/**
 * lib/ai/whatsappAgent.ts
 * AI auto-reply handler for incoming WhatsApp messages.
 *
 * Rules:
 * - Identifies customer by phone number ONLY (last-10 digits via formatPhone)
 * - Checks opt-out status (WhatsAppOptIn / Customer.whatsappOptedOut)
 * - Checks 24-hour service window
 * - Calls Claude with customer or guest prompt + customer tool allow-list
 * - Supports multi-round tool-use loops for chained lookups
 * - Applies Output Guard before sending reply via WhatsApp API
 */

import prisma from "@/lib/db";
import { formatPhone } from "@/lib/whatsapp/client";
import { WhatsAppService } from "@/lib/services/whatsapp.service";
import { isWhatsAppServiceWindowActive } from "./whatsappServiceWindow";
import { callClaude, MAX_TOOL_LOOPS } from "./claudeClient";
import { filterToolsForPrincipal } from "./toolAllowList";
import { getPromptForPrincipal } from "./prompts";
import { applyOutputGuard } from "./outputGuard";
import { stripMarkdown } from "./formatSanitizer";
import { getRelevantKnowledgeContext } from "./knowledgeBase";
import { executeClaudeTool } from "@/lib/services/claudeToolExecutor";
import { ZICA_TOOLS } from "@/lib/services/claudeService";
import type { Principal } from "./principal";
import Anthropic from "@anthropic-ai/sdk";

export interface WhatsAppAIReplyResult {
  replied: boolean;
  message?: string;
  reason?: string;
}

export async function processWhatsAppAIReply(
  rawPhone: string,
  userMessageText: string
): Promise<WhatsAppAIReplyResult> {
  try {
    // 1. Check feature flag / kill switch & shop settings
    if (process.env.DISABLE_WHATSAPP_AI === "true") {
      return { replied: false, reason: "WhatsApp AI disabled via environment" };
    }

    const shop = await prisma.shop.findFirst({
      select: { zicaAiWhatsappEnabled: true },
    });
    if (shop && shop.zicaAiWhatsappEnabled === false) {
      return { replied: false, reason: "WhatsApp AI disabled in Shop settings" };
    }

    const phoneNumber = formatPhone(rawPhone) || rawPhone;
    const clean10Digits = rawPhone.replace(/\D/g, '').slice(-10);

    // Check per-chat AI auto-reply toggle
    const chatSetting = await prisma.whatsAppChatSetting.findFirst({
      where: {
        phoneNumber: { contains: clean10Digits },
      },
    });
    if (chatSetting && chatSetting.aiAutoReply === false) {
      return { replied: false, reason: "AI auto-reply turned off by admin for this conversation" };
    }

    // 2. Check Opt-Out status
    const optInRecord = await prisma.whatsAppOptIn.findFirst({
      where: { phone: { contains: clean10Digits } },
    });
    if (optInRecord?.status === "opted_out") {
      return { replied: false, reason: "Customer has opted out of WhatsApp" };
    }

    const customer = await prisma.customer.findFirst({
      where: { phone: { contains: clean10Digits } },
      select: { id: true, name: true, email: true, phone: true, whatsappOptedOut: true },
    });
    if (customer?.whatsappOptedOut) {
      return { replied: false, reason: "Customer profile marked as opted out" };
    }

    // 3. Verify 24-hour service window (always active if inbound user text is present)
    const windowActive = (userMessageText && userMessageText.trim().length > 0) ? true : await isWhatsAppServiceWindowActive(phoneNumber);
    if (!windowActive) {
      return { replied: false, reason: "Meta 24-hour service window expired" };
    }

    // 4. Derive principal (customer or guest) by phone lookup only
    const principal: Principal = customer
      ? { kind: "customer", customerId: customer.id, phone: customer.phone || undefined, email: customer.email || undefined }
      : { kind: "guest", phone: phoneNumber };

    // 5. Fetch recent chat history (last 10 messages)
    const recentMessages = await prisma.whatsAppMessage.findMany({
      where: { phoneNumber: { contains: clean10Digits } },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    recentMessages.reverse();

    const conversationHistory: Anthropic.MessageParam[] = recentMessages.map((m: any) => ({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: m.body || "",
    }));

    // Only add current message if it wasn't already captured in the DB history
    const alreadyInHistory = recentMessages.some(
      (m: any) => m.direction === 'inbound' && m.body === userMessageText
    );
    if (!alreadyInHistory) {
      conversationHistory.push({ role: "user", content: userMessageText });
    }

    // Ensure conversation doesn't start with assistant message (Claude requires user first)
    while (conversationHistory.length > 0 && conversationHistory[0].role === 'assistant') {
      conversationHistory.shift();
    }

    // Ensure we have at least one user message
    if (conversationHistory.length === 0) {
      conversationHistory.push({ role: "user", content: userMessageText });
    }

    const allowedTools = filterToolsForPrincipal(ZICA_TOOLS as any, principal);

    // Fetch dynamic Knowledge Base context
    const kbContext = await getRelevantKnowledgeContext(userMessageText);

    // Build enriched system prompt with customer context
    let customerContext = '';
    if (principal.kind === 'customer' && customer) {
      customerContext = `\n\nCustomer Context: You are chatting with "${customer.name || 'Customer'}"${customer.email ? ` (${customer.email})` : ''}. This is a verified customer.`;
    }

    const systemPrompt = getPromptForPrincipal(principal.kind)
      + `\n\nChannel: WhatsApp. Keep responses concise (under 250 characters when possible). Format key details cleanly.`
      + customerContext
      + `\n\n${kbContext}`
      + `\n\nIMPORTANT: When a customer provides an order number, use get_order_by_number. For tracking use get_order_tracking. For address/phone/size before AWB, collect complete details then use update_order_address, update_order_phone, or update_order_size. After AWB those changes are blocked. DO NOT output Markdown. Write in clean plain text.`;

    // Multi-round tool-use loop (up to 3 rounds for chained lookups)
    const maxToolRounds = Math.min(6, MAX_TOOL_LOOPS);
    let currentMessages = [...conversationHistory];
    let finalAnswer = "";

    for (let round = 0; round < maxToolRounds; round++) {
      const result = await callClaude({
        systemPrompt,
        messages: currentMessages,
        tools: allowedTools as Anthropic.Tool[],
      });

      const response = result.response;

      if (response.stop_reason === "tool_use") {
        const toolResults: any[] = [];
        for (const block of response.content) {
          if (block.type === "tool_use" && block.name && block.id) {
            const toolOutput = await executeClaudeTool(block.name, block.input || {}, principal);
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: toolOutput,
            });
          }
        }

        currentMessages.push({ role: "assistant", content: response.content as any });
        currentMessages.push({ role: "user", content: toolResults });
        // Continue the loop to let Claude process tool results
        continue;
      }

      // Claude returned a text response — extract it
      finalAnswer = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as any).text)
        .join("\n");
      break;
    }

    // If all rounds were tool_use and we never got a text response, do one final call
    if (!finalAnswer) {
      const finalResult = await callClaude({
        systemPrompt,
        messages: currentMessages,
        tools: allowedTools as Anthropic.Tool[],
      });
      finalAnswer = finalResult.response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as any).text)
        .join("\n");
    }

    // Apply Output Guard and strip Markdown syntax
    const safeText = applyOutputGuard(finalAnswer, "whatsapp");
    const cleanText = stripMarkdown(safeText);

    // Send reply via WhatsApp Production Service
    const sent = await WhatsAppService.sendTextMessage(phoneNumber, cleanText);

    if (sent) {
      // Record outbound AI message in database
      await prisma.whatsAppMessage.create({
        data: {
          direction: "outbound",
          phoneNumber,
          userId: customer?.id || null,
          body: cleanText,
          status: "sent",
        },
      });
    }

    return { replied: true, message: cleanText };
  } catch (error: any) {
    console.error("[WhatsAppAgent] Auto-reply error:", error);
    return { replied: false, reason: "Internal error processing WhatsApp AI reply" };
  }
}
