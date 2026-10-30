"use client";

import { useCallback, useEffect, useState } from "react";
import { Fingerprint, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";

interface Passkey {
  id: string;
  name: string;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Add / remove passkeys for the signed-in admin (Developer Brief #21). */
export default function PasskeyManager() {
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [supported, setSupported] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/passkeys");
    if (res.ok) setPasskeys((await res.json()).passkeys || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    setSupported(browserSupportsWebAuthn());
    load();
  }, [load]);

  const addPasskey = async () => {
    setAdding(true);
    try {
      const optionsRes = await fetch("/api/admin/passkeys/register/options", { method: "POST" });
      const options = await optionsRes.json();
      if (!optionsRes.ok) throw new Error(options.error || "Could not start passkey setup");

      const attestation = await startRegistration({ optionsJSON: options });
      const verifyRes = await fetch("/api/admin/passkeys/register/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: attestation, name: name.trim() || "Passkey" }),
      });
      const data = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(data.error || "Passkey could not be saved");

      toast.success("Passkey added. You can now sign in with it.");
      setName("");
      load();
    } catch (err: any) {
      if (err?.name === "InvalidStateError") toast.error("This device already has a passkey for your account.");
      else if (err?.name !== "NotAllowedError") toast.error(err?.message || "Passkey setup failed");
    } finally {
      setAdding(false);
    }
  };

  const removePasskey = async (id: string) => {
    if (!window.confirm("Remove this passkey? You won't be able to sign in with it anymore.")) return;
    const res = await fetch(`/api/admin/passkeys/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Passkey removed");
      setPasskeys((prev) => prev.filter((p) => p.id !== id));
    } else {
      toast.error("Could not remove passkey");
    }
  };

  return (
    <div className="glass-card p-8 rounded-[2rem] border border-foreground/[0.05] space-y-5">
      <div className="flex items-center gap-3">
        <Fingerprint className="w-5 h-5 text-foreground/60" />
        <div>
          <h2 className="text-sm font-bold uppercase tracking-[0.15em]">Passkeys</h2>
          <p className="text-[11px] text-foreground/50">Sign in with Face ID, Touch ID, Windows Hello or a security key instead of a password.</p>
        </div>
      </div>

      {!supported ? (
        <p className="text-[11px] text-amber-600">This browser doesn't support passkeys.</p>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='Name this passkey, e.g. "MacBook"'
            maxLength={60}
            className="flex-1 h-11 px-4 rounded-xl bg-foreground/[0.03] border border-foreground/10 outline-none focus:border-foreground/30 text-sm"
          />
          <button
            onClick={addPasskey}
            disabled={adding}
            className="h-11 px-5 rounded-xl bg-foreground text-background text-[10px] font-bold uppercase tracking-[0.2em] flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add passkey
          </button>
        </div>
      )}

      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin text-foreground/40" />
      ) : passkeys.length === 0 ? (
        <p className="text-[11px] text-foreground/40">No passkeys yet.</p>
      ) : (
        <ul className="divide-y divide-foreground/[0.05]">
          {passkeys.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-semibold">{p.name}</p>
                <p className="text-[10px] text-foreground/40">
                  Added {format(new Date(p.createdAt), "d MMM yyyy")}
                  {p.lastUsedAt ? ` · last used ${format(new Date(p.lastUsedAt), "d MMM yyyy, h:mm a")}` : " · never used"}
                  {p.backedUp ? " · synced" : ""}
                </p>
              </div>
              <button onClick={() => removePasskey(p.id)} className="p-2 rounded-lg hover:bg-red-500/10 text-foreground/40 hover:text-red-500" aria-label={`Remove ${p.name}`}>
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
