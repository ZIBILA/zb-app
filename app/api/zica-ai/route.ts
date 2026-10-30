import { NextRequest, NextResponse } from "next/server";
import { getAppAuthFromRequest, resolveAuthCustomer } from "@/lib/appAuth";
import prisma from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { callClaude } from "@/lib/ai/claudeClient";
import { getFastModel } from "@/lib/ai/models";
import type Anthropic from "@anthropic-ai/sdk";
import { callOpenAiChat, isOpenAiFallbackConfigured } from "@/lib/ai/openaiFallback";

const ZICA_SYSTEM_PROMPT = `You are Zica, the intelligent personal fashion AI for Zica Bella — a premium fashion brand based in India.

You are running in a customer-facing public webstore environment. Your primary expertise is global/Indian fashion, styling, color theory, product discoverability, size guides, and care advice.

GENERAL KNOWLEDGE & OUT-OF-SYLLABUS TOPICS:
You are a highly capable general-purpose AI. While your primary brand persona is a helpful personal stylist, you are permitted and encouraged to answer any general knowledge, code, math, history, science, creative, or miscellaneous "out-of-syllabus" questions that the user asks. Do not refuse general queries; help the user with any request while keeping a helpful, friendly tone, but strictly enforce the data security boundaries below (no admin/backend records).

CRITICAL DATA SECURITY BOUNDARIES:
1. You do not have access to internal systems, databases, or administration tools.
2. You MUST NOT answer or share any data regarding backend operations, internal inventory counts, fabric supplier names, wholesale costs, profit margins, Delhivery/Razorpay credentials, manufacturing stages (e.g. cutting, washing, quality checks), internal order logs, or vendor names.
3. If asked about these topics, politely refuse and guide the user to check public pages or contact help.
4. Never reveal Shopify admin URLs, myshopify.com domains, or private database IDs.
5. Never discuss admin passwords, logins, or other customers' information.

BEHAVIOR & TONE RULES:
1. Be concise, warm, fashion-forward, and helpful.
2. Format product links as: [Product Name](zicabella://product/{handle})
3. Format collection links as: [Collection Name](zicabella://collection/{handle})
4. Always suggest the Acid Tees collection first if the user inquires about tees, graphic tees, or casual tops: [Acid Tees Collection](zicabella://collection/acid-tees)
5. Keep responses direct and under 180 words.`;

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function toClaudeMessages(
  msgs: { role: string; content: string }[]
): Anthropic.MessageParam[] {
  // Anthropic requires alternating roles and a final user turn.
  const out: Anthropic.MessageParam[] = [];
  for (const m of msgs) {
    const role = m.role === "assistant" ? "assistant" : "user";
    const content = (m.content || "").trim();
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === role && typeof last.content === "string") {
      last.content = `${last.content}\n\n${content}`;
    } else {
      out.push({ role, content });
    }
  }
  if (out.length === 0) {
    out.push({ role: "user", content: "Hello" });
  } else if (out[out.length - 1].role !== "user") {
    out.push({ role: "user", content: "Please continue." });
  }
  return out;
}

/** One structured log line per provider failure, with the reason the team needs to act on. */
function logAiFailure(provider: "claude" | "openai", error: any) {
  const status = Number(error?.status) || null;
  const text = `${error?.message || ""} ${error?.error?.message || ""}`;
  const reason = /credit balance|too low|billing|purchase credits|insufficient_quota/i.test(text)
    ? "billing / out of credits"
    : status === 401 || /api key|api_key|authentication|No valid Anthropic/i.test(text)
      ? "invalid or missing API key"
      : status === 429 || /rate_limit|overloaded/i.test(text)
        ? "rate limited / overloaded"
        : /timeout|aborted/i.test(text)
          ? "timeout"
          : "error";
  console.error(`[Zica AI] ${provider} failed — ${reason}`, { status, message: (error?.message || String(error)).slice(0, 300) });
  if (error && typeof error === "object") error.zicaLogged = true;
}

