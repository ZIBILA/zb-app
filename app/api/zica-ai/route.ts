import { OpenAI } from "openai";
import { NextRequest, NextResponse } from "next/server";
import { getAppAuthFromRequest, resolveAuthCustomer } from "@/lib/appAuth";
import prisma from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

// Helper to format text line by line
const ZICA_OPENAI_SYSTEM_PROMPT = `You are Zica, the intelligent personal fashion AI for Zica Bella — a premium fashion brand based in India.

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

export async function POST(req: NextRequest) {
  const rateLimitResult = await checkRateLimit(req, "zica-ai", { maxRequests: 30, windowMs: 60_000 });
  if (!rateLimitResult.allowed && rateLimitResult.response) {
    return rateLimitResult.response;
  }
  try {
    // Validate API key is present
    if (!process.env.OPENAI_API_KEY) {
      console.error("[Zica AI] OPENAI_API_KEY is not set in environment variables.");
      return NextResponse.json(
        { error: "Zica AI is not configured. Please contact support." },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { error: "Invalid request body" },
        { status: 400 }
      );
    }

    // Support BOTH formats:
    // 1. useClaude hook sends: { message, conversationHistory }
    // 2. Direct API sends:     { messages }
    let openaiMessages: { role: string; content: string }[] = [];
    let returnConversationHistory: any[] = [];

    if (body.message && typeof body.message === "string") {
      // Format 1: useClaude hook — build messages from conversationHistory + new message
      const history = Array.isArray(body.conversationHistory) ? body.conversationHistory : [];
      openaiMessages = history.map((h: any) => ({
        role: h.role === "assistant" ? "assistant" : "user",
        content: typeof h.content === "string"
          ? h.content
          : Array.isArray(h.content)
            ? h.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ") || ""
            : String(h.content || ""),
      }));
      openaiMessages.push({ role: "user", content: body.message });
    } else if (body.messages && Array.isArray(body.messages)) {
      // Format 2: direct messages array
      openaiMessages = body.messages.map((msg: any) => ({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ") || "Hello"
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

    // Fetch safe user preference profile and global trends
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
          where: { userId: customer.id }
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
          const historyText = history.reverse().map((h: any) => `User: ${h.userMessage}\nZica: ${h.aiResponse}`).join("\n\n");
          userContext += `\n\nRecent Conversation History:\n${historyText}`;
        }
      } catch (err) {
        console.error("[Zica AI] Failed to fetch context:", err);
      }
    }

    const systemPrompt = `${ZICA_OPENAI_SYSTEM_PROMPT}${userContext}${globalContext}`;

    // Instantiate OpenAI
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system" as const, content: systemPrompt },
        ...openaiMessages.map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content })),
      ],
      max_tokens: 1024,
    });

    const text = completion.choices[0]?.message?.content || "";

    // Build conversation history for useClaude hook persistence
    returnConversationHistory = [
      ...openaiMessages.map((m: any) => ({ role: m.role, content: m.content })),
      { role: "assistant", content: text },
    ];

    return NextResponse.json({
      message: text,
      response: text,
      conversationHistory: returnConversationHistory.slice(-30),
    });
  } catch (error: any) {
    const statusCode = error?.status || 500;
    const { shouldLogThrottled } = await import("@/lib/log-throttle");
    if (shouldLogThrottled(`openai:zica:${statusCode}`, 120_000)) {
      console.warn("[Zica AI] OpenAI API error:", statusCode, error?.message || error);
    }

    let userMessage = "Zica AI is temporarily unavailable. Please try again.";

    if (error?.message?.includes("API key") || error?.message?.includes("api_key") || statusCode === 401) {
      userMessage = "Zica AI authentication failed. Please verify the OpenAI API configurations.";
    } else if (statusCode === 429 || error?.message?.includes("rate_limit") || error?.message?.includes("quota")) {
      userMessage = "Zica AI is experiencing high demand. Please try again in a moment.";
    }

    return NextResponse.json(
      { error: userMessage },
      { status: statusCode >= 400 && statusCode < 600 ? statusCode : 500 }
    );
  }
}
