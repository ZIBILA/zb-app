"use client";

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Lock, Loader2, ShieldCheck, Fingerprint } from 'lucide-react';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import Image from 'next/image';
import { signIn, useSession } from 'next-auth/react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';

export default function DashboardLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  
  const [email, setEmail] = useState('admin@zicabella.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);

  useEffect(() => {
    setPasskeySupported(browserSupportsWebAuthn());
  }, []);

  const from = searchParams.get('callbackUrl') || searchParams.get('from') || '/dashboard';

  // Map NextAuth error codes to user-friendly messages
  const friendlyError = (code: string): string => {
    const map: Record<string, string> = {
      CredentialsSignin: 'Invalid credentials. Please check your email and password.',
      SessionRequired: 'Your session has expired. Please sign in again.',
      AccessDenied: 'Access denied. You do not have permission.',
      Default: 'Authentication failed. Please try again.',
    };
    return map[code] || map.Default;
  };

  // Show URL error param (e.g. from NextAuth redirect)
  useEffect(() => {
    const urlError = searchParams.get('error');
    if (urlError) {
      setError(friendlyError(urlError));
    }
  }, [searchParams]);

  // Redirect if already logged in
  useEffect(() => {
    if (status === 'authenticated' && session?.user) {
      router.push(from);
    }
  }, [status, session, router, from]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    
    setLoading(true);
    setError('');

    try {
      // Use NextAuth signIn with the admin-login provider
      const result = await signIn('admin-login', {
        email: email.trim(),
        password: password.trim(),
        redirect: false,
        callbackUrl: from,
      });

      if (result?.error) {
        const msg = friendlyError(result.error);
        setError(msg);
        toast.error(msg);
        setLoading(false);
      } else {
        toast.success('Authentication successful. Redirecting...');
        setLoading(true); // Keep loading state
        // Use window.location for a hard redirect to ensure cookies are sent to middleware
        setTimeout(() => {
          window.location.href = from;
        }, 1000);
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const optionsRes = await fetch('/api/auth/passkey/options', { method: 'POST' });
      if (!optionsRes.ok) throw new Error('Could not start passkey sign-in.');
      const assertion = await startAuthentication({ optionsJSON: await optionsRes.json() });

      const result = await signIn('admin-passkey', {
        response: JSON.stringify(assertion),
        redirect: false,
        callbackUrl: from,
      });
      if (result?.error) throw new Error('This passkey is not registered to an active admin account.');

      toast.success('Authentication successful. Redirecting...');
      window.location.href = from;
    } catch (err: any) {
      // NotAllowedError = the user dismissed the passkey prompt; not worth an error banner.
      if (err?.name !== 'NotAllowedError') {
        const msg = err?.message || 'Passkey sign-in failed.';
        setError(msg);
        toast.error(msg);
      }
      setLoading(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-foreground dark:bg-[#0A0A0A]">
        <Loader2 className="w-8 h-8 animate-spin text-background dark:text-foreground/20" />
      </div>
    );
  }

  return (
    <div className="login-page-root">
      {/* Dynamic Background */}
      <div className="login-page-bg" />

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        className="login-card"
      >
        <div className="login-card-reflection" />

        {/* ─── Logo and Header ─── */}
        <div className="login-brand">
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.15, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="login-logo-wrap"
          >
            <div className="login-logo">
              <Image 
                src="/zb-logo-220px.png" 
                alt="Logo" 
                fill 
                className="object-contain dark:invert" 
                priority
              />
            </div>
          </motion.div>
          <div className="text-center space-y-1 mt-2">
            <h1 className="login-brand-name">ZICA BELLA</h1>
            <p className="admin-subtitle-label">AUTHORIZATION PORTAL</p>
          </div>
        </div>

        {/* ─── Form ─── */}
        <form onSubmit={handleLogin} className="login-step-form">
          <div className="login-input-group">
            <label className="admin-input-label">Admin Identity</label>
            <div className="login-name-row">
              <input
                required
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@zicabella.com"
                className="login-name-input"
                autoComplete="email"
              />
            </div>
          </div>

          <div className="login-input-group">
            <label className="admin-input-label">Access Key</label>
            <div className="login-name-row relative pr-12">
              <input
                required
                type={show ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="login-name-input"
                autoComplete="current-password"
                style={{ letterSpacing: show ? 'normal' : '0.2em' }}
              />
              <button
                type="button"
                onClick={() => setShow(v => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-black/35 dark:text-white/30 hover:text-black dark:hover:text-white transition-colors"
              >
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="login-error-banner"
            >
              {error}
            </motion.div>
          )}

          {loading && !error && (
            <p className="admin-loading-text">
              Establishing Secure Session...
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !password || !email}
            className="login-continue-btn mt-2"
          >
            <span className="login-continue-text">
              {loading ? (
                <>
                  <Loader2 className="login-spinner mr-2" />
                  Validating...
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 mr-2" />
                  Authenticate
                </>
              )}
            </span>
          </button>

          {passkeySupported && (
            <button
              type="button"
              onClick={handlePasskeyLogin}
              disabled={loading}
              className="login-continue-btn mt-1 !bg-transparent border border-black/10 dark:border-white/15"
            >
              <span className="login-continue-text !text-current">
                <Fingerprint className="w-4 h-4 mr-2" />
                Sign in with passkey
              </span>
            </button>
          )}
        </form>

        {/* ─── Footer ─── */}
        <div className="flex flex-col items-center gap-4 pt-4 border-t border-black/5 dark:border-white/5">
          <div className="h-[1px] w-12 bg-black/5 dark:bg-white/10" />
          <div className="flex items-center gap-2 text-[9px] text-black/30 dark:text-white/20 uppercase tracking-[0.4em] font-bold">
            <Lock className="w-3 h-3" />
            Secure Tunnel Active
          </div>
        </div>
      </motion.div>

      {/* Scoped styles */}
      <style jsx global>{`
        .login-page-root {
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 20px;
          position: relative;
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue', sans-serif;
        }

        .login-page-bg {
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          background: 
            radial-gradient(ellipse at 30% 20%, rgba(245, 245, 247, 0.9) 0%, transparent 60%),
            radial-gradient(ellipse at 70% 80%, rgba(232, 232, 237, 0.7) 0%, transparent 50%),
            linear-gradient(180deg, #fafafa 0%, #f2f2f5 50%, #eaeaef 100%);
        }

        .dark .login-page-bg {
          background:
            radial-gradient(ellipse at 30% 20%, rgba(20, 20, 30, 0.8) 0%, transparent 60%),
            radial-gradient(ellipse at 70% 80%, rgba(10, 10, 18, 0.6) 0%, transparent 50%),
            linear-gradient(180deg, #0a0a0a 0%, #050505 50%, #000000 100%);
        }

        .login-card {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 400px;
          padding: 48px 32px 40px;
          border-radius: 36px;
          background: rgba(255, 255, 255, 0.72);
          backdrop-filter: blur(40px) saturate(180%);
          -webkit-backdrop-filter: blur(40px) saturate(180%);
          border: 1px solid rgba(0, 0, 0, 0.06);
          box-shadow:
            0 0 0 0.5px rgba(255, 255, 255, 0.5) inset,
            0 20px 60px -10px rgba(0, 0, 0, 0.06),
            0 1px 3px rgba(0, 0, 0, 0.04);
          display: flex;
          flex-direction: column;
          gap: 28px;
          overflow: hidden;
        }

        .dark .login-card {
          background: rgba(18, 18, 22, 0.75);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow:
            0 0 0 0.5px rgba(255, 255, 255, 0.06) inset,
            0 20px 60px -10px rgba(0, 0, 0, 0.6),
            0 1px 3px rgba(0, 0, 0, 0.3);
        }

        .login-card-reflection {
          position: absolute;
          inset: 0;
          background: linear-gradient(165deg, rgba(255,255,255,0.06) 0%, transparent 40%, transparent 60%, rgba(255,255,255,0.02) 100%);
          pointer-events: none;
          border-radius: 36px;
        }

        .dark .login-card-reflection {
          background: linear-gradient(165deg, rgba(255,255,255,0.04) 0%, transparent 40%, transparent 60%, rgba(255,255,255,0.01) 100%);
        }

        .login-brand {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }

        .login-logo-wrap {
          display: flex;
          justify-content: center;
        }

        .login-logo {
          position: relative;
          width: 56px;
          height: 56px;
        }

        .login-brand-name {
          font-family: 'Rocaston', -apple-system, sans-serif;
          font-size: 15px;
          font-weight: 500;
          letter-spacing: 0.35em;
          color: #000;
          text-transform: uppercase;
        }

        .dark .login-brand-name {
          color: #fff;
        }

        .admin-subtitle-label {
          font-size: 8px;
          font-weight: 800;
          letter-spacing: 0.3em;
          color: rgba(0, 0, 0, 0.3);
          text-transform: uppercase;
          margin-top: 4px;
        }

        .dark .admin-subtitle-label {
          color: rgba(255, 255, 255, 0.35);
        }

        .login-step-form {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .login-input-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .admin-input-label {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: rgba(0, 0, 0, 0.4);
          margin-left: 12px;
        }

        .dark .admin-input-label {
          color: rgba(255, 255, 255, 0.4);
        }

        .login-name-row {
          display: flex;
          align-items: center;
          height: 52px;
          border-radius: 26px;
          background: rgba(0, 0, 0, 0.02);
          border: 1px solid rgba(0, 0, 0, 0.08);
          padding: 4px 20px;
          transition: all 0.25s ease;
        }

        .dark .login-name-row {
          background: rgba(255, 255, 255, 0.04);
          border-color: rgba(255, 255, 255, 0.1);
        }

        .login-name-row:focus-within {
          border-color: rgba(0, 0, 0, 0.18);
          box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.03);
        }

        .dark .login-name-row:focus-within {
          border-color: rgba(255, 255, 255, 0.2);
          box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.03);
        }

        .login-name-input {
          flex: 1;
          background: none;
          border: none;
          outline: none;
          font-size: 14px !important;
          font-weight: 500;
          color: #000;
          padding: 0;
        }

        .dark .login-name-input {
          color: #fff;
        }

        .login-name-input::placeholder {
          color: rgba(0, 0, 0, 0.25);
          font-weight: 400;
        }

        .dark .login-name-input::placeholder {
          color: rgba(255, 255, 255, 0.25);
        }

        .login-continue-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 52px;
          border-radius: 26px;
          background: rgba(0, 0, 0, 0.04);
          border: 1px solid rgba(0, 0, 0, 0.08);
          cursor: pointer;
          position: relative;
          transition: all 0.25s ease;
          -webkit-tap-highlight-color: transparent;
        }

        .dark .login-continue-btn {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.1);
        }

        .login-continue-btn:hover:not(:disabled) {
          background: rgba(0, 0, 0, 0.07);
          border-color: rgba(0, 0, 0, 0.12);
        }

        .dark .login-continue-btn:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.1);
          border-color: rgba(255, 255, 255, 0.15);
        }

        .login-continue-btn:active:not(:disabled) {
          transform: scale(0.98);
        }

        .login-continue-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
          pointer-events: none;
        }

        .login-continue-text {
          font-size: 14px;
          font-weight: 600;
          color: #000;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          display: flex;
          align-items: center;
        }

        .dark .login-continue-text {
          color: #fff;
        }

        .login-spinner {
          width: 16px;
          height: 16px;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .admin-loading-text {
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: rgba(0, 0, 0, 0.4);
          text-align: center;
          animation: pulse 2s infinite;
        }

        .dark .admin-loading-text {
          color: rgba(255, 255, 255, 0.45);
        }

        @keyframes pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }

        .login-error-banner {
          text-align: center;
          font-size: 11px;
          font-weight: 600;
          padding: 10px 16px;
          border-radius: 12px;
          color: #dc2626;
          background: rgba(220, 38, 38, 0.06);
          border: 1px solid rgba(220, 38, 38, 0.12);
        }

        .dark .login-error-banner {
          background: rgba(220, 38, 38, 0.08);
          border-color: rgba(220, 38, 38, 0.15);
        }

        @media (max-width: 480px) {
          .login-card {
            padding: 40px 24px 32px;
            border-radius: 28px;
            max-width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