export async function POST(req: NextRequest) {
  const rateLimitResult = await checkRateLimit(req, "zica-ai", {
    maxRequests: 30,
    windowMs: 60_000,
  });
  if (!rateLimitResult.allowed && rateLimitResult.response) {
    return rateLimitResult.response;
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    let rawMessages: { role: string; content: string }[] = [];

    if (body.message && typeof body.message === "string") {
      const history = Array.isArray(body.conversationHistory)
        ? body.conversationHistory
        : [];
      rawMessages = history.map((h: any) => ({
        role: h.role === "assistant" ? "assistant" : "user",
        content:
          typeof h.content === "string"
            ? h.content
            : Array.isArray(h.content)
              ? h.content
                  .filter((b: any) => b.type === "text")
                  .map((b: any) => b.text)
                  .join(" ") || ""
              : String(h.content || ""),
      }));
      rawMessages.push({ role: "user", content: body.message });
    } else if (body.messages && Array.isArray(body.messages)) {
      rawMessages = body.messages.map((msg: any) => ({
        role: msg.role === "assistant" ? "assistant" : "user",
        content:
          typeof msg.content === "string"
            ? msg.content
            : Array.isArray(msg.content)
              ? msg.content
                  .filter((b: any) => b.type === "text")
                  .map((b: any) => b.text)
                  .join(" ") || "Hello"
              : String(msg.content || "Hello"),
      }));
    } else {
      return NextResponse.json(
        { error: "Invalid request: message string or messages array required" },
        { status: 400 }
      );
    }

    const auth = getAppAuthFromRequest(req);
    const customer = auth ? await resolveAuthCustomer(auth) : null;

    let globalContext = "";
    let userContext = "";

    if (customer) {
      try {
        const topProducts = await prisma.zicaAiGlobalInsight.findMany({
          where: { insightType: "popular_product" },
          orderBy: { frequency: "desc" },
          take: 10,
        });
        const topTrends = await prisma.zicaAiGlobalInsight.findMany({
          where: { insightType: "style_trend" },
          orderBy: { frequency: "desc" },
          take: 5,
        });

        if (topProducts.length > 0 || topTrends.length > 0) {
          const productNames = topProducts.map((p: any) => p.key).join(", ");
          const trendNames = topTrends.map((t: any) => t.key).join(", ");
          globalContext = `\n\nCurrently trending at Zica Bella: ${productNames}.`;
          if (trendNames) {
            globalContext += ` Common trends include: ${trendNames}.`;
          }
        }

        const profile = await prisma.zicaUserProfile.findUnique({
          where: { userId: customer.id },
        });
        if (profile) {
          const categories = profile.preferredCategories.join(", ") || "various categories";
          const sizes = profile.preferredSizes.join(", ") || "their usual size";
          const styles = profile.styleTags.join(", ") || "various styles";
          userContext = `\n\nThis customer prefers ${categories}, usually wears size ${sizes}, and has shown interest in ${styles}. Reference their preferences naturally without listing them explicitly.`;
        }

        const history = await prisma.zicaAiCache.findMany({
          where: { userId: customer.id },
          orderBy: { timestamp: "desc" },
          take: 10,
        });

        if (history.length > 0) {
          const historyText = history
            .reverse()
            .map((h: any) => `User: ${h.userMessage}\nZica: ${h.aiResponse}`)
            .join("\n\n");
          userContext += `\n\nRecent Conversation History:\n${historyText}`;
        }
      } catch (err) {
        console.error("[Zica AI] Failed to fetch context:", err);
      }
    }

    const systemPrompt = `${ZICA_SYSTEM_PROMPT}${userContext}${globalContext}`;
    const claudeMessages = toClaudeMessages(rawMessages);
    const fast = getFastModel();

    const maxTokens = Math.min(1024, fast.maxTokens);

    let text: string;
    let provider: "claude" | "openai" = "claude";
    try {
      const { response } = await callClaude({
        systemPrompt,
        messages: claudeMessages,
        maxTokens,
        modelChain: [fast],
      });
      text = extractText(response.content);
      if (!text.trim()) throw new Error("Claude returned an empty response");
    } catch (claudeError: any) {
      logAiFailure("claude", claudeError);
      // Claude is down / out of credits / rate-limited — answer through OpenAI instead of failing.
      if (!isOpenAiFallbackConfigured()) throw claudeError;
      try {
        text = await callOpenAiChat({
          systemPrompt,
          messages: rawMessages.map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: m.content,
          })),
          maxTokens,
        });
        provider = "openai";
      } catch (openAiError: any) {
        logAiFailure("openai", openAiError);
        throw claudeError;
      }
    }

    const returnConversationHistory = [
      ...rawMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: "assistant", content: text },
    ];

    return NextResponse.json({
      message: text,
      response: text,
      provider,
      conversationHistory: returnConversationHistory.slice(-30),
    });
  } catch (error: any) {
    // Shoppers get one neutral message; the real reason (billing, auth, rate limit…) is in the
    // server logs from logAiFailure — never shown to customers.
    const statusCode = Number(error?.status) || 500;
    if (!error?.zicaLogged) console.error("[Zica AI] Request failed:", error?.message || error);
    return NextResponse.json(
      { error: "Zica AI is taking a short break. Please try again in a moment." },
      { status: statusCode === 429 ? 429 : 503 }
    );
  }
}
