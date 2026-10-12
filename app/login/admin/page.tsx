"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/login");
  }, [router]);

  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (res.ok) {
        router.push("/dashboard");
      } else {
        setError(data.error || "Invalid password");
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-black relative overflow-hidden font-sans">
      {/* Ambient background glows */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] rounded-full bg-violet-600/10 blur-[130px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-indigo-600/10 blur-[130px]" />
      </div>

      <div className="w-full max-w-md relative z-10 glass-panel border border-white/5 rounded-[2.5rem] p-10 bg-black/40 backdrop-blur-[35px] shadow-[0_30px_70px_rgba(0,0,0,0.5)] animate-in fade-in zoom-in duration-700">
        <div className="flex flex-col items-center mb-10 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center border border-white/10 mb-6 group transition-all duration-500 hover:border-white/20">
            <Lock className="w-7 h-7 text-white/40 group-hover:text-white/70 transition-colors" />
          </div>
          <h1 className="text-[12px] font-bold uppercase tracking-[0.3em] text-white mb-2">ADMIN PORTAL</h1>
          <p className="text-[7.5px] font-bold uppercase tracking-[0.2em] text-white/40">RESTRICTED ACCESS</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-2">
            <label className="text-[9px] font-bold uppercase tracking-widest text-white/40 ml-1">Master Password</label>
            <div className="relative group">
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-sm text-white focus:outline-none focus:ring-1 focus:ring-white/20 focus:bg-white/[0.08] transition-all placeholder:text-white/20 group-hover:bg-white/[0.08]"
                placeholder="Enter access key..."
              />
            </div>
          </div>

          {error && (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs text-center animate-in shake duration-500">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 py-4 bg-white text-black hover:opacity-90 active:scale-[0.99] rounded-2xl text-xs font-bold uppercase tracking-widest transition-all disabled:opacity-50 shadow-xl shadow-white/5"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                Authorize Session
              </>
            )}
          </button>
        </form>

        <div className="mt-12 text-center">
          <p className="text-[8px] font-semibold text-white/10 uppercase tracking-widest leading-relaxed">
            ZICA BELLA EST. 2024
          </p>
        </div>
      </div>
    </div>
  );
}
