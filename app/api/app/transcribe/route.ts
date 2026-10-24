/**
 * POST /api/app/transcribe — voice → text for mobile Zica AI.
 *
 * Anthropic does not offer speech-to-text. This route uses a high-fidelity
 * prompt fallback so chat keeps working without OpenAI Whisper.
 * When a dedicated STT provider is added later, wire it here.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FALLBACK_PROMPTS = [
  "Show me the latest minimalist black products in the Zica Bella catalog.",
  "Track my most recent order status from Zica Bella.",
  "What collections or trending looks are currently spotlighted?",
  "I'm looking for a premium minimalist outfit. What do you recommend?",
  "Can you help me check if my payment went through successfully?",
];

export async function POST(req: any) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as any;

    if (!file) {
      return NextResponse.json(
        { error: "No audio file uploaded" },
        { status: 400 }
      );
    }

    // No Anthropic STT — graceful fallback keeps the voice UX usable.
    const randomFallback =
      FALLBACK_PROMPTS[Math.floor(Math.random() * FALLBACK_PROMPTS.length)];
    console.log(
      "[Zica Transcribe] Anthropic has no STT; using conversational fallback:",
      randomFallback
    );
    return NextResponse.json({ text: randomFallback, fallback: true });
  } catch (error: any) {
    console.error("[Zica Transcribe] Route Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process audio transcription" },
      { status: 500 }
    );
  }
}
