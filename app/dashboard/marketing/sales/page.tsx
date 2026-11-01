"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Percent, Search, Plus, X, CheckCircle2, AlertCircle, Loader2, ChevronDown, Power, Tag,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { computeSalePrice, MIN_SALE_PERCENT, MAX_SALE_PERCENT } from "@/lib/sale-pricing";

interface PickerProduct {
  id: number;
  title: string;
  live: boolean;
  status?: string;
  image?: { src: string } | null;
  images?: { src: string }[];
  variants?: { id: number; price: string; compare_at_price?: string | null }[];
}

interface SaleItem {
  id: string;
  shopifyProductId: string;
  productTitle: string | null;
  variantTitle: string | null;
  originalPrice: string;
  originalCompareAtPrice: string | null;
  salePrice: string;
  status: "applied" | "failed" | "restored" | "kept";
  error: string | null;
}

interface Sale {
  id: string;
  name: string;
  percent: number;
  status: "active" | "ended";
  startedAt: string;
  endedAt: string | null;
  createdBy: string | null;
  items: SaleItem[];
}

const PERCENT_PRESETS = [10, 20, 30, 40, 50];

const inr = (v: string | number) => `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function SaleManagementPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<PickerProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [confirmEndId, setConfirmEndId] = useState<string | null>(null);

  // Create form
  const [name, setName] = useState("");
  const [percent, setPercent] = useState<number>(30);
  const [query, setQuery] = useState("");
  const [liveOnly, setLiveOnly] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadSales = useCallback(async () => {
    const res = await fetch("/api/admin/sales");
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load sales");
    const data = await res.json();
    setSales(data.sales || []);
  }, []);

  useEffect(() => {
    Promise.all([
      loadSales(),
      fetch("/api/shopify/products")
        .then((r) => r.json())
        .then((d) => setProducts(d.products || [])),
    ])
      .catch((err) => toast.error(err.message || "Failed to load"))
      .finally(() => setLoading(false));
  }, [loadSales]);

  // Products currently discounted by a running sale (can't be added to another one)
  const inActiveSale = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sales) {
      if (s.status !== "active") continue;
      for (const i of s.items) if (i.status === "applied") map.set(i.shopifyProductId, s.name);
    }
    return map;
  }, [sales]);

  const visibleProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(
      (p) => (!liveOnly || p.live) && (!q || p.title.toLowerCase().includes(q))
    );
  }, [products, query, liveOnly]);

  const selectableVisible = visibleProducts.filter((p) => !inActiveSale.has(String(p.id)));
  const allVisibleSelected =
    selectableVisible.length > 0 && selectableVisible.every((p) => selected.has(String(p.id)));

  const percentValid = Number.isFinite(percent) && percent >= MIN_SALE_PERCENT && percent <= MAX_SALE_PERCENT;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) selectableVisible.forEach((p) => next.delete(String(p.id)));
      else selectableVisible.forEach((p) => next.add(String(p.id)));
      return next;
    });

  const resetForm = () => {
    setName("");
    setPercent(30);
    setQuery("");
    setSelected(new Set());
    setConfirming(false);
  };

  const startSale = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, percent, productIds: Array.from(selected) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 400) {
        toast.error(data.error || "Check the sale details");
        return;
      }
      if (!res.ok && !data.saleId) throw new Error(data.error || "Failed to start sale");

      if (data.applied > 0) toast.success(`Sale live on ${data.applied} product${data.applied === 1 ? "" : "s"}`);
      if (data.skipped?.length) toast.warning(`${data.skipped.length} skipped: ${data.skipped.map((s: any) => s.reason).join("; ")}`);
      if (data.failed?.length) toast.error(`${data.failed.length} failed in Shopify: ${data.failed.map((f: any) => `${f.title || f.productId}: ${f.error}`).join("; ")}`);

      await loadSales();
      if (data.applied > 0) {
        setShowCreate(false);
        resetForm();
        setExpanded(data.saleId);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to start sale");
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  };

  const endSale = async (id: string) => {
    setEndingId(id);
    setConfirmEndId(null);
    try {
      const res = await fetch(`/api/admin/sales/${id}/end`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to end sale");
      toast.success(`Original prices restored on ${data.restored} variant${data.restored === 1 ? "" : "s"}`);
      if (data.kept?.length) toast.warning(`${data.kept.length} left unchanged: ${data.kept.map((k: any) => `${k.title} ${k.variant || ""} — ${k.reason}`).join("; ")}`);
      if (data.failed?.length) toast.error(`Could not restore ${data.failed.length}: ${data.failed.map((f: any) => f.error).join("; ")}. Try ending again.`);
      await loadSales();
    } catch (err: any) {
      toast.error(err.message || "Failed to end sale");
    } finally {
      setEndingId(null);
    }
  };

  const activeSales = sales.filter((s) => s.status === "active");

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20 px-2 md:px-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pt-6 md:pt-10">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-500/10 rounded-lg">
              <Percent className="w-4 h-4 text-red-500" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-red-500">
              {activeSales.length > 0 ? `${activeSales.length} sale${activeSales.length === 1 ? "" : "s"} live` : "No sale running"}
            </span>
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-foreground uppercase tracking-tighter leading-none">
            Sale <span className="text-foreground/30">Management</span>
          </h1>
          <p className="text-[11px] text-foreground/50 font-bold uppercase tracking-[0.3em] max-w-xl leading-relaxed">
            Pick products, set a % off. Original prices show crossed out across the website and app. End the sale to restore them.
          </p>
        </div>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="bg-foreground text-background h-12 px-8 rounded-2xl font-bold text-[10px] uppercase tracking-[0.3em] hover:scale-105 active:scale-95 transition-all shadow-2xl flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" /> New Sale
          </button>
        )}
      </div>

      {/* Create sale */}
      {showCreate && (
        <div className="glass rounded-3xl border border-foreground/[0.05] p-5 md:p-8 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black uppercase tracking-[0.2em]">New Sale</h2>
            <button onClick={() => { setShowCreate(false); resetForm(); }} className="p-2 rounded-xl hover:bg-foreground/5" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <label className="space-y-2 block">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-foreground/40">Sale name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Diwali Sale"
                className="w-full h-12 px-4 rounded-xl bg-foreground/[0.03] border border-foreground/10 outline-none focus:border-foreground/30 text-sm"
              />
            </label>
            <div className="space-y-2">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-foreground/40">Discount</span>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <input
                    type="number"
                    min={MIN_SALE_PERCENT}
                    max={MAX_SALE_PERCENT}
                    value={Number.isFinite(percent) ? percent : ""}
                    onChange={(e) => setPercent(parseFloat(e.target.value))}
                    className="w-24 h-12 pl-4 pr-8 rounded-xl bg-foreground/[0.03] border border-foreground/10 outline-none focus:border-foreground/30 text-sm font-bold"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/40 text-sm">%</span>
                </div>
                {PERCENT_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPercent(p)}
                    className={`h-10 px-3 rounded-xl text-[11px] font-bold border transition-colors ${percent === p ? "bg-foreground text-background border-foreground" : "border-foreground/10 text-foreground/60 hover:border-foreground/30"}`}
                  >
                    {p}%
                  </button>
                ))}
              </div>
              {!percentValid && (
                <p className="text-[10px] text-red-500">Enter between {MIN_SALE_PERCENT}% and {MAX_SALE_PERCENT}%.</p>
              )}
            </div>
          </div>

          {/* Product picker */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-2 flex-1 h-11 px-3 rounded-xl bg-foreground/[0.03] border border-foreground/10">
                <Search className="w-4 h-4 text-foreground/30" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search products"
                  className="flex-1 bg-transparent outline-none text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-foreground/50 cursor-pointer">
                <input type="checkbox" checked={liveOnly} onChange={(e) => setLiveOnly(e.target.checked)} />
                Live products only
              </label>
              <button
                type="button"
                onClick={toggleAllVisible}
                disabled={selectableVisible.length === 0}
                className="h-11 px-4 rounded-xl border border-foreground/10 text-[10px] font-bold uppercase tracking-wider hover:border-foreground/30 disabled:opacity-40"
              >
                {allVisibleSelected ? "Clear visible" : `Select visible (${selectableVisible.length})`}
              </button>
            </div>

            <div className="rounded-2xl border border-foreground/[0.06] max-h-[420px] overflow-y-auto divide-y divide-foreground/[0.04]">
              {loading ? (
                <div className="p-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-foreground/40" /></div>
              ) : visibleProducts.length === 0 ? (
                <p className="p-8 text-center text-xs text-foreground/40">No products match.</p>
              ) : (
                visibleProducts.map((p) => {
                  const id = String(p.id);
                  const busySale = inActiveSale.get(id);
                  const price = p.variants?.[0]?.price;
                  const img = p.image?.src || p.images?.[0]?.src;
                  return (
                    <label
                      key={id}
                      className={`flex items-center gap-3 px-4 py-3 ${busySale ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-foreground/[0.02]"}`}
                    >
                      <input
                        type="checkbox"
                        disabled={Boolean(busySale)}
                        checked={selected.has(id)}
                        onChange={() => toggle(id)}
                      />
                      <div className="w-10 h-12 rounded-lg overflow-hidden bg-foreground/5 shrink-0">
                        {img && <img src={img} alt="" className="w-full h-full object-cover" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold truncate">{p.title}</p>
                        <p className="text-[10px] text-foreground/40">
                          {!p.live && <span className="mr-2 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 font-bold uppercase">{p.status || "Not live"}</span>}
                          {busySale && <span className="mr-2 px-1.5 py-0.5 rounded bg-red-500/10 text-red-500 font-bold">In “{busySale}”</span>}
                        </p>
                      </div>
                      {price && Number(price) > 0 && (
                        <div className="text-right shrink-0">
                          {percentValid && !busySale ? (
                            <>
                              <p className="text-[10px] text-foreground/40 line-through">{inr(price)}</p>
                              <p className="text-xs font-bold text-red-500">{inr(computeSalePrice(price, percent))}</p>
                            </>
                          ) : (
                            <p className="text-xs font-bold">{inr(price)}</p>
                          )}
                        </div>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </div>

          {/* Submit */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
            <p className="text-[11px] text-foreground/50">
              <span className="font-bold text-foreground">{selected.size}</span> product{selected.size === 1 ? "" : "s"} selected
              {percentValid && selected.size > 0 && <> · {percent}% off every size of each</>}
            </p>
            {confirming ? (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-foreground/60">Prices change on the live store immediately.</span>
                <button onClick={() => setConfirming(false)} disabled={submitting} className="h-11 px-4 rounded-xl border border-foreground/10 text-[10px] font-bold uppercase tracking-wider">
                  Cancel
                </button>
                <button
                  onClick={startSale}
                  disabled={submitting}
                  className="h-11 px-6 rounded-xl bg-red-600 text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 disabled:opacity-60"
                >
                  {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {submitting ? "Applying…" : "Confirm & go live"}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                disabled={!name.trim() || !percentValid || selected.size === 0}
                className="h-11 px-6 rounded-xl bg-foreground text-background text-[10px] font-bold uppercase tracking-[0.2em] disabled:opacity-40"
              >
                Start sale
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sales list */}
      <div className="space-y-3">
        {loading ? null : sales.length === 0 ? (
          <div className="glass rounded-3xl p-10 text-center text-xs text-foreground/40 border border-foreground/[0.04]">
            No sales yet. Click “New Sale” to discount products.
          </div>
        ) : (
          sales.map((sale) => {
            const products = new Set(sale.items.map((i) => i.shopifyProductId)).size;
            const failed = sale.items.filter((i) => i.status === "failed").length;
            const isOpen = expanded === sale.id;
            return (
              <div key={sale.id} className="glass rounded-3xl border border-foreground/[0.04] overflow-hidden">
                <div className="flex flex-col md:flex-row md:items-center gap-4 p-5">
                  <button onClick={() => setExpanded(isOpen ? null : sale.id)} className="flex items-center gap-4 flex-1 text-left">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-sm ${sale.status === "active" ? "bg-red-500/10 text-red-500" : "bg-foreground/5 text-foreground/40"}`}>
                      {sale.percent}%
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm truncate">{sale.name}</p>
                      <p className="text-[10px] text-foreground/40">
                        {products} product{products === 1 ? "" : "s"} · started {format(new Date(sale.startedAt), "d MMM yyyy, h:mm a")}
                        {sale.endedAt && <> · ended {format(new Date(sale.endedAt), "d MMM yyyy, h:mm a")}</>}
                        {failed > 0 && <span className="text-red-500"> · {failed} variant{failed === 1 ? "" : "s"} failed</span>}
                      </p>
                    </div>
                    <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider ${sale.status === "active" ? "bg-emerald-500/10 text-emerald-500" : "bg-foreground/5 text-foreground/40"}`}>
                      {sale.status === "active" ? "Live" : "Ended"}
                    </span>
                    <ChevronDown className={`w-4 h-4 text-foreground/30 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                  </button>
                  {sale.status === "active" && (
                    confirmEndId === sale.id ? (
                      <div className="flex items-center gap-2">
                        <button onClick={() => setConfirmEndId(null)} className="h-10 px-4 rounded-xl border border-foreground/10 text-[10px] font-bold uppercase">Cancel</button>
                        <button onClick={() => endSale(sale.id)} className="h-10 px-4 rounded-xl bg-foreground text-background text-[10px] font-bold uppercase">Restore prices</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmEndId(sale.id)}
                        disabled={endingId === sale.id}
                        className="h-10 px-4 rounded-xl border border-foreground/10 text-[10px] font-bold uppercase tracking-wider flex items-center gap-2 hover:border-foreground/30 disabled:opacity-50"
                      >
                        {endingId === sale.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
                        End sale
                      </button>
                    )
                  )}
                </div>

                {isOpen && (
                  <div className="border-t border-foreground/[0.04] overflow-x-auto">
                    <table className="w-full text-left min-w-[640px]">
                      <thead>
                        <tr className="bg-foreground/[0.02] text-[9px] font-black uppercase tracking-[0.2em] text-foreground/30">
                          <th className="px-5 py-3">Product</th>
                          <th className="px-5 py-3">Size</th>
                          <th className="px-5 py-3">Original</th>
                          <th className="px-5 py-3">Sale price</th>
                          <th className="px-5 py-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-foreground/[0.03] text-xs">
                        {sale.items.map((item) => (
                          <tr key={item.id}>
                            <td className="px-5 py-2.5 font-medium">{item.productTitle}</td>
                            <td className="px-5 py-2.5 text-foreground/60">{item.variantTitle}</td>
                            <td className="px-5 py-2.5 text-foreground/50 line-through">{inr(item.originalPrice)}</td>
                            <td className="px-5 py-2.5 font-bold">{inr(item.salePrice)}</td>
                            <td className="px-5 py-2.5">
                              <ItemStatus item={item} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ItemStatus({ item }: { item: SaleItem }) {
  const map = {
    applied: { icon: Tag, label: "On sale", cls: "text-emerald-500" },
    restored: { icon: CheckCircle2, label: "Restored", cls: "text-foreground/40" },
    kept: { icon: AlertCircle, label: "Left as edited", cls: "text-amber-500" },
    failed: { icon: AlertCircle, label: "Failed", cls: "text-red-500" },
  } as const;
  const s = map[item.status] || map.failed;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 font-bold ${s.cls}`} title={item.error || undefined}>
      <Icon className="w-3.5 h-3.5" /> {s.label}
    </span>
  );
}
