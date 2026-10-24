/**
 * GET /api/app/speak — text → speech for mobile Zica AI.
 *
 * Anthropic does not offer TTS. Returns 503 so the client can skip audio
 * playback. Chat text still works via Claude.
 */
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const text = searchParams.get("text");

    if (!text || !text.trim()) {
      return NextResponse.json(
        { error: "Text parameter is required" },
        { status: 400 }
      );
    }

    console.warn(
      "[Zica Speak] TTS unavailable — Anthropic has no speech API. Skipping audio."
    );
    return NextResponse.json(
      {
        error:
          "Text-to-speech is not available on Anthropic. Chat replies still work as text.",
        unavailable: true,
      },
      { status: 503 }
    );
  } catch (error: any) {
    console.error("[Zica Speak] Exception", error);
    return NextResponse.json(
      { error: error.message || "Failed to process TTS request" },
      { status: 500 }
    );
  }
}
