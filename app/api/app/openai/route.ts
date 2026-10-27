/**
 * POST /api/app/openai — legacy mobile path (name kept for clients).
 * Chat completions now run on Anthropic Claude via streamClaude.
 */
import { NextRequest } from "next/server";
import { getAppAuthFromRequest, resolveAuthCustomer } from "@/lib/appAuth";
import prisma from "@/lib/db";
import { streamClaude } from "@/lib/ai/claudeClient";
import type Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.messages || !Array.isArray(body.messages)) {
      return new Response(
        JSON.stringify({ error: "Invalid request: messages array required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const { messages, sessionId, userContext, orderIdContext } = body;
    const auth = getAppAuthFromRequest(req);
    const customer = auth ? await resolveAuthCustomer(auth) : null;
    const userId = customer?.id || userContext?.id;

    let currentSessionId = sessionId;
    if (!currentSessionId) {
      try {
        const session = await prisma.aIChatSession.create({
          data: {
            userId: userId || null,
            title: (
              typeof messages[messages.length - 1]?.content === "string"
                ? messages[messages.length - 1].content
                : "Image analysis"
            ).substring(0, 50),
          },
        });
        currentSessionId = session.id;
      } catch (err) {
        console.error("[Zica User AI] Failed to create chat session:", err);
      }
    }

    const lastUserMsg = messages[messages.length - 1];
    if (currentSessionId && lastUserMsg) {
      try {
        await prisma.aIChatMessage.create({
          data: {
            sessionId: currentSessionId,
            role: "user",
            content:
              typeof lastUserMsg.content === "string"
                ? lastUserMsg.content
                : Array.isArray(lastUserMsg.content)
                  ? lastUserMsg.content
                      .filter((b: any) => b.type === "text")
                      .map((b: any) => b.text)
                      .join(" ") || "Analyze image"
                  : "Analyze image",
          },
        });
      } catch (err) {
        console.error("[Zica User AI] Failed to save user message:", err);
      }
    }

    let systemPrompt = `You are Zica, the intelligent personal fashion AI for Zica Bella — a premium Indian streetwear brand focused on oversized silhouettes, graphic tees, acid-wash apparel, baggy denim, statement accessories, and bold urban styling. All apparel products are designed to be unisex.

RESPONSE RULES:
1. Always be concise, warm, and fashion-forward in tone.
2. When referencing any product, format it as: [Product Name](zicabella://product/{handle})
3. When referencing any collection, format it as: [Collection Name](zicabella://collection/{handle})
4. When asked about tees, t-shirts, graphic tees, acid wash, printed tops, casual wear, or any related category, always lead your response by referencing the Acid Tees collection first: [Acid Tees Collection](zicabella://collection/acid-tees). Then proceed with other relevant suggestions.
5. For styling tips: give 2-3 specific, actionable tips with outfit combinations.
6. For size queries: Zica Bella is designed around an oversized streetwear fit. For a true oversized look, suggest the customer's standard size. For a more fitted relaxed look, suggest one size down. If more detail is needed, advise the customer to check the size guide on the product page.
7. Never hallucinate products — only reference products you are certain exist in the Zica Bella catalogue.
8. Keep responses under 180 words unless the user asks for detail.
9. You are not connected to any admin or internal system and do not share information between users.
10. Under every product recommendation, ALWAYS offer a direct action to add to cart like this: [Add to Bag 🛍️](zicabella://cart/add/handle).

USER SAFETY AND ORDER RULES:
- You may discuss only the customer's own orders, general product information, returns/exchanges, fabric care, sizing, occasion dressing, and styling advice.
- Never reveal or reference manufacturing stages, internal inventory counts, warehouse data, vendor names, sourcing, cost prices, margins, internal order IDs, Shopify admin references, or other users' data.
- When asked about order status, use only these customer-facing statuses: Order Placed, Processing, Ready for Dispatch, Shipped / Out for Delivery, Delivered, Return / Exchange Requested, Cancelled.
- Never fabricate order status, tracking numbers, delivery dates, product availability, or catalogue entries.
- Never expose raw Shopify, checkout, myshopify.com, or admin URLs.

STORE CONTEXT:
- Shipping across India is free; delivery usually takes 3 to 7 business days depending on location.
- Eligible returns and exchanges can be initiated in the app within 7 days of delivery when items are unworn, unwashed, and have original tags attached.`;

    if (userId) {
      try {
        const recentOrders = await prisma.order.findMany({
          where: {
            customerId: userId,
            status: { notIn: ["cancelled", "CANCELLED", "failed", "FAILED"] },
            paymentStatus: {
              notIn: ["failed", "FAILED", "cancelled", "CANCELLED"],
            },
          },
          take: 5,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            shopifyOrderId: true,
            totalPrice: true,
            status: true,
            paymentStatus: true,
            deliveryStatus: true,
            createdAt: true,
          },
        });

        if (recentOrders.length > 0) {
          systemPrompt += `\n\nCustomer's Recent Orders:\n${recentOrders
            .map(
              (o: any) =>
                `- Order #${(o.shopifyOrderId || "").replace(/^#/, "") || o.id.slice(-6)} (${o.id}): ₹${o.totalPrice}, Status: ${o.status}, Payment: ${o.paymentStatus}, Delivery: ${o.deliveryStatus}, Date: ${o.createdAt.toLocaleDateString()}`
            )
            .join("\n")}`;

          systemPrompt += `\n\nIf the customer asks "Where is my order?" or "Track my order", refer to these orders.`;
        }
      } catch (err) {
        console.error("[Zica User AI] Failed to fetch customer orders context:", err);
      }
    }

    try {
      const allProducts = await prisma.product.findMany({
        select: { title: true, price: true, handle: true, featuredImage: true },
        take: 50,
      });

      if (allProducts.length > 0) {
        systemPrompt += `\n\nZica Bella Product Catalog:\n`;
        systemPrompt += allProducts
          .map(
            (p: any) =>
              `- ${p.title}: ₹${p.price || "N/A"}. Handle: ${p.handle}. Image: ${p.featuredImage || ""}`
          )
          .join("\n");
      }
    } catch (err) {
      console.error("[Zica User AI] Failed to fetch products context:", err);
    }

    if (orderIdContext) {
      systemPrompt += `\n\nThe customer is currently viewing order ID: ${orderIdContext}. Focus on this order if they ask general questions.`;
    }

    // Map OpenAI-style / Anthropic-style content blocks → Anthropic MessageParam
    const formattedMessages: Anthropic.MessageParam[] = messages.map(
      (msg: any) => {
        let content: Anthropic.MessageParam["content"] = msg.content;
        if (Array.isArray(content)) {
          content = content.map((block: any) => {
            if (block.type === "image" && block.source) {
              return {
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: block.source.media_type || "image/jpeg",
                  data: block.source.data,
                },
              };
            }
            if (block.type === "image_url" && block.image_url?.url) {
              const url: string = block.image_url.url;
              const match = url.match(/^data:([^;]+);base64,(.+)$/);
              if (match) {
                return {
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: match[1] as Anthropic.Base64ImageSource["media_type"],
                    data: match[2],
                  },
                };
              }
              return { type: "text" as const, text: "[image]" };
            }
            return {
              type: "text" as const,
              text: block.text || block.content || "",
            };
          }) as Anthropic.ContentBlockParam[];
        }
        return {
          role: msg.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content,
        };
      }
    );

    // Ensure conversation ends with a user turn (Anthropic requirement)
    if (
      formattedMessages.length === 0 ||
      formattedMessages[formattedMessages.length - 1].role !== "user"
    ) {
      formattedMessages.push({ role: "user", content: "Please continue." });
    }

    const anthropicStream = await streamClaude({
      systemPrompt,
      messages: formattedMessages,
      maxTokens: 1024,
    });

    const encoder = new TextEncoder();
    const customStream = new ReadableStream({
      async start(controller) {
        let fullResponseText = "";
        try {
          for await (const event of anthropicStream as AsyncIterable<any>) {
            if (
              event.type === "content_block_delta" &&
              event.delta?.type === "text_delta" &&
              event.delta?.text
            ) {
              const token = event.delta.text as string;
              fullResponseText += token;
              const dataString = `data: ${JSON.stringify({
                type: "content_block_delta",
                delta: { text: token },
              })}\n\n`;
              controller.enqueue(encoder.encode(dataString));
            }
          }

          if (currentSessionId && fullResponseText.trim()) {
            await prisma.aIChatMessage.create({
              data: {
                sessionId: currentSessionId,
                role: "assistant",
                content: fullResponseText,
              },
            });
          }
        } catch (streamErr) {
          console.error("[Zica User AI] Streaming error:", streamErr);
          const dataString = `data: ${JSON.stringify({
            type: "error",
            error: { message: "AI response stream interrupted." },
          })}\n\n`;
          controller.enqueue(encoder.encode(dataString));
        } finally {
          const doneString = `data: ${JSON.stringify({
            type: "message_stop",
            sessionId: currentSessionId,
          })}\n\n`;
          controller.enqueue(encoder.encode(doneString));
          controller.close();
        }
      },
    });

    return new Response(customStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error: any) {
    console.error("[Zica User AI] Route Exception:", error);
    const msg =
      error?.message?.includes("No valid Anthropic") || error?.status === 401
        ? "Zica AI is not configured. Add ANTHROPIC_API_KEY or Claude API key in settings."
        : error.message || "Internal server error";
    return new Response(JSON.stringify({ error: msg }), {
      status: error?.status === 401 ? 503 : 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
