"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  User,
  LogOut,
  Package,
  ChevronRight,
  Shield,
  Bookmark,
  Sparkles,
  Camera,
  Loader2,
  Check,
  Star,
  ShoppingBag,
  TrendingUp,
  ArrowUpRight,
  Clock,
  MapPin,
  Plus,
  Trash2,
  Edit2,
  Phone,
  Mail,
  HelpCircle,
  FileText,
  X,
  RotateCcw,
  AlertCircle,
  Heart,
  Wallet,
  Coins,
} from "lucide-react";
import Link from "next/link";
import AffiliateCreatorTab from "@/components/profile/AffiliateCreatorTab";
import { useBookmarks } from "@/lib/bookmark-context";
import {
  COUNTRIES,
  INDIAN_STATES,
  isIndia,
  findCountry,
  validatePostalCode,
  validatePhoneNumber,
} from "@/lib/countries";

type DBAddress = {
  id: string;
  name: string;
  phone: string;
  email: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  countryCode?: string;
  isDefault: boolean;
};

export default function ProfilePage() {
  const { data: session, status, update: updateSession } = useSession();
  const router = useRouter();
  const { bookmarks } = useBookmarks();

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [customer, setCustomer] = useState<any>(null);
  const [addresses, setAddresses] = useState<DBAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"orders" | "returns" | "wishlist" | "addresses" | "info" | "affiliate">("orders");
  
  // Preferences settings
  const [storeCreditPreference, setStoreCreditPreference] = useState(false);
  const [showCoinsModal, setShowCoinsModal] = useState(false);
  const [emailOptedOut, setEmailOptedOut] = useState(false);
  const [whatsappOptedOut, setWhatsappOptedOut] = useState(false);
  const [smsOptedOut, setSmsOptedOut] = useState(false);
  const [updatingPrefs, setUpdatingPrefs] = useState<Record<string, boolean>>({});

  // Profile editing
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState("");
  const [updatingProfile, setUpdatingProfile] = useState(false);

  // Address editing/creation
  const [isAddressModalOpen, setIsAddressModalOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<Partial<DBAddress> | null>(null);
  const [savingAddress, setSavingAddress] = useState(false);
  const [addressModalError, setAddressModalError] = useState("");
  const [zipLoading, setZipLoading] = useState(false);

  useEffect(() => {
    const fetchZipDetails = async () => {
      if (!editingAddress || !editingAddress.zip) return;
      if (!isIndia(editingAddress.country, editingAddress.countryCode)) return;
      const cleanZip = editingAddress.zip.trim();
      if (/^\d{6}$/.test(cleanZip)) {
        setZipLoading(true);
        try {
          const res = await fetch(`https://api.postalpincode.in/pincode/${cleanZip}`);
          const data = await res.json();
          if (data && data[0] && data[0].Status === "Success" && data[0].PostOffice && data[0].PostOffice[0]) {
            const firstOffice = data[0].PostOffice[0];
            setEditingAddress(prev => prev ? ({
              ...prev,
              city: firstOffice.District || firstOffice.Block || firstOffice.Name || prev.city,
              state: firstOffice.State || prev.state,
            }) : null);
          }
        } catch (err) {
          console.error("Error fetching pincode details:", err);
        } finally {
          setZipLoading(false);
        }
      }
    };
    fetchZipDetails();
  }, [editingAddress?.zip, editingAddress?.country, editingAddress?.countryCode]);

  const [updatingRegion, setUpdatingRegion] = useState(false);
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login?callbackUrl=/profile");
    } else if (status === "authenticated") {
      fetchProfile();
      fetchAddresses();
    }
  }, [status, router]);

  const fetchProfile = async () => {
    try {
      const customerId = (session as any)?.customer?.id || (session?.user as any)?.id;
      if (!customerId) return;

      const [profRes, socialRes] = await Promise.all([
        fetch("/api/customer/profile"),
        fetch(`/api/customer/social-stats?customerId=${customerId}`)
      ]);
      const profData = await profRes.json();
      const socialData = await socialRes.json();
      
      if (profRes.ok) {
        setCustomer({
          ...profData.customer,
          followersCount: socialData.followersCount,
          followingCount: socialData.followingCount
        });
        setEditName(profData.customer.name || "");
        setStoreCreditPreference(profData.customer.storeCreditPreference ?? false);
        setEmailOptedOut(profData.customer.emailOptedOut ?? false);
        setWhatsappOptedOut(profData.customer.whatsappOptedOut ?? false);
        setSmsOptedOut(profData.customer.smsOptedOut ?? false);
      }
    } catch (e) {
      console.error("Error fetching profile", e);
    } finally {
      setLoading(false);
    }
  };

  const fetchAddresses = async () => {
    try {
      const res = await fetch("/api/customer/addresses");
      if (res.ok) {
        const data = await res.json();
        setAddresses(data.addresses || []);
      }
    } catch (e) {
      console.error("Error fetching addresses", e);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) return;
    setUpdatingProfile(true);
    try {
      const res = await fetch("/api/customer/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName }),
      });
      if (res.ok) {
        const data = await res.json();
        setCustomer((prev: any) => ({ ...prev, name: data.customer.name }));
        await updateSession({ ...session, user: { ...session?.user, name: data.customer.name } });
        setIsEditingProfile(false);
      }
    } catch (e) {
      console.error("Error updating profile name", e);
    } finally {
      setUpdatingProfile(false);
    }
  };

  const handleTogglePreference = async (key: string, value: boolean) => {
    // Optimistic UI updates
    if (key === "storeCreditPreference") setStoreCreditPreference(value);
    if (key === "emailOptedOut") setEmailOptedOut(value);
    if (key === "whatsappOptedOut") setWhatsappOptedOut(value);
    if (key === "smsOptedOut") setSmsOptedOut(value);

    setUpdatingPrefs(prev => ({ ...prev, [key]: true }));

    try {
      const res = await fetch("/api/customer/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) {
        throw new Error("Failed to save preference");
      }
      const data = await res.json();
      setCustomer((prev: any) => ({ ...prev, [key]: data.customer[key] }));
    } catch (e) {
      console.error("Error updating user settings", e);
      // Revert on error
      if (key === "storeCreditPreference") setStoreCreditPreference(!value);
      if (key === "emailOptedOut") setEmailOptedOut(!value);
      if (key === "whatsappOptedOut") setWhatsappOptedOut(!value);
      if (key === "smsOptedOut") setSmsOptedOut(!value);
    } finally {
      setUpdatingPrefs(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      const base64 = reader.result as string;
      try {
        const res = await fetch("/api/customer/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: base64 }),
        });
        if (res.ok) {
          setCustomer({ ...customer, image: base64 });
          await updateSession({ ...session, user: { ...session?.user, image: base64 } });
        }
      } finally {
        setUploading(false);
      }
    };
  };

  const handleSaveAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAddress) return;
    setAddressModalError("");

    const selectedCountry = editingAddress.country || "India";
    const selectedCountryCode = editingAddress.countryCode;

    // Validate phone number
    const phoneRes = validatePhoneNumber(editingAddress.phone || "", selectedCountry, selectedCountryCode);
    if (!phoneRes.valid) {
      setAddressModalError(phoneRes.error);
      return;
    }

    // Validate postal code
    if (!validatePostalCode(editingAddress.zip || "", selectedCountry, selectedCountryCode)) {
      setAddressModalError(
        isIndia(selectedCountry, selectedCountryCode)
          ? "Please enter a valid 6-digit PIN code."
          : "Please enter a valid postal / ZIP code."
      );
      return;
    }

    const updatedAddress = {
      ...editingAddress,
      phone: phoneRes.formattedPhone,
      country: selectedCountry,
    };

    setSavingAddress(true);

    try {
      const isEdit = !!editingAddress.id;
      const res = await fetch("/api/customer/addresses", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedAddress),
      });

      if (res.ok) {
        await fetchAddresses();
        setIsAddressModalOpen(false);
        setEditingAddress(null);
      } else {
        const errData = await res.json();
        setAddressModalError(errData.error || "Failed to save address");
      }
    } catch (e) {
      console.error("Error saving address", e);
      setAddressModalError("An unexpected error occurred.");
    } finally {
      setSavingAddress(false);
    }
  };

  const handleDeleteAddress = async (addressId: string) => {
    if (!confirm("Are you sure you want to delete this address?")) return;
    try {
      const res = await fetch(`/api/customer/addresses?id=${addressId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setAddresses(prev => prev.filter(a => a.id !== addressId));
      }
    } catch (e) {
      console.error("Error deleting address", e);
    }
  };

  const handleSetDefaultAddress = async (address: DBAddress) => {
    try {
      const res = await fetch("/api/customer/addresses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...address, isDefault: true }),
      });
      if (res.ok) {
        await fetchAddresses();
      }
    } catch (e) {
      console.error("Error setting default address", e);
    }
  };

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
          className="w-8 h-8 border-[1.5px] border-foreground/10 border-t-foreground/40 rounded-full"
        />
        <p className="text-[7px] font-semibold uppercase tracking-[0.5em] text-foreground/40 dark:text-foreground/20">Loading</p>
      </div>
    );
  }

  if (!session) return null;

  const totalOrders = customer?.orders?.length ?? 0;
  const fulfilledOrders = (customer?.orders ?? []).filter((o: any) => {
    const s = (o.fulfillmentStatus || "").toLowerCase().trim();
    return s === "fulfilled" || s === "shipped" || s === "delivered";
  });
  const totalSpent = fulfilledOrders.reduce((sum: number, o: any) => sum + (o.totalPrice || 0), 0);
  const storeCredits = customer?.storeCredits ?? 0;
  const name = customer?.name || session.user?.name || "Member";
  const email = session.user?.email || (session as any).customer?.phone || "";

  return (
    <div className="min-h-screen bg-background text-foreground relative font-sans">
      <main className="max-w-[430px] mx-auto px-4 pt-24 pb-36">

        {/* ─── Profile Hero Card ─── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 0.95, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative rounded-[2rem] overflow-hidden mb-5 p-6 glass-panel border-foreground/10 shadow-2xl bg-foreground/[0.01]"
        >
          {/* Ambient glow */}
          <div className="absolute inset-0 pointer-events-none opacity-20 dark:opacity-100" style={{ background: "radial-gradient(ellipse at 30% 0%, rgba(var(--foreground),0.03) 0%, transparent 70%)" }} />

          <div className="flex items-center justify-between gap-4 relative z-10">
            <div className="flex items-center gap-5 min-w-0">
              {/* Avatar */}
              <div className="relative shrink-0">
                <div className="w-20 h-20 rounded-[1.75rem] border border-foreground/10 overflow-hidden relative group/img bg-foreground/[0.02]">
                  {uploading && (
                    <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-20 backdrop-blur-sm">
                      <Loader2 className="w-5 h-5 text-foreground animate-spin" />
                    </div>
                  )}
                  {customer?.image || session.user?.image ? (
                    <img src={customer?.image || session.user?.image || ""} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <User className="w-8 h-8 text-foreground/30" />
                    </div>
                  )}
                  <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleImageUpload} />
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-white dark:bg-zinc-900 flex items-center justify-center border border-foreground/10 shadow-lg text-foreground hover:bg-foreground/5 active:scale-95 transition-all z-10"
                  aria-label="Change photo"
                >
                  <Edit2 className="w-3.5 h-3.5 text-foreground" />
                </button>
              </div>

              {/* Info */}
              <div className="min-w-0">
                <h1 className="text-[18px] font-bold tracking-tight text-foreground truncate leading-tight">{name}</h1>
                {email && (
                  <p className="text-[11px] text-foreground/40 font-medium truncate tracking-wide mt-1.5">{email}</p>
                )}
              </div>
            </div>

            {/* Edit Profile Button on far right */}
            <button 
              onClick={() => {
                setIsEditingProfile(!isEditingProfile);
                setEditName(customer?.name || "");
              }} 
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white dark:bg-zinc-900 border border-foreground/10 shadow-sm text-foreground/75 hover:text-foreground hover:bg-foreground/5 active:scale-95 transition-all shrink-0"
              aria-label="Edit Profile"
            >
              <Edit2 className="w-3.5 h-3.5 text-foreground" />
            </button>
          </div>

          {/* Edit Profile Form */}
          <AnimatePresence>
            {isEditingProfile && (
              <motion.form 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                onSubmit={handleUpdateProfile}
                className="mt-4 pt-4 border-t border-foreground/5 relative z-10 overflow-hidden"
              >
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Enter full name"
                    className="glass-input flex-1 px-3 py-2 text-[12px] bg-background"
                  />
                  <button
                    type="submit"
                    disabled={updatingProfile}
                    className="glass-button px-4 text-[9px] font-bold uppercase tracking-wider disabled:opacity-50"
                  >
                    {updatingProfile ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsEditingProfile(false)}
                    className="p-2 border border-foreground/10 rounded-xl hover:bg-foreground/5"
                  >
                    <X className="w-3.5 h-3.5 text-foreground/40" />
                  </button>
                </div>
              </motion.form>
            )}
          </AnimatePresence>

          {/* Stats Row */}
          <div className="grid grid-cols-3 mt-6 pt-5 border-t border-foreground/5 relative z-10">
            {[
              { label: "ORDERS", value: totalOrders, icon: ShoppingBag },
              { label: "WISHLIST", value: mounted ? bookmarks.length : 0, icon: Heart },
              { 
                label: "STORE COINS", 
                value: storeCredits > 0 ? `${storeCredits.toLocaleString("en-IN")} Coins` : "0 Coins", 
                icon: Coins,
                subtext: storeCredits > 0 ? `(₹${storeCredits.toLocaleString("en-IN")})` : undefined,
                onClick: () => setShowCoinsModal(true)
              },
            ].map(({ label, value, icon: Icon, subtext, onClick }, index) => (
              <div
                key={label}
                onClick={onClick}
                className={`flex flex-col items-center justify-center relative py-2 ${
                  onClick ? "cursor-pointer hover:opacity-80 transition-opacity" : ""
                } ${
                  index < 2 ? "after:content-[''] after:absolute after:right-0 after:top-1/4 after:h-1/2 after:w-[1px] after:bg-foreground/10" : ""
                }`}
              >
                <Icon className="w-5 h-5 text-foreground mb-1.5" strokeWidth={1.25} />
                <p className="text-[8px] font-bold text-foreground/40 tracking-wider mb-2">{label}</p>
                <p className="text-[14px] font-black text-foreground leading-none">{value}</p>
                {subtext && <p className="text-[8.5px] text-amber-500 font-medium mt-1">{subtext}</p>}
              </div>
            ))}
          </div>
        </motion.div>

        {/* ─── Tab Switcher ─── */}
        {/* ─── Tab Switcher ─── */}
        <div className="flex rounded-[1.5rem] mb-6 border border-foreground/5 bg-foreground/[0.01] relative p-1.5 overflow-hidden">
          {([
            { id: "orders", label: "Orders", icon: ShoppingBag },
            { id: "returns", label: "Returns", icon: RotateCcw },
            { id: "wishlist", label: "Wishlist", icon: Heart },
            { id: "addresses", label: "Addresses", icon: MapPin },
            { id: "info", label: "Account", icon: User },
            { id: "affiliate", label: "Creator", icon: Sparkles }
          ] as const).map((t) => {
            const isActive = tab === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex-1 flex flex-col items-center justify-center py-2 relative transition-colors duration-300"
              >
                <Icon className={`w-4 h-4 mb-1 transition-colors ${isActive ? "text-foreground" : "text-foreground/45"}`} strokeWidth={1.5} />
                <span className={`text-[9px] font-medium tracking-tight transition-colors ${isActive ? "text-foreground font-semibold" : "text-foreground/45"}`}>
                  {t.label}
                </span>
                {isActive && (
                  <motion.div
                    layoutId="activeTabUnderline"
                    className="absolute bottom-0 left-[20%] right-[20%] h-[2.5px] bg-foreground rounded-full"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* ─── Tab Content ─── */}
        <AnimatePresence mode="wait">
          {tab === "returns" && (
            <motion.div key="returns" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }} className="space-y-4">
              <div className="flex items-center justify-between mb-3 px-1">
                <span className="text-[8px] font-semibold uppercase tracking-[0.3em] text-foreground/40">Returns & Exchanges</span>
              </div>

              {((customer?.returnRequests && customer.returnRequests.length > 0) || 
                (customer?.exchangeRequests && customer.exchangeRequests.length > 0)) ? (
                <div className="space-y-3">
                  {/* Return Requests */}
                  {customer.returnRequests?.map((req: any, idx: number) => (
                    <Link key={req.id} href={`/orders/${req.orderId}`}>
                      <motion.div
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="p-4 rounded-[1.25rem] glass-panel border-foreground/5 hover:border-foreground/10 bg-foreground/[0.01] hover:bg-foreground/[0.03] transition-all group relative overflow-hidden"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="text-[10px] font-bold text-foreground/80">
                              Return for {req.order?.orderNumber || `#${req.orderId.slice(-6)}`}
                            </p>
                            <p className="text-[8px] text-foreground/35 mt-0.5">
                              Requested {new Date(req.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                            </p>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[7px] font-black uppercase tracking-wider ${
                            req.status === 'approved' || req.status === 'refunded'
                              ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                              : req.status === 'cancelled'
                                ? 'bg-foreground/5 text-foreground/40 border border-foreground/10'
                                : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                          }`}>
                            {req.status?.replace('_', ' ')}
                          </span>
                        </div>

                        {/* Items */}
                        <div className="space-y-2 mt-2 pt-2 border-t border-foreground/5">
                          {req.order?.items?.map((item: any, i: number) => (
                            <div key={i} className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-foreground/5 overflow-hidden shrink-0">
                                {item.image || item.product?.featuredImage ? (
                                  <img src={item.image || item.product?.featuredImage} className="w-full h-full object-cover" alt="" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-[8px] text-foreground/20">ZB</div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[9px] font-bold text-foreground/70 truncate uppercase">{item.title}</p>
                                <p className="text-[8px] text-foreground/35 font-mono">Qty: {item.quantity} · Size: {item.size || 'Free'}</p>
                              </div>
                            </div>
                          ))}
                        </div>

                        {req.reason && (
                          <div className="mt-3 text-[9px] text-foreground/45 italic bg-foreground/[0.02] p-2 rounded-lg border border-foreground/5">
                            Reason: {req.reason}
                          </div>
                        )}
                      </motion.div>
                    </Link>
                  ))}

                  {/* Exchange Requests */}
                  {customer.exchangeRequests?.map((req: any, idx: number) => (
                    <Link key={req.id} href={`/orders/${req.orderId}`}>
                      <motion.div
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="p-4 rounded-[1.25rem] glass-panel border-foreground/5 hover:border-foreground/10 bg-foreground/[0.01] hover:bg-foreground/[0.03] transition-all group relative overflow-hidden"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="text-[10px] font-bold text-foreground/80">
                              Exchange for {req.order?.orderNumber || `#${req.orderId.slice(-6)}`}
                            </p>
                            <p className="text-[8px] text-foreground/35 mt-0.5">
                              Requested {new Date(req.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                            </p>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[7px] font-black uppercase tracking-wider ${
                            req.status === 'approved' || req.status === 'completed' || req.status === 'new_order_created'
                              ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                              : req.status === 'cancelled'
                                ? 'bg-foreground/5 text-foreground/40 border border-foreground/10'
                                : 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                          }`}>
                            {req.status?.replace('_', ' ')}
                          </span>
                        </div>

                        {/* Items */}
                        <div className="space-y-2 mt-2 pt-2 border-t border-foreground/5">
                          {req.order?.items?.map((item: any, i: number) => (
                            <div key={i} className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-foreground/5 overflow-hidden shrink-0">
                                {item.image || item.product?.featuredImage ? (
                                  <img src={item.image || item.product?.featuredImage} className="w-full h-full object-cover" alt="" />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-[8px] text-foreground/20">ZB</div>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[9px] font-bold text-foreground/70 truncate uppercase">{item.title}</p>
                                <p className="text-[8px] text-foreground/35 font-mono">Qty: {item.quantity} · Size: {item.size || 'Free'}</p>
                              </div>
                            </div>
                          ))}
                        </div>

                        {req.reason && (
                          <div className="mt-3 text-[9px] text-foreground/45 italic bg-foreground/[0.02] p-2 rounded-lg border border-foreground/5">
                            Reason: {req.reason}
                          </div>
                        )}
                      </motion.div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="py-16 text-center rounded-[1.5rem] border border-dashed border-foreground/10 bg-foreground/[0.01]">
                  <RotateCcw className="w-8 h-8 text-foreground/20 mx-auto mb-3" />
                  <p className="text-[8px] font-semibold uppercase tracking-widest text-foreground/20">No return or exchange orders</p>
                </div>
              )}
            </motion.div>
          )}

          {tab === "orders" && (
            <motion.div key="orders" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }}>
              <div className="flex items-center justify-between mb-3.5 px-1">
                <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-foreground/45">Order History</span>
                <Link href="/orders" className="flex items-center gap-1 text-[9px] font-bold text-foreground/75 hover:text-foreground transition-colors">
                  All Orders <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              {customer?.orders && customer.orders.length > 0 ? (
                <div className="rounded-[1.5rem] border border-foreground/5 bg-foreground/[0.01] overflow-hidden divide-y divide-foreground/5 shadow-sm">
                  {customer.orders.slice(0, 5).map((order: any, idx: number) => (
                    <Link key={order.id} href={`/orders/${order.id}`} className="block">
                      <motion.div
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="flex items-center justify-between p-4 hover:bg-foreground/[0.02] transition-all group"
                      >
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          <div className="w-12 h-12 rounded-[0.75rem] bg-foreground/[0.02] border border-foreground/5 flex items-center justify-center shrink-0 overflow-hidden">
                            {order.items?.[0]?.image || order.items?.[0]?.product?.featuredImage || (order.items?.[0]?.product?.images?.[0] as any)?.src ? (
                              <img src={order.items[0].image || order.items[0].product?.featuredImage || (order.items[0].product?.images?.[0] as any)?.src} className="w-full h-full object-cover" alt="" />
                            ) : (
                              <Package className="w-5 h-5 text-foreground/10" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="text-[11px] font-bold text-foreground/80 truncate">
                              {order.orderNumber 
                                ? (order.orderNumber.startsWith('#') ? order.orderNumber : `#${order.orderNumber}`)
                                : (order.shopifyOrderId && !order.shopifyOrderId.startsWith('app_pending_') 
                                    ? (order.shopifyOrderId.startsWith('#') ? order.shopifyOrderId : `#${order.shopifyOrderId}`)
                                    : `#ZB${order.id.slice(-6).toUpperCase()}`)}
                            </p>
                            <p className="flex items-center gap-1 text-[9px] text-foreground/40 mt-1">
                              <Clock className="w-3 h-3 text-foreground/30" />
                              {new Date(order.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 ml-4">
                          <p className="text-[12px] font-bold text-foreground/85">₹{order.totalPrice.toLocaleString("en-IN")}</p>
                          <ChevronRight className="w-3.5 h-3.5 text-foreground/25 group-hover:text-foreground/60 transition-colors" />
                        </div>
                      </motion.div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="py-16 text-center rounded-[1.5rem] border border-dashed border-foreground/10 bg-foreground/[0.01]">
                  <Package className="w-8 h-8 text-foreground/20 mx-auto mb-3" />
                  <p className="text-[8px] font-semibold uppercase tracking-widest text-foreground/20">No orders yet</p>
                </div>
              )}
            </motion.div>
          )}

          {tab === "wishlist" && (
            <motion.div key="wishlist" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }}>
              <div className="flex items-center justify-between mb-3 px-1">
                <span className="text-[8px] font-semibold uppercase tracking-[0.3em] text-foreground/40">Saved Items</span>
                <Link href="/wishlist" className="flex items-center gap-1 text-[8px] font-bold text-foreground/60 hover:text-foreground/80 transition-colors">
                  All <ArrowUpRight className="w-3 h-3" />
                </Link>
              </div>

              {mounted && bookmarks.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {bookmarks.slice(0, 6).map((item) => (
                    <Link key={item.id} href={`/products/${item.handle}`}>
                      <div className="aspect-[4/5] rounded-[1.25rem] overflow-hidden relative group border border-foreground/5 hover:border-foreground/10 bg-foreground/[0.01]">
                        <img
                          src={item.image?.src || item.images?.[0]?.src || (item as any).featuredImage || "/zb-logo-220px.png"}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                          alt={item.title}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
                        <div className="absolute bottom-3 left-3 right-3">
                          <p className="text-[8px] font-bold uppercase tracking-tight text-white/80 truncate">{item.title}</p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="py-16 text-center rounded-[1.5rem] border border-dashed border-foreground/10 bg-foreground/[0.01]">
                  <Bookmark className="w-8 h-8 text-foreground/20 mx-auto mb-3" />
                  <p className="text-[8px] font-semibold uppercase tracking-widest text-foreground/20">Nothing saved yet</p>
                </div>
              )}
            </motion.div>
          )}

          {tab === "addresses" && (
            <motion.div key="addresses" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }} className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-[8px] font-semibold uppercase tracking-[0.3em] text-foreground/40">Saved Addresses</span>
                <button
                  onClick={() => {
                    setAddressModalError("");
                    setEditingAddress({
                      name: customer?.name || "",
                      phone: customer?.phone || "",
                      email: customer?.email || "",
                      address1: "",
                      address2: "",
                      city: "",
                      state: "",
                      zip: "",
                      country: "India",
                      isDefault: addresses.length === 0,
                    });
                    setIsAddressModalOpen(true);
                  }}
                  className="flex items-center gap-1 text-[8px] font-bold text-foreground/60 hover:text-foreground/80 transition-colors"
                >
                  <Plus className="w-3 h-3" /> Add New
                </button>
              </div>

              {addresses.length > 0 ? (
                <div className="space-y-2">
                  {addresses.map((addr) => (
                    <div
                      key={addr.id}
                      className={`p-4 rounded-[1.5rem] glass-panel border transition-all ${
                        addr.isDefault 
                          ? "border-foreground/20 bg-foreground/[0.02]" 
                          : "border-foreground/5 hover:border-foreground/10 bg-foreground/[0.01]"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-foreground">{addr.name}</span>
                            {addr.isDefault && (
                              <span className="px-1.5 py-0.5 rounded-full text-[6px] font-bold uppercase tracking-wider bg-foreground text-background">
                                Default
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-foreground/60 mt-1 font-medium leading-relaxed">
                            {addr.address1}
                            {addr.address2 ? `, ${addr.address2}` : ""}
                            <br />
                            {addr.city}, {addr.state} - {addr.zip}
                            <br />
                            {addr.country}
                          </p>
                          <div className="flex items-center gap-3 mt-2 text-[9px] text-foreground/45 font-medium">
                            <span className="flex items-center gap-1"><Phone className="w-2.5 h-2.5" /> {addr.phone}</span>
                            {addr.email && <span className="flex items-center gap-1"><Mail className="w-2.5 h-2.5" /> {addr.email}</span>}
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex flex-col items-end gap-2 shrink-0">
                          <button
                            onClick={() => {
                              setAddressModalError("");
                              setEditingAddress(addr);
                              setIsAddressModalOpen(true);
                            }}
                            className="p-1.5 text-foreground/40 hover:text-foreground/75 transition-colors"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          {!addr.isDefault && (
                            <button
                              onClick={() => handleSetDefaultAddress(addr)}
                              className="text-[7px] font-bold uppercase tracking-widest text-foreground/35 hover:text-foreground/75 transition-colors"
                            >
                              Set Default
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteAddress(addr.id)}
                            className="p-1.5 text-foreground/20 hover:text-red-500/70 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center rounded-[1.5rem] border border-dashed border-foreground/10 bg-foreground/[0.01]">
                  <MapPin className="w-8 h-8 text-foreground/20 mx-auto mb-3" />
                  <p className="text-[8px] font-semibold uppercase tracking-widest text-foreground/20">No saved addresses</p>
                </div>
              )}
            </motion.div>
          )}

          {tab === "info" && (
            <motion.div key="info" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.3 }} className="space-y-3">

              {/* Support & Policies Links */}
              <div className="rounded-[1.5rem] overflow-hidden glass-panel border-foreground/5 bg-foreground/[0.01]">
                <div className="px-4 py-3 border-b border-foreground/5 bg-foreground/[0.02]">
                  <p className="text-[8px] font-semibold uppercase tracking-[0.3em] text-foreground/40">Quick Services</p>
                </div>
                <div className="divide-y divide-foreground/5">
                  <Link href="/orders" className="flex items-center justify-between px-4 py-3 hover:bg-foreground/[0.02] group transition-all">
                    <div className="flex items-center gap-3">
                      <ShoppingBag className="w-3.5 h-3.5 text-foreground/50" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-foreground/70">Order History & Returns</span>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-foreground/30 group-hover:text-foreground/70 group-hover:translate-x-0.5 transition-all" />
                  </Link>
                  <Link href="/policies/shipping-policy" className="flex items-center justify-between px-4 py-3 hover:bg-foreground/[0.02] group transition-all">
                    <div className="flex items-center gap-3">
                      <FileText className="w-3.5 h-3.5 text-foreground/50" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-foreground/70">Returns & Exchanges Policy</span>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-foreground/30 group-hover:text-foreground/70 group-hover:translate-x-0.5 transition-all" />
                  </Link>
                  <Link href="/policies/privacy-policy" className="flex items-center justify-between px-4 py-3 hover:bg-foreground/[0.02] group transition-all">
                    <div className="flex items-center gap-3">
                      <Shield className="w-3.5 h-3.5 text-foreground/50" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-foreground/70">Privacy & Terms</span>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-foreground/30 group-hover:text-foreground/70 group-hover:translate-x-0.5 transition-all" />
                  </Link>
                </div>
              </div>

              {/* Account Preferences Settings */}
              <div className="rounded-[1.5rem] overflow-hidden glass-panel border-foreground/5 bg-foreground/[0.01]">
                <div className="px-4 py-3 border-b border-foreground/5 bg-foreground/[0.02]">
                  <p className="text-[8px] font-semibold uppercase tracking-[0.3em] text-foreground/40">Preferences & Settings</p>
                </div>
                <div className="p-4 space-y-4">
                  {/* Store Credit Preference */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/80">Refund to Store Coins</p>
                        <span className="text-[8px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 font-semibold">1 Coin = ₹1</span>
                      </div>
                      <p className="text-[8.5px] text-foreground/45 mt-0.5 leading-relaxed">
                        Opt in to receive instant store coins for returned items instead of waiting for bank refund. Store Coins can be redeemed exclusively in the Zica Bella mobile app.
                      </p>
                    </div>
                    <button
                      onClick={() => handleTogglePreference("storeCreditPreference", !storeCreditPreference)}
                      disabled={updatingPrefs["storeCreditPreference"]}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        storeCreditPreference ? "bg-foreground" : "bg-foreground/10"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow ring-0 transition duration-200 ease-in-out ${
                          storeCreditPreference ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="h-[1px] bg-foreground/5" />

                  {/* Email Preference */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/80">Email Marketing Alerts</p>
                      <p className="text-[8.5px] text-foreground/45 mt-0.5 leading-relaxed">
                        Subscribe to newsletters, new product releases, catalog updates, and exclusive events.
                      </p>
                    </div>
                    <button
                      onClick={() => handleTogglePreference("emailOptedOut", !emailOptedOut)}
                      disabled={updatingPrefs["emailOptedOut"]}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        !emailOptedOut ? "bg-foreground" : "bg-foreground/10"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow ring-0 transition duration-200 ease-in-out ${
                          !emailOptedOut ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="h-[1px] bg-foreground/5" />

                  {/* WhatsApp Preference */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/80">WhatsApp Notifications</p>
                      <p className="text-[8.5px] text-foreground/45 mt-0.5 leading-relaxed">
                        Receive instant shipment tracking details, delivery statuses, and updates on WhatsApp.
                      </p>
                    </div>
                    <button
                      onClick={() => handleTogglePreference("whatsappOptedOut", !whatsappOptedOut)}
                      disabled={updatingPrefs["whatsappOptedOut"]}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        !whatsappOptedOut ? "bg-foreground" : "bg-foreground/10"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow ring-0 transition duration-200 ease-in-out ${
                          !whatsappOptedOut ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="h-[1px] bg-foreground/5" />

                  {/* SMS Preference */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/80">SMS Alerts</p>
                      <p className="text-[8.5px] text-foreground/45 mt-0.5 leading-relaxed">
                        Get standard SMS notifications regarding your orders and delivery alerts.
                      </p>
                    </div>
                    <button
                      onClick={() => handleTogglePreference("smsOptedOut", !smsOptedOut)}
                      disabled={updatingPrefs["smsOptedOut"]}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        !smsOptedOut ? "bg-foreground" : "bg-foreground/10"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow ring-0 transition duration-200 ease-in-out ${
                          !smsOptedOut ? "translate-x-4" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              {/* The Collective */}
              <Link href="/community" className="block">
                <div
                  className="flex items-center justify-between p-4 rounded-[1.5rem] group transition-all glass-panel border-foreground/5 hover:border-foreground/10 bg-foreground/[0.01] hover:bg-foreground/[0.03]"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-[0.75rem] bg-foreground/5 flex items-center justify-center border border-foreground/10">
                      <Shield className="w-4 h-4 text-foreground" />
                    </div>
                    <div>
                      <p className="text-[11px] font-bold text-foreground uppercase tracking-wide">The Collective</p>
                      <p className="text-[8px] text-foreground/40 uppercase tracking-tight font-medium mt-0.5">Verified Member Access</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-foreground/45 group-hover:text-foreground/70 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </Link>

              {/* Sign Out */}
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="w-full py-4 rounded-[1.5rem] text-[9px] font-bold uppercase tracking-[0.3em] text-foreground/40 hover:text-foreground/85 bg-foreground/[0.01] hover:bg-red-950/10 border border-foreground/5 hover:border-red-900/20 transition-all active:scale-[0.98]"
              >
                Sign Out
              </button>
            </motion.div>
          )}

          {tab === "affiliate" && (
            <motion.div
              key="affiliate"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
            >
              <AffiliateCreatorTab customer={customer} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* ─── Address Form Modal ─── */}
      <AnimatePresence>
        {isAddressModalOpen && editingAddress && (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-background/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-[400px] rounded-[2rem] glass-panel border-foreground/10 shadow-2xl p-6 bg-background overflow-hidden relative"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[12px] font-bold uppercase tracking-wider text-foreground">
                  {editingAddress.id ? "Edit Address" : "Add Address"}
                </h3>
                <button
                  onClick={() => {
                    setIsAddressModalOpen(false);
                    setEditingAddress(null);
                  }}
                  className="p-1 hover:bg-foreground/5 rounded-full transition-colors"
                >
                  <X className="w-4 h-4 text-foreground/40" />
                </button>
              </div>

              <form onSubmit={handleSaveAddress} className="space-y-3">
                <input
                  type="text"
                  placeholder="Recipient Name"
                  required
                  value={editingAddress.name || ""}
                  onChange={(e) => setEditingAddress({ ...editingAddress, name: e.target.value })}
                  className="glass-input w-full px-3 py-2 text-[12px]"
                />
                <div className="grid grid-cols-2 gap-2">
                  {isIndia(editingAddress.country, editingAddress.countryCode) ? (
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-foreground/35 font-semibold pointer-events-none">+91</span>
                      <input
                        type="tel"
                        placeholder="10-digit Phone"
                        required
                        value={editingAddress.phone?.startsWith("+91") ? editingAddress.phone.slice(3) : (editingAddress.phone || "")}
                        onChange={(e) => setEditingAddress({ ...editingAddress, phone: e.target.value })}
                        className="glass-input w-full pl-9 pr-3 py-2 text-[12px]"
                      />
                    </div>
                  ) : (
                    <input
                      type="tel"
                      placeholder="Phone Number"
                      required
                      value={editingAddress.phone || ""}
                      onChange={(e) => setEditingAddress({ ...editingAddress, phone: e.target.value })}
                      className="glass-input w-full px-3 py-2 text-[12px]"
                    />
                  )}
                  <input
                    type="email"
                    placeholder="Email"
                    value={editingAddress.email || ""}
                    onChange={(e) => setEditingAddress({ ...editingAddress, email: e.target.value })}
                    className="glass-input w-full px-3 py-2 text-[12px]"
                  />
                </div>
                <input
                  type="text"
                  placeholder="Address Line 1"
                  required
                  value={editingAddress.address1 || ""}
                  onChange={(e) => setEditingAddress({ ...editingAddress, address1: e.target.value })}
                  className="glass-input w-full px-3 py-2 text-[12px]"
                />
                <input
                  type="text"
                  placeholder="Address Line 2 (Optional)"
                  value={editingAddress.address2 || ""}
                  onChange={(e) => setEditingAddress({ ...editingAddress, address2: e.target.value })}
                  className="glass-input w-full px-3 py-2 text-[12px]"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="City"
                    required
                    value={editingAddress.city || ""}
                    onChange={(e) => setEditingAddress({ ...editingAddress, city: e.target.value })}
                    className="glass-input w-full px-3 py-2 text-[12px]"
                  />
                  {isIndia(editingAddress.country, editingAddress.countryCode) ? (
                    <select
                      required
                      value={editingAddress.state || ""}
                      onChange={(e) => setEditingAddress({ ...editingAddress, state: e.target.value })}
                      className="glass-input w-full px-3 py-2 text-[12px] bg-background text-foreground"
                    >
                      <option value="" disabled>Select State</option>
                      {INDIAN_STATES.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      placeholder="State / Province / Region"
                      required
                      value={editingAddress.state || ""}
                      onChange={(e) => setEditingAddress({ ...editingAddress, state: e.target.value })}
                      className="glass-input w-full px-3 py-2 text-[12px]"
                    />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="relative">
                    <input
                      type="text"
                      placeholder={isIndia(editingAddress.country, editingAddress.countryCode) ? "PIN Code (6 digits)" : "Postal / ZIP Code"}
                      required
                      maxLength={isIndia(editingAddress.country, editingAddress.countryCode) ? 6 : 12}
                      value={editingAddress.zip || ""}
                      onChange={(e) => {
                        const val = isIndia(editingAddress.country, editingAddress.countryCode)
                          ? e.target.value.replace(/\D/g, '').slice(0, 6)
                          : e.target.value;
                        setEditingAddress({ ...editingAddress, zip: val });
                      }}
                      className="glass-input w-full px-3 py-2 text-[12px]"
                    />
                    {zipLoading && (
                      <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 animate-spin text-foreground/30" />
                    )}
                  </div>
                  <select
                    required
                    value={editingAddress.country || "India"}
                    onChange={(e) => {
                      const cName = e.target.value;
                      const matched = findCountry(cName);
                      setEditingAddress({ ...editingAddress, country: matched.name, countryCode: matched.code });
                    }}
                    className="glass-input w-full px-3 py-2 text-[12px] bg-background text-foreground"
                  >
                    {COUNTRIES.map(c => (
                      <option key={c.code} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <label className="flex items-center gap-2 py-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingAddress.isDefault || false}
                    onChange={(e) => setEditingAddress({ ...editingAddress, isDefault: e.target.checked })}
                    className="rounded border-foreground/10 bg-background accent-foreground w-3.5 h-3.5"
                  />
                  <span className="text-[10px] font-medium text-foreground/60 select-none">Set as default shipping address</span>
                </label>

                {addressModalError && (
                  <div className="flex items-center gap-2 p-3.5 rounded-xl text-[10px] font-bold mt-1" style={{ background: "rgba(255,80,80,0.06)", border: "1px solid rgba(255,80,80,0.12)", color: "rgba(255,100,100,0.9)" }}>
                    <AlertCircle className="w-3.5 h-3.5" />
                    {addressModalError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={savingAddress}
                  className="glass-cta w-full py-3 mt-2 text-[10px] flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {savingAddress ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save Address"}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Store Coins Info & Redemption Modal */}
      <AnimatePresence>
        {showCoinsModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md"
            onClick={() => setShowCoinsModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm apple-glass-capsule p-6 rounded-3xl border border-border/40 shadow-2xl relative flex flex-col items-center text-center gap-4 bg-background/95"
            >
              <div className="w-12 h-12 rounded-2xl bg-amber-500/15 flex items-center justify-center text-amber-500">
                <Coins className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Store Coins Wallet</h3>
                <p className="text-xs text-amber-500 font-semibold mt-1">
                  Balance: {storeCredits.toLocaleString("en-IN")} Coins (₹{storeCredits.toLocaleString("en-IN")})
                </p>
                <p className="text-xs text-foreground/70 mt-2 leading-relaxed">
                  Store Coins are redeemable exclusively on the Zica Bella mobile app (1 Coin = ₹1). Open or download the app to redeem your coins towards any order!
                </p>
              </div>
              <div className="flex flex-col w-full gap-2 pt-2">
                <a
                  href="/app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-black font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
                >
                  <span>Download / Open App</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </a>
                <button
                  type="button"
                  onClick={() => setShowCoinsModal(false)}
                  className="w-full py-2.5 px-4 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground font-medium text-xs transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
