"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Search,
  Users,
  ChevronRight,
  Sparkles,
  Calendar,
  ShoppingBag,
  CreditCard
} from "lucide-react";
import { toast } from "sonner";

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  createdAt: string;
  ordersCount: number;
  totalSpent: number;
}

export default function WebStoreCustomersList() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.append("query", search);

      const res = await fetch(`/api/web-store/customers?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load customer list");
      const data = await res.json();
      setCustomers(data.customers || []);
    } catch (err: any) {
      toast.error(err.message || "Error fetching customers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timeout = setTimeout(fetchCustomers, 300);
    return () => clearTimeout(timeout);
  }, [search]);

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
      month: "short",
      year: "numeric"
    });
  };

  return (
    <div className="space-y-8">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight font-inter flex items-center gap-2">
          Web Store Customers <Sparkles className="w-5 h-5 text-amber-500" />
        </h1>
        <p className="text-[12px] text-foreground/50 mt-1">
          Monitor and track profiles, purchase trends, and shopping behaviors of registered web store accounts.
        </p>
      </div>

      {/* Search Bar */}
      <div className="glass rounded-[2rem] border border-foreground/5 p-6">
        <div className="relative max-w-md w-full">
          <Search className="absolute left-4.5 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/35" />
          <input
            type="text"
            placeholder="Search by customer name, email, phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-2xl pl-11 pr-4 py-2.5 text-xs text-foreground focus:outline-none focus:border-amber-500/30 transition-all font-medium"
          />
        </div>
      </div>

      {/* Customers List Container */}
      <div className="glass rounded-[2rem] border border-foreground/5 overflow-hidden">
        {loading ? (
          <div className="p-12 space-y-4 animate-pulse">
            {[...Array(5)].map((_, idx) => (
              <div key={idx} className="h-12 bg-foreground/5 rounded-xl w-full" />
            ))}
          </div>
        ) : customers.length === 0 ? (
          <div className="py-20 text-center flex flex-col items-center">
            <Users className="w-16 h-16 text-foreground/15 mb-4" />
            <h3 className="text-sm font-bold text-foreground mb-1">No Customers Registered</h3>
            <p className="text-xs text-foreground/45 max-w-xs">No web store accounts matched your query or have registered yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-foreground/5 text-[10px] font-bold text-foreground/40 uppercase tracking-wider">
                  <th className="py-4 px-6">Customer</th>
                  <th className="py-4 px-4">Phone Number</th>
                  <th className="py-4 px-4"><span className="flex items-center gap-1"><ShoppingBag className="w-3.5 h-3.5" /> Total Orders</span></th>
                  <th className="py-4 px-4"><span className="flex items-center gap-1"><CreditCard className="w-3.5 h-3.5" /> Total Spent</span></th>
                  <th className="py-4 px-4"><span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> Member Since</span></th>
                  <th className="py-4 px-6 w-12 text-center">Profile</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground/5">
                {customers.map((customer) => (
                  <tr
                    key={customer.id}
                    className="group hover:bg-foreground/[0.01] transition-colors"
                  >
                    <td className="py-4 px-6">
                      <div className="flex flex-col min-w-0">
                        <Link
                          href={`/web-store/customers/${customer.id}`}
                          className="text-[12px] font-semibold text-foreground group-hover:text-amber-500 transition-colors truncate"
                        >
                          {customer.name}
                        </Link>
                        <span className="text-[9px] text-foreground/40 mt-0.5 truncate">{customer.email}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-[11px] font-mono text-foreground/70">{customer.phone || "—"}</td>
                    <td className="py-4 px-4 text-[12px] font-bold text-foreground">{customer.ordersCount}</td>
                    <td className="py-4 px-4 text-[12px] font-bold text-foreground">{formatCurrency(customer.totalSpent)}</td>
                    <td className="py-4 px-4 text-[11px] text-foreground/60">{formatDate(customer.createdAt)}</td>
                    <td className="py-4 px-6 text-center">
                      <Link
                        href={`/web-store/customers/${customer.id}`}
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
  );
}
