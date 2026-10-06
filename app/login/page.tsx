"use client";

import { useState, useEffect, useRef } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Loader2, ChevronDown, ShieldCheck, BadgeCheck, Gem, Sun, Moon, Check, Mail } from "lucide-react";
import Image from "next/image";
import { useTheme } from "next-themes";
import { useMetaEvents } from "@/hooks/useMetaEvents";
import { useSnapEvents } from "@/hooks/useSnapEvents";
import { useOpenAiEvents } from "@/hooks/useOpenAiEvents";
import { getClientCookie } from "@/lib/metaPixel";
import { DEMO_PHONE_E164 } from "@/lib/demo-auth";


/* ────────────────────────────────────────────
   Top 10 Countries — Minimal, No Search
   ──────────────────────────────────────────── */
const COUNTRIES = [
  { name: 'India', code: '+91', iso: 'IN', flag: '🇮🇳' },
  { name: 'United States', code: '+1', iso: 'US', flag: '🇺🇸' },
  { name: 'United Kingdom', code: '+44', iso: 'GB', flag: '🇬🇧' },
  { name: 'UAE', code: '+971', iso: 'AE', flag: '🇦🇪' },
  { name: 'Canada', code: '+1', iso: 'CA', flag: '🇨🇦' },
  { name: 'Australia', code: '+61', iso: 'AU', flag: '🇦🇺' },
  { name: 'Singapore', code: '+65', iso: 'SG', flag: '🇸🇬' },
  { name: 'Germany', code: '+49', iso: 'DE', flag: '🇩🇪' },
  { name: 'Saudi Arabia', code: '+966', iso: 'SA', flag: '🇸🇦' },
  { name: 'France', code: '+33', iso: 'FR', flag: '🇫🇷' },
];

