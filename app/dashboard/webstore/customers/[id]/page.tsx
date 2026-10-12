"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  Calendar,
  MapPin,
  ShoppingBag,
  CreditCard,
  ChevronRight,
  Clock,
  CheckCircle,
  AlertCircle,
  Truck,
  Sparkles
} from "lucide-react";
import { toast } from "sonner";

interface Address {
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  addresses: Address[];
  defaultAddressIndex: number;
  createdAt: string;
}

interface Order {
  id: string;
  orderNumber: string;
  totalAmount: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  paymentMethod: string;
  createdAt: string;
}

export default function WebStoreCustomerDetail() {
  const router = useRouter();
  const params = useParams();
  const customerId = params?.id as string;
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orderHistory, setOrderHistory] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchCustomerDetail() {
      if (!customerId) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/web-store/customers/${customerId}`);
        if (!res.ok) throw new Error("Customer profile not found");
        const data = await res.json();
        
        // Parse addresses if it's saved as string JSON
        let parsedAddresses: Address[] = [];
        try {
          parsedAddresses = typeof data.customer.addresses === "string" 
            ? JSON.parse(data.customer.addresses) 
            : data.customer.addresses;
        } catch {
          parsedAddresses = [];
        }

        setCustomer({
          ...data.customer,
          addresses: parsedAddresses || [],
        });
        setOrderHistory(data.orderHistory || []);
      } catch (err: any) {
        toast.error(err.message || "Failed to load customer profile");
        router.push("/dashboard/webstore/customers");
      } finally {
        setLoading(false);
      }
    }
    fetchCustomerDetail();
  }, [customerId]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "long",
      year: "numeric"
    });
  };

  const formatOrderDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  const getFulfillmentBadge = (status: string) => {
    switch (status) {
      case "delivered":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"><CheckCircle className="w-3 h-3" /> Delivered</span>;
      case "shipped":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20"><Truck className="w-3 h-3" /> Shipped</span>;
      case "processing":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20"><Clock className="w-3 h-3" /> Processing</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20"><AlertCircle className="w-3 h-3" /> Unfulfilled</span>;
    }
  };

  const getPaymentBadge = (status: string) => {
    switch (status) {
      case "paid":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Paid</span>;
      case "failed":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">Failed</span>;
      case "refunded":
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">Refunded</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">Pending</span>;
    }
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-6 w-32 bg-foreground/10 rounded-lg" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="h-96 bg-foreground/5 rounded-[2rem]" />
          <div className="h-96 lg:col-span-2 bg-foreground/5 rounded-[2rem]" />
        </div>
      </div>
    );
  }

  if (!customer) return null;

  return (
    <div className="space-y-8">
      {/* Back button & Page title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/webstore/customers"
            className="w-10 h-10 rounded-2xl flex items-center justify-center bg-foreground/5 text-foreground/60 border border-foreground/10 hover:bg-foreground/10 hover:text-foreground transition-all"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight font-inter flex items-center gap-2">
              {customer.name} <Sparkles className="w-5 h-5 text-amber-500" />
            </h1>
            <p className="text-[12px] text-foreground/50 mt-1 flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5" /> Registered on {formatDate(customer.createdAt)}
            </p>
          </div>
        </div>
      </div>

      {/* Main Grid content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Side: Profile & Saved Addresses */}
        <div className="space-y-8">
          
          {/* Detailed Profile card */}
          <div className="glass rounded-[2rem] border border-foreground/5 p-6 md:p-8 space-y-4">
            <h3 className="text-base font-bold text-foreground font-inter flex items-center gap-2">
              <User className="w-4 h-4 text-amber-500" /> Customer Information
            </h3>
            
            <div className="space-y-3 text-[12px] pt-2">
              <div className="flex items-center gap-2.5">
                <Mail className="w-4 h-4 text-foreground/30 shrink-0" />
                <a href={`mailto:${customer.email}`} className="text-foreground/75 hover:text-amber-500 transition-colors truncate">
                  {customer.email}
                </a>
              </div>
              <div className="flex items-center gap-2.5">
                <Phone className="w-4 h-4 text-foreground/30 shrink-0" />
                <span className="text-foreground/75">{customer.phone || "No phone registered"}</span>
              </div>
              <div className="h-[1px] bg-foreground/5 my-2" />
              <div className="flex items-center justify-between text-[11px] font-semibold text-foreground/50">
                <span>Total Orders</span>
                <span className="text-foreground font-bold">{orderHistory.length}</span>
              </div>
              <div className="flex items-center justify-between text-[11px] font-semibold text-foreground/50">
                <span>Total Fulfilled Spent</span>
                <span className="text-amber-500 font-bold">
                  {formatCurrency(
                    orderHistory
                      .filter((o) => {
                        const s = (o.fulfillmentStatus || "").toLowerCase().trim();
                        return s === "fulfilled" || s === "shipped" || s === "delivered";
                      })
                      .reduce((sum, o) => sum + Number(o.totalAmount), 0)
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Saved Addresses List */}
          <div className="glass rounded-[2rem] border border-foreground/5 p-6 md:p-8 space-y-4">
            <h3 className="text-base font-bold text-foreground font-inter flex items-center gap-2">
              <MapPin className="w-4 h-4 text-amber-500" /> Saved Addresses ({customer.addresses.length})
            </h3>
            
            {customer.addresses.length === 0 ? (
              <p className="text-xs text-foreground/40 font-medium text-center py-6">No saved addresses on this account.</p>
            ) : (
              <div className="space-y-4 pt-2">
                {customer.addresses.map((address, idx) => {
                  const isDefault = idx === customer.defaultAddressIndex;
                  return (
                    <div
                      key={idx}
                      className={`p-4 rounded-2xl bg-foreground/[0.02] border transition-all ${isDefault ? "border-amber-500/20 bg-amber-500/[0.01]" : "border-foreground/5"}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold text-foreground/80">{address.name}</span>
                        {isDefault && (
                          <span className="text-[9px] font-bold text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded uppercase tracking-wider">
                            Default
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-foreground/60 space-y-1 font-medium leading-relaxed">
                        <p>{address.line1}</p>
                        {address.line2 && <p>{address.line2}</p>}
                        <p>{address.city}, {address.state} - {address.pincode}</p>
                        <p>{address.country}</p>
                        {address.phone && <p className="text-[10px] text-foreground/45 mt-2 font-mono">Ph: {address.phone}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Chronological Web Orders History */}
        <div className="lg:col-span-2 space-y-8">
          <div className="glass rounded-[2rem] border border-foreground/5 p-6 md:p-8">
            <h3 className="text-base font-bold text-foreground font-inter flex items-center gap-2 mb-6">
              <ShoppingBag className="w-4 h-4 text-amber-500" /> Order History ({orderHistory.length})
            </h3>

            {orderHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <ShoppingBag className="w-12 h-12 text-foreground/15 mb-3" />
                <p className="text-xs text-foreground/45 font-medium">No transactions found</p>
                <p className="text-[10px] text-foreground/35 mt-0.5">This customer has not completed any checkouts yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-foreground/5 text-[10px] font-bold text-foreground/40 uppercase tracking-wider">
                      <th className="pb-3 px-3">Order #</th>
                      <th className="pb-3 px-3">Date</th>
                      <th className="pb-3 px-3">Payment</th>
                      <th className="pb-3 px-3">Fulfillment</th>
                      <th className="pb-3 px-3">Method</th>
                      <th className="pb-3 px-3 text-right">Total</th>
                      <th className="pb-3 px-3 w-12">Detail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-foreground/5">
                    {orderHistory.map((order) => (
                      <tr
                        key={order.id}
                        className="group hover:bg-foreground/[0.01] transition-colors"
                      >
                        <td className="py-4 px-3 font-mono text-[12px] font-bold text-foreground group-hover:text-amber-500 transition-colors">
                          <Link href={`/web-store/orders/${order.id}`}>
                            {order.orderNumber}
                          </Link>
                        </td>
                        <td className="py-4 px-3 text-[11px] text-foreground/60">{formatOrderDate(order.createdAt)}</td>
                        <td className="py-4 px-3">{getPaymentBadge(order.paymentStatus)}</td>
                        <td className="py-4 px-3">{getFulfillmentBadge(order.fulfillmentStatus)}</td>
                        <td className="py-4 px-3 font-mono text-[10px] text-foreground/60 uppercase">{order.paymentMethod}</td>
                        <td className="py-4 px-3 text-right text-[12px] font-bold text-foreground">
                          {formatCurrency(order.totalAmount)}
                        </td>
                        <td className="py-4 px-3">
                          <Link
                            href={`/web-store/orders/${order.id}`}
                            className="w-8 h-8 rounded-xl flex items-center justify-center bg-foreground/5 text-foreground/50 hover:bg-foreground/10 hover:text-foreground transition-all"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
