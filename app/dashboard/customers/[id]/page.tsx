"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Loader2,
  Mail,
  Phone,
  Calendar,
  User,
  ShoppingBag,
  Heart,
  MapPin,
  Save,
  DollarSign,
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "sonner";

interface Address {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
  isDefault: boolean;
}

interface Product {
  id: string;
  title: string;
  handle: string | null;
  price: number | null;
  featuredImage: string | null;
}

interface WishlistItem {
  id: string;
  product: Product;
}

interface OrderItem {
  id: string;
  title: string;
  quantity: number;
  price: number;
  sku: string | null;
  image: string | null;
}

interface Order {
  id: string;
  shopifyOrderId: string;
  status: string;
  totalPrice: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  createdAt: string;
  items: OrderItem[];
}

interface CustomerDetails {
  id: string;
  shopifyId: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  storeCredits: number;
  createdAt: string;
  lastLoginAt: string | null;
  ordersCount: number;
  totalSpent: number;
  /** From real orders: placed, not cancelled / refunded (server, lib/services/customerStats.ts). */
  placedOrders?: number;
  lifetimeRevenue?: number;
  addresses: Address[];
  wishlist: WishlistItem[];
  orders: Order[];
}

export default function CustomerDetailsPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [customer, setCustomer] = useState<CustomerDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Edit fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const fetchCustomerDetails = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/customers/${params.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load customer details");
      
      setCustomer(data.customer);
      setName(data.customer.name || "");
      setEmail(data.customer.email || "");
      setPhone(data.customer.phone || "");
    } catch (err: any) {
      toast.error(err.message || "Failed to load customer details");
      router.push("/dashboard/customers");
    } finally {
      setLoading(false);
    }
  }, [params.id, router]);

  useEffect(() => {
    fetchCustomerDetails();
  }, [fetchCustomerDetails]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/customers/${params.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, phone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save customer");
      toast.success("Customer profile updated successfully");
      fetchCustomerDetails();
    } catch (err: any) {
      toast.error(err.message || "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const safeCurrency = (val: any) => {
    const num = typeof val === "number" ? val : parseFloat(val);
    if (isNaN(num)) return "₹0";
    return `₹${num.toLocaleString("en-IN")}`;
  };

  if (loading && !customer) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="w-4 h-4 text-foreground/40 animate-spin" />
        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-foreground/40">Loading Customer Details...</span>
      </div>
    );
  }

  if (!customer) return null;

  const isFulfilled = (status?: string | null) => {
    if (!status) return false;
    const s = status.toLowerCase().trim();
    return s === "fulfilled" || s === "shipped" || s === "delivered";
  };

  const fulfilledOrders = (customer.orders || []).filter((o) => isFulfilled(o.fulfillmentStatus));
  const totalSpent = customer.lifetimeRevenue ?? fulfilledOrders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
  const totalOrders = customer.placedOrders ?? (customer.ordersCount || customer.orders.length);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="pb-20 space-y-8 relative z-10"
    >
      {/* Navigation Header */}
      <div className="flex items-center justify-between border-b border-foreground/[0.05] pb-5">
        <button
          onClick={() => router.push("/dashboard/customers")}
          className="flex items-center gap-2 px-3 py-1.5 bg-foreground/5 rounded-md text-[10px] font-medium text-foreground/60 uppercase tracking-[0.15em] hover:bg-foreground/10 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Customers
        </button>
        <div className="text-right">
          <p className="text-[10px] text-foreground/40 font-semibold uppercase tracking-widest">ID</p>
          <p className="text-[11px] font-mono text-foreground/70">{customer.id}</p>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-background border border-foreground/[0.05] rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-foreground/[0.03] text-foreground/60">
              <DollarSign className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[9px] text-foreground/40 font-semibold uppercase tracking-widest">Total Spent</p>
              <p className="text-[16px] font-bold text-foreground mt-0.5">{safeCurrency(totalSpent)}</p>
            </div>
          </div>
        </div>

        <div className="bg-background border border-foreground/[0.05] rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-foreground/[0.03] text-foreground/60">
              <ShoppingBag className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[9px] text-foreground/40 font-semibold uppercase tracking-widest">Total Orders</p>
              <p className="text-[16px] font-bold text-foreground mt-0.5">{totalOrders}</p>
            </div>
          </div>
        </div>

        <div className="bg-background border border-foreground/[0.05] rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-foreground/[0.03] text-foreground/60">
              <DollarSign className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[9px] text-foreground/40 font-semibold uppercase tracking-widest">Store Credits</p>
              <p className="text-[16px] font-bold text-foreground mt-0.5">{safeCurrency(customer.storeCredits)}</p>
            </div>
          </div>
        </div>

        <div className="bg-background border border-foreground/[0.05] rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-foreground/[0.03] text-foreground/60">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[9px] text-foreground/40 font-semibold uppercase tracking-widest">Last Login</p>
              <p className="text-[12px] font-semibold text-foreground mt-1">
                {customer.lastLoginAt ? new Date(customer.lastLoginAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never"}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Profile Edit Card */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-background border border-foreground/[0.05] rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2 border-b border-foreground/[0.05] pb-3">
              <User className="w-4 h-4 text-foreground/60" />
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-foreground/70">Edit Customer Profile</h3>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] text-foreground/40 font-semibold uppercase tracking-widest">Full Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter full name"
                  className="w-full bg-background border border-foreground/[0.05] rounded-md px-3 py-1.5 text-[11px] text-foreground focus:outline-none focus:border-foreground/20 transition-colors"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[9px] text-foreground/40 font-semibold uppercase tracking-widest">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/30" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter email address"
                    className="w-full bg-background border border-foreground/[0.05] rounded-md pl-8 pr-3 py-1.5 text-[11px] text-foreground focus:outline-none focus:border-foreground/20 transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[9px] text-foreground/40 font-semibold uppercase tracking-widest">Phone Number</label>
                <div className="relative">
                  <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/30" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Enter phone number"
                    className="w-full bg-background border border-foreground/[0.05] rounded-md pl-8 pr-3 py-1.5 text-[11px] text-foreground focus:outline-none focus:border-foreground/20 transition-colors"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-foreground text-background rounded-md text-[10px] font-medium uppercase tracking-[0.15em] hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {saving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                Save Changes
              </button>
            </form>
          </div>
        </div>

        {/* Addresses, Wishlist, Orders */}
        <div className="lg:col-span-2 space-y-8">
          {/* Addresses Section */}
          <div className="bg-background border border-foreground/[0.05] rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2 border-b border-foreground/[0.05] pb-3">
              <MapPin className="w-4 h-4 text-foreground/60" />
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-foreground/70">Saved Addresses</h3>
            </div>

            {customer.addresses.length === 0 ? (
              <p className="text-[10px] text-foreground/40 uppercase tracking-widest py-4 text-center">No saved addresses found</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {customer.addresses.map((addr) => (
                  <div key={addr.id} className="relative border border-foreground/[0.05] rounded-lg p-4 bg-foreground/[0.005]">
                    {addr.isDefault && (
                      <span className="absolute top-3 right-3 bg-foreground text-background px-1.5 py-0.5 rounded-[3px] text-[8px] font-bold uppercase tracking-widest">
                        Default
                      </span>
                    )}
                    <p className="text-[11px] font-bold text-foreground">{addr.name}</p>
                    <p className="text-[10px] text-foreground/60 mt-1 leading-relaxed">
                      {addr.address1}
                      {addr.address2 ? `, ${addr.address2}` : ""}
                      <br />
                      {addr.city}, {addr.state} - {addr.zip}
                      <br />
                      {addr.country}
                    </p>
                    {addr.phone && (
                      <p className="text-[9px] text-foreground/40 mt-2 font-medium">Phone: {addr.phone}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Wishlisted Products Section */}
          <div className="bg-background border border-foreground/[0.05] rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2 border-b border-foreground/[0.05] pb-3">
              <Heart className="w-4 h-4 text-foreground/60" />
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-foreground/70">Wishlisted Products</h3>
            </div>

            {customer.wishlist.length === 0 ? (
              <p className="text-[10px] text-foreground/40 uppercase tracking-widest py-4 text-center">No wishlisted products found</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {customer.wishlist.map((item) => (
                  <div key={item.id} className="border border-foreground/[0.05] rounded-lg overflow-hidden bg-foreground/[0.005] hover:border-foreground/10 transition-colors">
                    {item.product.featuredImage ? (
                      <img
                        src={item.product.featuredImage}
                        alt={item.product.title}
                        className="w-full h-28 object-cover border-b border-foreground/[0.03]"
                      />
                    ) : (
                      <div className="w-full h-28 bg-foreground/[0.02] flex items-center justify-center text-[10px] text-foreground/30 font-semibold uppercase tracking-wider">
                        No Image
                      </div>
                    )}
                    <div className="p-3">
                      <p className="text-[10px] font-semibold text-foreground truncate">{item.product.title}</p>
                      {item.product.price && (
                        <p className="text-[10px] font-bold text-foreground/65 mt-0.5">{safeCurrency(item.product.price)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Order History Section */}
          <div className="bg-background border border-foreground/[0.05] rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2 border-b border-foreground/[0.05] pb-3">
              <ShoppingBag className="w-4 h-4 text-foreground/60" />
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-foreground/70">Order History</h3>
            </div>

            {customer.orders.length === 0 ? (
              <p className="text-[10px] text-foreground/40 uppercase tracking-widest py-4 text-center">No orders found</p>
            ) : (
              <div className="space-y-4">
                {customer.orders.map((order) => (
                  <div key={order.id} className="border border-foreground/[0.05] rounded-lg overflow-hidden bg-background">
                    {/* Order Summary Header */}
                    <div className="flex items-center justify-between gap-4 p-4 border-b border-foreground/[0.03] bg-foreground/[0.005]">
                      <div className="flex items-center gap-3">
                        <span className="text-[11px] font-bold text-foreground">
                          #{order.shopifyOrderId}
                        </span>
                        <span className={`px-2 py-0.5 rounded-[3px] text-[8px] font-bold uppercase tracking-widest ${
                          order.fulfillmentStatus === 'fulfilled'
                            ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                            : 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
                        }`}>
                          {order.fulfillmentStatus || 'unfulfilled'}
                        </span>
                      </div>
                      <div className="flex items-center gap-6">
                        <span className="text-[10px] text-foreground/50">
                          {new Date(order.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                        <span className={`text-[8px] font-bold px-2 py-0.5 rounded-[3px] uppercase tracking-widest ${
                          order.paymentStatus === 'paid'
                            ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                            : 'bg-red-500/10 text-red-600 dark:text-red-400'
                        }`}>
                          {order.paymentStatus}
                        </span>
                        <span className="text-[11px] font-bold text-foreground">
                          {safeCurrency(order.totalPrice)}
                        </span>
                      </div>
                    </div>

                    {/* Order Line Items */}
                    <div className="divide-y divide-foreground/[0.03]">
                      {order.items.map((item) => (
                        <div key={item.id} className="flex items-center justify-between gap-4 p-4">
                          <div className="flex items-center gap-3">
                            {item.image ? (
                              <img
                                src={item.image}
                                alt={item.title}
                                className="w-10 h-10 object-cover rounded-md border border-foreground/[0.03]"
                              />
                            ) : (
                              <div className="w-10 h-10 bg-foreground/[0.02] flex items-center justify-center text-[8px] text-foreground/30 font-semibold uppercase tracking-wider rounded-md">
                                N/A
                              </div>
                            )}
                            <div>
                              <p className="text-[10px] font-semibold text-foreground max-w-md truncate">{item.title}</p>
                              {item.sku && (
                                <p className="text-[8px] font-mono text-foreground/40 mt-0.5">SKU: {item.sku}</p>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] font-semibold text-foreground">
                              {safeCurrency(item.price)} × {item.quantity}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
