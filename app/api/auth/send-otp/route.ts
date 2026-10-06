import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { SmsService } from "@/lib/services/sms.service";

export const dynamic = "force-dynamic";

// Simple in-memory rate limiter (per phone number, resets on server restart)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OTP_REQUESTS = 5; // Max 5 OTP requests per phone per 10 mins

function checkRateLimit(phone: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(phone);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(phone, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= MAX_OTP_REQUESTS) {
    return false;
  }

  entry.count++;
  return true;
}

import { checkRateLimit as checkIpRateLimit, rateLimit } from "@/lib/rate-limit";
import { resolveEventGeo } from "@/lib/resolve-event-geo";
import { DEMO_PHONE_LAST10, isDemoPhone } from "@/lib/demo-auth";

export async function POST(req: Request) {
  const geo = await resolveEventGeo(req);
  const rateLimitResult = await checkIpRateLimit(req, "auth-send-otp", { maxRequests: 20, windowMs: 600_000 });
  if (!rateLimitResult.allowed && rateLimitResult.response) {
    return rateLimitResult.response;
  }
  try {
    const { phone } = await req.json();

    if (!phone) {
      return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
    }

    // Normalize the phone number
    const normalizedPhone = phone.trim().replace(/[\s\-\(\)]/g, '');
    const digits = normalizedPhone.replace(/\D/g, '');
    
    if (digits.length < 10) {
      return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
    }

    // Rate limit check: in-memory fast-check + persistent DB sliding-window limiter
    if (process.env.NODE_ENV === "production" && !isDemoPhone(digits)) {
      const phoneLast10 = digits.slice(-10);
      if (!checkRateLimit(phoneLast10)) {
        return NextResponse.json(
          { error: "Too many OTP requests. Please try again in a few minutes." }, 
          { status: 429 }
        );
      }
      const persistentLimit = await rateLimit(`otp-send:${phoneLast10}`, { maxRequests: 5, windowMs: 10 * 60 * 1000 });
      if (!persistentLimit.allowed) {
        return NextResponse.json(
          { error: "Too many OTP requests. Please try again in a few minutes." }, 
          { status: 429 }
        );
      }
    }

    // Special case: Demo User Bypass (format-valid Indian mobile for logistics testing)
    if (isDemoPhone(digits)) {
      return NextResponse.json({ 
        success: true, 
        message: "OTP sent successfully (Demo Mode)",
        provider: "demo",
        phone: `+91******${DEMO_PHONE_LAST10.slice(-4)}`
      });
    }

    // Twilio Verify is intentionally BYPASSED here.
    // When Twilio Verify sends an OTP, no code is stored in the local database.
    // This causes verification failures because:
    //   1. The DB-first check in options.ts/mobile-verify finds no matching code
    //   2. If Twilio's checkVerification also fails (code consumed, API error,
    //      exceeded 5 check attempts), the user is permanently locked out
    // By always using manual SMS, we store the OTP in our own DB where we
    // control the full verification lifecycle.
    // See: https://github.com/zica-bella/issues — OTP verification failure fix

    // 2. Fallback to manual SMS if Verify is not available or failed
    // Generate cryptographically-influenced 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Set expiry to 10 minutes from now
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Clean up old expired codes for this phone to prevent DB bloat
    await prisma.verificationCode.deleteMany({
      where: {
        phone: { contains: digits.slice(-10) },
        expiresAt: { lt: new Date() }
      }
    }).catch(() => {}); // Non-critical — don't block OTP send

    // Save to DB
    await prisma.verificationCode.create({
      data: {
        phone: normalizedPhone,
        code: otp,
        expiresAt
      }
    });

    // Send via SMS
    try {
      const message = `Your Zica Bella verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`;
      await SmsService.sendSms(normalizedPhone, message);

      // Log success
      await prisma.appLogin.create({
        data: {
          phone: normalizedPhone,
          status: "OTP_SENT",
          userAgent: req.headers.get("user-agent") || "Web Browser",
          ip: geo.ip,
          geoSource: geo.geoSource,
          city: geo.city,
          region: geo.region,
          country: geo.country,
          countryCode: geo.countryCode,
          zip: geo.zip,
          latitude: geo.latitude,
          longitude: geo.longitude,
        }
      }).catch(console.error);

    } catch (smsError: any) {
      console.error("Failed to send SMS:", smsError);
      // Clean up the OTP since we couldn't send it
      await prisma.verificationCode.deleteMany({
        where: { phone: normalizedPhone, code: otp }
      }).catch(() => {});
      
      // Log failure
      await prisma.appLogin.create({
        data: {
          phone: normalizedPhone,
          status: "OTP_FAILED",
          userAgent: req.headers.get("user-agent") || "Web Browser",
          ip: geo.ip,
          geoSource: geo.geoSource,
          city: geo.city,
          region: geo.region,
          country: geo.country,
          countryCode: geo.countryCode,
          zip: geo.zip,
          latitude: geo.latitude,
          longitude: geo.longitude,
        }
      }).catch(console.error);

      return NextResponse.json(
        { error: "Failed to send verification code. Please check your phone number and try again." }, 
        { status: 500 }
      );
    }

    return NextResponse.json({ 
      success: true, 
      message: "OTP sent successfully",
      provider: "sms",
      // Mask the phone number in the response
      phone: normalizedPhone.slice(0, 4) + "****" + normalizedPhone.slice(-4),
      ...(process.env.NODE_ENV === "development" ? { _devOtp: otp } : {})
    });
  } catch (error: any) {
    console.error("Send OTP error:", error);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