export default function LoginPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isNewUser, setIsNewUser] = useState(false);
  const { trackCompleteRegistration } = useMetaEvents();
  const { trackSignUp: trackSnapSignUp, trackLogin: trackSnapLogin } = useSnapEvents();
  const { trackRegistrationCompleted: trackOaiRegistrationCompleted } = useOpenAiEvents();

  const [step, setStep] = useState<"PHONE" | "NAME" | "OTP">("PHONE");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [showPicker, setShowPicker] = useState(false);
  const [errors, setErrors] = useState<{ phone?: string; otp?: string; name?: string }>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Marketing opt-in state
  // Single combined consent checkbox — covers both WhatsApp and Email.
  // The UI presents one checkbox; the API saves identical values for both channels.
  const [optIn, setOptIn] = useState(true);
  const [hasOptedBefore, setHasOptedBefore] = useState(false);
  const [optInLoaded, setOptInLoaded] = useState(false);
  const [localOptInAccepted, setLocalOptInAccepted] = useState(false);
  const showOptInSection = 
    !localOptInAccepted && 
    (phone.length < 7 || !optInLoaded || !hasOptedBefore);

  // Admin-configurable background images
  const [loginBgLight, setLoginBgLight] = useState("");
  const [loginBgDark, setLoginBgDark] = useState("");
  const [loginBgLightMobile, setLoginBgLightMobile] = useState("");
  const [loginBgDarkMobile, setLoginBgDarkMobile] = useState("");
  const [isMobile, setIsMobile] = useState(false);

  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isSubmittingRef = useRef(false);
  const loginSucceededRef = useRef(false);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => { 
    setMounted(true); 
    if (typeof window !== "undefined") {
      const accepted = localStorage.getItem("zb_marketing_optin_accepted");
      if (accepted === "true") {
        setLocalOptInAccepted(true);
      }
    }
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const safeRedirect = (url: string) => {
    if (url.startsWith("http://") || url.startsWith("https://")) {
      window.location.replace(url);
    } else {
      router.replace(url);
    }
  };

  useEffect(() => {
    if (status === "authenticated") {
      safeRedirect(callbackUrl);
    }
  }, [status, callbackUrl]);

  // Set initial error from search params (NextAuth redirects)
  useEffect(() => {
    const errorParam = searchParams?.get("error");
    if (errorParam) {
      if (errorParam === "CredentialsSignin") {
        setError("Invalid verification code. Please check the code and try again.");
      } else {
        setError(errorParam);
      }
    }
  }, [searchParams]);

  // Fetch login bg images from admin settings
  useEffect(() => {
    fetch("/api/app/settings")
      .then(r => r.json())
      .then(data => {
        if (data.loginBgImageLight) setLoginBgLight(data.loginBgImageLight);
        if (data.loginBgImageDark) setLoginBgDark(data.loginBgImageDark);
        if (data.loginBgImageLightMobile) setLoginBgLightMobile(data.loginBgImageLightMobile);
        if (data.loginBgImageDarkMobile) setLoginBgDarkMobile(data.loginBgImageDarkMobile);
        // Fallback to generic if theme-specific not set
        if (!data.loginBgImageLight && data.loginBgImage) setLoginBgLight(data.loginBgImage);
        if (!data.loginBgImageDark && data.loginBgImage) setLoginBgDark(data.loginBgImage);
        if (!data.loginBgImageLightMobile && data.loginBgImageMobile) setLoginBgLightMobile(data.loginBgImageMobile);
        if (!data.loginBgImageDarkMobile && data.loginBgImageMobile) setLoginBgDarkMobile(data.loginBgImageMobile);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isDark = mounted ? resolvedTheme === 'dark' : true;
  const bgImage = isMobile
    ? (isDark ? (loginBgDarkMobile || loginBgDark || "/load-image-2.jpg") : (loginBgLightMobile || loginBgLight || "/load-image-2.jpg"))
    : (isDark ? (loginBgDark || "/load-image-2.jpg") : (loginBgLight || "/load-image-2.jpg"));

  const handlePhoneChange = (value: string) => {
    let digitsOnly = value.replace(/\D/g, "");
    if (digitsOnly.startsWith("0")) {
      digitsOnly = digitsOnly.slice(1);
    }
    setPhone(digitsOnly);
    if (errors.phone) setErrors({});
  };

  const handleInputBlur = () => {
    // Reset window scroll when keyboard closes on mobile browsers
    setTimeout(() => {
      const activeEl = document.activeElement;
      const isInputFocused = activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.getAttribute('contenteditable') === 'true'
      );
      if (!isInputFocused) {
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      }
    }, 100);
  };

  const sendOTP = async (fullPhone: string) => {
    const res = await fetch("/api/auth/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: fullPhone }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to send verification code");
    }
    return data;
  };

  // Fetch opt-in status when phone is long enough
  const fetchOptInStatus = async (fullPhone: string) => {
    try {
      const res = await fetch(`/api/auth/marketing-optin-status?phone=${encodeURIComponent(fullPhone)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.hasOptedBefore) {
          setHasOptedBefore(true);
          // Sync combined checkbox from server state (user is already opted in for both)
          setOptIn(data.whatsappOptedIn && data.emailOptedIn);
        }
        setOptInLoaded(true);
      }
    } catch (err) {
      // Non-critical — default to showing editable checkboxes
      setOptInLoaded(true);
    }
  };

  // Save marketing opt-in preferences
  const saveOptInPreferences = async (fullPhone: string) => {
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("zb_marketing_optin_accepted", "true");
        setLocalOptInAccepted(true);
      }
      await fetch("/api/auth/marketing-optin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: fullPhone,
          whatsappOptIn: optIn,
          emailOptIn: optIn,
        }),
      });
    } catch (err) {
      // Non-critical — consent save failure should not block login
      console.warn("Failed to save marketing preferences:", err);
    }
  };

  useEffect(() => {
    let cleaned = phone.replace(/\D/g, "");
    if (cleaned.startsWith("0")) {
      cleaned = cleaned.slice(1);
    }
    if (cleaned.length >= 7) {
      const fullPhone = country.code + cleaned;
      fetchOptInStatus(fullPhone);
    } else {
      setHasOptedBefore(false);
      setOptInLoaded(false);
      setOptIn(true);
    }
  }, [phone, country.code]);

  const handleContinuePhone = async (e: React.FormEvent) => {
    e.preventDefault();
    let cleaned = phone.replace(/\D/g, "");
    if (cleaned.startsWith("0")) {
      cleaned = cleaned.slice(1);
    }
    const countryDigits = country.code.replace(/\D/g, "");
    
    if (cleaned.startsWith(countryDigits) && cleaned.length > 10) {
      cleaned = cleaned.slice(countryDigits.length);
    }

    if (cleaned.length < 7) {
      setErrors({ phone: "Enter a valid number" });
      return;
    }

    // Auto-opt-in is handled on backend. Removed blocking client-side requirement.

    const fullPhone = country.code + cleaned;
    
    if (fullPhone === DEMO_PHONE_E164) {
      setName("Demo User");
      setStep("OTP");
      try {
        await fetch("/api/auth/send-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: fullPhone }),
        });
      } catch (err) {}
      return;
    }

    setLoading(true);
    setError("");
    setErrors({});

    try {
      // Save marketing opt-in preferences (non-blocking for login flow)
      await saveOptInPreferences(fullPhone);

      const checkRes = await fetch("/api/auth/check-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: fullPhone }),
      });
      
      const checkData = await checkRes.json();
      if (!checkRes.ok) {
        throw new Error(checkData.error || "Unable to check user profile");
      }

      if (checkData.exists) {
        if (checkData.name) setName(checkData.name);
        await sendOTP(fullPhone);
        setStep("OTP");
      } else {
        setStep("NAME");
      }
    } catch (e: any) {
      setError(e.message || "Failed to check user account");
    } finally {
      setLoading(false);
    }
  };

  const handleContinueName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrors({ name: "Tell us your name" });
      return;
    }

    setLoading(true);
    setError("");
    setErrors({});
    let cleaned = phone.replace(/\D/g, "");
    if (cleaned.startsWith("0")) {
      cleaned = cleaned.slice(1);
    }
    const fullPhone = country.code + cleaned;

    try {
      await sendOTP(fullPhone);
      setIsNewUser(true);
      setStep("OTP");
    } catch (e: any) {
      setError(e.message || "Failed to send OTP code");
    } finally {
      setLoading(false);
    }
  };

  // Debounce timer for auto-submit to prevent race conditions
  const autoSubmitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleAutoSubmit = (code: string) => {
    if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current);
    autoSubmitTimer.current = setTimeout(() => {
      if (!isSubmittingRef.current && !loginSucceededRef.current) {
        handleLogin(code);
      }
    }, 150);
  };

  const handleOtpChange = (val: string, index: number) => {
    const cleanedVal = val.replace(/\D/g, "");
    if (cleanedVal.length > 1) {
      const digits = cleanedVal.slice(0, 6).split("");
      const newOtp = [...otp];
      const startIndex = digits.length === 6 ? 0 : index;
      
      digits.forEach((d, i) => {
        if (startIndex + i < 6) newOtp[startIndex + i] = d;
      });
      setOtp(newOtp);
      
      const nextIdx = Math.min(startIndex + digits.length, 5);
      otpRefs.current[nextIdx]?.focus();

      if (newOtp.every(d => d !== "") && newOtp.join("").length === 6) {
        scheduleAutoSubmit(newOtp.join(""));
      }
      return;
    }

    const newOtp = [...otp];
    newOtp[index] = cleanedVal ? cleanedVal[0] : "";
    setOtp(newOtp);

    if (cleanedVal && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }

    if (newOtp.every(d => d !== "") && index === 5 && cleanedVal) {
      scheduleAutoSubmit(newOtp.join(""));
    }
  };

  const handleOtpKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleLogin = async (codeOverride?: string) => {
    // Prevent double-submission: block if already submitting or if a previous login succeeded
    if (isSubmittingRef.current || loginSucceededRef.current) return;

    const finalOtp = codeOverride || otp.join("");
    if (finalOtp.length < 6 || !/^\d{6}$/.test(finalOtp)) {
      setErrors({ otp: "Enter 6-digit OTP" });
      return;
    }

    isSubmittingRef.current = true;
    setLoading(true);
    setError("");
    setErrors({});

    let cleaned = phone.replace(/\D/g, "");
    if (cleaned.startsWith("0")) {
      cleaned = cleaned.slice(1);
    }
    const fullPhone = country.code + cleaned;

    let clientGeo = "";
    try {
      if (typeof window !== "undefined") {
        clientGeo = sessionStorage.getItem("zb_geo_data") || "";
      }
    } catch {}

    try {
      const result = await signIn("otp", { 
        phone: fullPhone, 
        otp: finalOtp, 
        name: (name || "").trim(),
        ip: getClientCookie("zb_client_ip") || "", 
        clientGeo: clientGeo || "",
        redirect: false, 
        callbackUrl 
      });

      if (result?.error || !result?.ok) {
        if (result?.error === "CredentialsSignin") {
          setError("Invalid OTP. Please check the code and try again.");
        } else {
          setError(result?.error || "Login failed. Please check the code and try again.");
        }
        setLoading(false);
        isSubmittingRef.current = false;
      } else if (result?.ok) {
        if (isNewUser) {
          trackCompleteRegistration();
          trackSnapSignUp();
          trackOaiRegistrationCompleted();
        } else {
          trackSnapLogin();
        }
        // Lock the form permanently — no more submissions allowed
        loginSucceededRef.current = true;
        setRedirecting(true);
        // Hard redirect to refresh server-side sessions
        window.location.replace(callbackUrl);
      }
    } catch (err) {
      setError("Verification failed. Please try again.");
      setLoading(false);
      isSubmittingRef.current = false;
    }
  };

  const handleResendOTP = async () => {
    setLoading(true);
    setError("");
    let cleaned = phone.replace(/\D/g, "");
    if (cleaned.startsWith("0")) {
      cleaned = cleaned.slice(1);
    }
    const fullPhone = country.code + cleaned;

    try {
      await sendOTP(fullPhone);
      setOtp(["", "", "", "", "", ""]);
      setErrors({});
      otpRefs.current[0]?.focus();
    } catch (e: any) {
      setError(e.message || "Failed to resend code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="zb-login-root">
      <div className="zb-login-container">
        {/* ─── Background Image with Vignette Overlay ─── */}
        <div className="zb-login-hero-wrap">
          {bgImage && (
            <motion.img
              key={bgImage}
              src={bgImage}
              alt=""
              initial={{ scale: 1.05, opacity: 0 }}
              animate={{ 
                scale: [1.05, 1.12, 1.05],
                opacity: 1
              }}
              transition={{
                scale: {
                  duration: 25,
                  repeat: Infinity,
                  repeatType: "reverse",
                  ease: "easeInOut"
                },
                opacity: { duration: 0.8 }
              }}
              className="zb-login-hero-img"
            />
          )}
          {/* Ambient luxury glow orb behind the model */}
          <div 
            className="absolute top-1/4 right-1/4 w-64 h-64 rounded-full blur-[80px] pointer-events-none mix-blend-screen opacity-60 dark:opacity-40 animate-pulse" 
            style={{ 
              background: 'radial-gradient(circle, rgba(212,175,55,0.15) 0%, rgba(120,40,200,0.08) 50%, transparent 100%)',
              animationDuration: '8s'
            }} 
          />
          <div className="zb-login-hero-overlay" />
        </div>

        {/* Middle Section: Form Content */}
        <div className="zb-login-form-section">
          {/* Only show hero narrative text if on PHONE or NAME step, to save space for OTP input */}
          {(step === "PHONE" || step === "NAME") && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.6 }}
              className="zb-login-hero-text"
            >
              <h1 className="zb-login-hero-title">
                enter<br />
                <em>your world.</em>
              </h1>
              <p className="zb-login-hero-desc">
                Luxury streetwear<br />designed for the bold.
              </p>
            </motion.div>
          )}

          <AnimatePresence mode="wait">
            {/* ══════════ STEP 1: PHONE ══════════ */}
            {step === "PHONE" && (
              <motion.form
                key="phone-step"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                onSubmit={handleContinuePhone}
                className="zb-login-step"
              >
                <p className="zb-login-instruction">
                  Enter your mobile number and we&apos;ll<br />send you a one-time password.
                </p>

                {/* Phone Input Row */}
                <div className="zb-login-input-wrap">
                  <div className={`zb-login-phone-row ${errors.phone ? 'zb-login-phone-row--error' : ''}`}>
                    {/* Country Code Selector */}
                    <div className="zb-login-cc-selector" ref={dropdownRef}>
                      <button
                        type="button"
                        onClick={() => setShowPicker(!showPicker)}
                        className="zb-login-cc-btn"
                      >
                        <span className="zb-login-cc-flag">{country.flag}</span>
                        <ChevronDown className={`zb-login-cc-chevron ${showPicker ? 'zb-login-cc-chevron--open' : ''}`} />
                      </button>

                      <AnimatePresence>
                        {showPicker && (
                          <motion.div
                            initial={{ opacity: 0, y: -6, scale: 0.97 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -6, scale: 0.97 }}
                            transition={{ duration: 0.15 }}
                            className="zb-login-cc-dropdown"
                          >
                            {COUNTRIES.map((c, idx) => (
                              <button
                                key={`${c.iso}-${idx}`}
                                type="button"
                                onClick={() => { setCountry(c); setShowPicker(false); }}
                                className={`zb-login-cc-item ${country.iso === c.iso ? 'zb-login-cc-item--active' : ''}`}
                              >
                                <span className="zb-login-cc-item-flag">{c.flag}</span>
                                <span className="zb-login-cc-item-name">{c.name}</span>
                                <span className="zb-login-cc-item-code">{c.code}</span>
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    <span className="zb-login-cc-code">{country.code}</span>

                    <input
                      type="tel"
                      placeholder="Enter mobile number"
                      value={phone}
                      onChange={(e) => handlePhoneChange(e.target.value)}
                      onBlur={handleInputBlur}
                      className="zb-login-phone-input"
                      autoFocus
                      required
                    />
                  </div>
                  {errors.phone && <p className="zb-login-field-error">{errors.phone}</p>}
                </div>

                {/* SEND OTP Button */}
                <button
                  type="submit"
                  disabled={loading || phone.length < 7 || (showOptInSection && !optIn)}
                  className="zb-login-send-btn"
                >
                  <span className="zb-login-send-text">
                    {loading ? <Loader2 className="zb-login-spinner" /> : <>SEND OTP <ArrowRight className="zb-login-send-arrow" /></>}
                  </span>
                </button>

                {/* Security message */}
                <div className="zb-login-security-note">
                  <ShieldCheck className="zb-login-security-icon" />
                  <span>We&apos;ll send a secure verification code to continue.</span>
                </div>

                {/* Marketing Opt-In Section */}
                {showOptInSection && (
                  <div className="zb-login-optin-section">
                    <div
                      className="zb-login-optin-row"
                      onClick={() => setOptIn(!optIn)}
                    >
                      <div
                        className={`zb-login-optin-checkbox ${optIn ? 'zb-login-optin-checkbox--checked' : ''}`}
                      >
                        {optIn && <div className="zb-login-optin-checkbox-dot" />}
                      </div>
                      <div className="zb-login-optin-text">
                        <span className="zb-login-optin-label">I agree to receive order updates and community post on WhatsApp and Email.</span>
                      </div>
                    </div>
                  </div>
                )}
              </motion.form>
            )}

            {/* ══════════ STEP 2: NAME ══════════ */}
            {step === "NAME" && (
              <motion.form
                key="name-step"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                onSubmit={handleContinueName}
                className="zb-login-step"
              >
                <div className="zb-login-tab">
                  <div className="zb-login-tab-item zb-login-tab-active">
                    YOUR NAME
                  </div>
                </div>

                <p className="zb-login-instruction">
                  What&apos;s your name?<br />This helps us personalise your experience.
                </p>

                <div className="zb-login-input-wrap">
                  <div className={`zb-login-phone-row ${errors.name ? 'zb-login-phone-row--error' : ''}`}>
                    <input
                      type="text"
                      placeholder="Your Name"
                      value={name}
                      onChange={(e) => { setName(e.target.value); if (errors.name) setErrors({}); }}
                      onBlur={handleInputBlur}
                      className="zb-login-name-input"
                      autoFocus
                      autoComplete="off"
                      required
                    />
                  </div>
                  {errors.name && <p className="zb-login-field-error">{errors.name}</p>}
                </div>

                <button
                  type="submit"
                  disabled={loading || !name.trim()}
                  className="zb-login-send-btn"
                >
                  <span className="zb-login-send-text">
                    {loading ? <Loader2 className="zb-login-spinner" /> : <>CREATE ACCOUNT <ArrowRight className="zb-login-send-arrow" /></>}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setStep("PHONE")}
                  className="zb-login-back-btn"
                >
                  ← Back to Phone
                </button>
              </motion.form>
            )}

            {/* ══════════ STEP 3: OTP ══════════ */}
            {step === "OTP" && (
              <motion.form
                key="otp-step"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                onSubmit={(e) => { e.preventDefault(); if (!isSubmittingRef.current && !loginSucceededRef.current) handleLogin(); }}
                className="zb-login-step"
              >
                <div className="zb-login-tab">
                  <div className="zb-login-tab-item zb-login-tab-active">
                    VERIFY OTP
                  </div>
                </div>

                <p className="zb-login-instruction" style={{ textAlign: 'center' }}>
                  Enter the code sent to<br />
                  <strong className="zb-login-phone-display">{country.code} {phone.slice(0,3)}••••{phone.slice(-3)}</strong>
                </p>

                <div className="zb-login-otp-group">
                  <div className="zb-login-otp-boxes">
                    {otp.map((digit, i) => (
                      <div
                        key={i}
                        className={`zb-login-otp-box ${digit ? 'zb-login-otp-box--filled' : ''}`}
                      >
                        <input
                          ref={(el) => { if (el) otpRefs.current[i] = el; }}
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={6}
                          value={digit}
                          onChange={(e) => handleOtpChange(e.target.value, i)}
                          onKeyDown={(e) => handleOtpKeyDown(e, i)}
                          onBlur={handleInputBlur}
                          placeholder="•"
                          className="zb-login-otp-input"
                          autoFocus={i === 0}
                          disabled={redirecting}
                        />
                      </div>
                    ))}
                  </div>
                  {errors.otp && <p className="zb-login-field-error" style={{ textAlign: 'center' }}>{errors.otp}</p>}
                </div>

                <button
                  type="submit"
                  disabled={loading || redirecting || otp.join("").length < 6}
                  className="zb-login-send-btn"
                >
                  <span className="zb-login-send-text">
                    {redirecting ? <><Loader2 className="zb-login-spinner" /> Logging in…</> : loading ? <Loader2 className="zb-login-spinner" /> : <>VERIFY <ArrowRight className="zb-login-send-arrow" /></>}
                  </span>
                </button>

                <div className="zb-login-otp-actions">
                  <button
                    type="button"
                    onClick={() => { setStep("PHONE"); setOtp(["", "", "", "", "", ""]); }}
                    className="zb-login-otp-action-btn"
                  >
                    Edit Phone
                  </button>
                  <button
                    type="button"
                    onClick={handleResendOTP}
                    disabled={loading}
                    className="zb-login-otp-action-btn"
                  >
                    Resend OTP
                  </button>
                </div>
              </motion.form>
            )}

            {/* Name/OTP steps are the only remaining steps */}
          </AnimatePresence>

          {/* Global Error Banner */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="zb-login-error-banner"
            >
              {error}
            </motion.div>
          )}
        </div>

        {/* Bottom Section: Trust Badges & Policies */}
        <div className="zb-login-form-section zb-login-footer-section">
          {/* Trust Badges */}
          <div className="zb-login-trust-row">
            <div className="zb-login-trust-item">
              <ShieldCheck className="zb-login-trust-icon" />
              <div>
                <span className="zb-login-trust-label">SECURE</span>
                <span className="zb-login-trust-sub">Login</span>
              </div>
            </div>
            <div className="zb-login-trust-item">
              <BadgeCheck className="zb-login-trust-icon" />
              <div>
                <span className="zb-login-trust-label">VERIFIED</span>
                <span className="zb-login-trust-sub">Safe &amp; Fast</span>
              </div>
            </div>
            <div className="zb-login-trust-item">
              <Gem className="zb-login-trust-icon" />
              <div>
                <span className="zb-login-trust-label">PREMIUM</span>
                <span className="zb-login-trust-sub">Experience</span>
              </div>
            </div>
          </div>

          {/* Policy Links */}
          <div className="zb-login-policies">
            <a href="/policies/privacy-policy" className="zb-login-policy-link">Privacy Policy</a>
            <span className="zb-login-policy-dot">•</span>
            <a href="/policies/terms-of-service" className="zb-login-policy-link">Terms &amp; Conditions</a>
          </div>
        </div>
      </div>
    </div>
  );
}
