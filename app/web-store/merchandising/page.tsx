"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Reorder } from "framer-motion";
import { toast } from "sonner";
import NextImage from "next/image";
import {
  AlertTriangle, ArrowDownToLine, ArrowUpToLine, CheckCircle2, ExternalLink, Eye, EyeOff,
  GripVertical, Home, Layers, LayoutGrid, Loader2, Plus, RefreshCw, Save, Search, Sparkles, X,
} from "lucide-react";

// Mirrors lib/storefrontPlacements.ts (kept local so this client bundle does not import server code).
interface ProductRow {
  id: string;
  title: string;
  handle: string;
  image: string | null;
  price: string;
  stock: number;
  status: string;
  live: boolean;
  reason: string | null;
  isNew?: boolean;
}
interface PlacementInfo {
  key: string;
  label: string;
  kind: "homepage" | "shop-all" | "collection";
  liveUrl: string;
}
interface Overview {
  placements: PlacementInfo[];
  stats: { shopifyTotal: number; shopifyLive: number; notLive: ProductRow[]; shopAllShown: number; shopAllHidden: number };
}
interface Detail {
  info: PlacementInfo;
  visible: ProductRow[];
  hidden: ProductRow[];
  available: ProductRow[];
  notLive: ProductRow[];
  note?: string;
}

// The homepage template draws products 1-4 and 5-8, skips 9-12, and draws 13-16.
const HOME_SLOTS: { from: number; to: number; label: string; shown: boolean }[] = [
  { from: 1, to: 4, label: "Top grid (first 4)", shown: true },
  { from: 5, to: 8, label: "Second grid (next 4)", shown: true },
  { from: 9, to: 12, label: "Not displayed on the homepage", shown: false },
  { from: 13, to: 16, label: "Bottom grid (last 4)", shown: true },
];
function homeSlotLabel(position: number) {
  const s = HOME_SLOTS.find((x) => position >= x.from && position <= x.to);
  if (s) return s;
  return { from: 17, to: 999, label: "Not displayed on the homepage", shown: false };
}

const fmtPrice = (p: string) => `₹${Number(p || 0).toLocaleString("en-IN")}`;

function Thumb({ src, title }: { src: string | null; title: string }) {
  return (
    <div className="relative w-10 h-12 rounded bg-foreground/[0.04] overflow-hidden shrink-0">
      {src ? <NextImage src={src} alt={title} fill sizes="40px" className="object-cover" unoptimized /> : null}
    </div>
  );
}

export default function ProductsAndOrderPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string>("all");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Working copy being edited
  const [visible, setVisible] = useState<ProductRow[]>([]);
  const [hidden, setHidden] = useState<ProductRow[]>([]);
  const [baseline, setBaseline] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [search, setSearch] = useState("");
  const [addSearch, setAddSearch] = useState("");
  const [placementSearch, setPlacementSearch] = useState("");
  const [showNotLive, setShowNotLive] = useState(false);

  // Homepage "Shop All" button destination
  const [shopMeta, setShopMeta] = useState<{ id?: string; shopDomain?: string; shopAllLink: string } | null>(null);
  const [savingLink, setSavingLink] = useState(false);

  const signature = (v: ProductRow[], h: ProductRow[]) => JSON.stringify([v.map((p) => p.id), h.map((p) => p.id)]);
  const dirty = detail ? signature(visible, hidden) !== baseline : false;

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/storefront/placements", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setOverview(data);
      setOverviewError(null);
    } catch (e: any) {
      setOverviewError(e.message || "Failed to load products from Shopify");
    }
  }, []);

  const loadDetail = useCallback(async (key: string) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/admin/storefront/placements?key=${encodeURIComponent(key)}`, { cache: "no-store" });
      const data: Detail = await res.json();
      if (!res.ok) throw new Error((data as any).error || "Failed to load");
      setDetail(data);
      setVisible(data.visible);
      setHidden(data.hidden);
      setBaseline(signature(data.visible, data.hidden));
      setSearch("");
      setAddSearch("");
    } catch (e: any) {
      toast.error(e.message || "Could not load this list");
      setDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
    fetch("/api/admin/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setShopMeta({ id: s.id, shopDomain: s.shopDomain, shopAllLink: s.shopAllLink || "/collections/all" }))
      .catch(() => {});
  }, [loadOverview]);

  useEffect(() => {
    loadDetail(activeKey);
  }, [activeKey, loadDetail]);

  // Warn before closing the tab with unsaved changes
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const choosePlacement = (key: string) => {
    if (key === activeKey) return;
    if (dirty && !confirm("You have unsaved changes. Leave without saving?")) return;
    setActiveKey(key);
  };

  const isHome = detail?.info.kind === "homepage";

  const save = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/storefront/placements", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: detail.info.key, order: visible.map((p) => p.id), hidden: hidden.map((p) => p.id) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast.success("Saved. The live website is updating now.");
      setBaseline(signature(visible, hidden));
      loadOverview();
    } catch (e: any) {
      toast.error(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const refreshLive = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/admin/storefront/refresh", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Refresh failed");
      toast.success(
        data.webhooks === "failed"
          ? "Live site refreshed. (Could not register Shopify auto-updates; try again later.)"
          : "Live site refreshed from Shopify. Shopify auto-updates are on."
      );
      await loadOverview();
      if (!dirty) await loadDetail(activeKey);
    } catch (e: any) {
      toast.error(e.message || "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const saveShopAllLink = async (value: string) => {
    if (!shopMeta) return;
    setSavingLink(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopId: shopMeta.id, shopDomain: shopMeta.shopDomain || "8tiahf-bk.myshopify.com", shopAllLink: value }),
      });
      if (!res.ok) throw new Error();
      setShopMeta({ ...shopMeta, shopAllLink: value });
      toast.success('Homepage "Shop All" button updated');
    } catch {
      toast.error("Could not save the Shop All button destination");
    } finally {
      setSavingLink(false);
    }
  };

  // ---- list edits ----
  const moveToTop = (id: string) =>
    setVisible((v) => {
      const item = v.find((p) => p.id === id);
      return item ? [item, ...v.filter((p) => p.id !== id)] : v;
    });
  const moveToBottom = (id: string) =>
    setVisible((v) => {
      const item = v.find((p) => p.id === id);
      return item ? [...v.filter((p) => p.id !== id), item] : v;
    });
  const hideProduct = (id: string) => {
    const item = visible.find((p) => p.id === id);
    if (!item) return;
    setVisible((v) => v.filter((p) => p.id !== id));
    setHidden((h) => [...h, item]);
  };
  const showProduct = (id: string) => {
    const item = hidden.find((p) => p.id === id);
    if (!item) return;
    setHidden((h) => h.filter((p) => p.id !== id));
    setVisible((v) => [...v, item]);
  };
  const removeFromHome = (id: string) => setVisible((v) => v.filter((p) => p.id !== id));
  const addToHome = (p: ProductRow) => setVisible((v) => (v.some((x) => x.id === p.id) ? v : [...v, p]));

  const q = search.trim().toLowerCase();
  const matches = (p: ProductRow) => !q || p.title.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q);
  const reorderDisabled = !!q; // dragging a filtered list would scramble positions

  const addable = useMemo(() => {
    if (!detail || !isHome) return [];
    const inList = new Set(visible.map((p) => p.id));
    const a = addSearch.trim().toLowerCase();
    return [...detail.available, ...detail.visible, ...detail.hidden]
      .filter((p, i, arr) => p.live && arr.findIndex((x) => x.id === p.id) === i)
      .filter((p) => !inList.has(p.id))
      .filter((p) => !a || p.title.toLowerCase().includes(a) || p.handle.toLowerCase().includes(a));
  }, [detail, isHome, visible, addSearch]);

  const placements = overview?.placements || [];
  const filteredPlacements = placements.filter(
    (p) => p.kind !== "collection" || !placementSearch || p.label.toLowerCase().includes(placementSearch.toLowerCase())
  );
  const collectionOptions = placements.filter((p) => p.kind === "collection");
  const stats = overview?.stats;

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-24 px-4 md:px-0">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pt-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-foreground tracking-tight">Products &amp; Order</h1>
          <p className="text-[11px] text-foreground/50 tracking-wide max-w-2xl">
            Choose what customers see on the homepage, Shop All and each collection, and put it in the order you want.
            Products come from Shopify automatically &mdash; add or edit them in Shopify and they appear here and on the website.
          </p>
        </div>
        <button
          onClick={refreshLive}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-foreground/[0.08] text-[10px] font-semibold uppercase tracking-widest text-foreground hover:bg-foreground/[0.04] disabled:opacity-50"
          title="Pull the latest products from Shopify onto the live website right now"
        >
          {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Refresh live site
        </button>
      </div>

      {/* Catalogue health */}
      {overviewError ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/[0.05] px-5 py-4">
          <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
          <div className="text-[12px] text-foreground">
            <b>Could not load products from Shopify.</b> {overviewError}{" "}
            <button onClick={loadOverview} className="underline">Try again</button>
          </div>
        </div>
      ) : stats ? (
        <div className="rounded-xl border border-foreground/[0.06] bg-background px-5 py-4 space-y-3">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-[12px]">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span><b>{stats.shopifyLive}</b> products are live on the website</span>
            </div>
            <div className="text-foreground/60">{stats.shopifyTotal} total in Shopify</div>
            <div className="text-foreground/60">
              Shop All shows <b className="text-foreground">{stats.shopAllShown}</b>
              {stats.shopAllHidden > 0 ? <> (you hid {stats.shopAllHidden})</> : null}
            </div>
            {stats.notLive.length > 0 && (
              <button onClick={() => setShowNotLive((s) => !s)} className="flex items-center gap-2 text-amber-600 hover:underline">
                <AlertTriangle className="w-4 h-4" />
                {stats.notLive.length} not live &mdash; why?
              </button>
            )}
          </div>
          {showNotLive && stats.notLive.length > 0 && (
            <div className="border-t border-foreground/[0.06] pt-3 space-y-2">
              <p className="text-[11px] text-foreground/55">
                Only <b>Active</b> products that are <b>published to the Online Store</b> in Shopify show on the website.
                To put one of these live, open it in Shopify, set it to Active and tick &ldquo;Online Store&rdquo;.
              </p>
              <div className="grid sm:grid-cols-2 gap-2">
                {stats.notLive.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 rounded-lg bg-foreground/[0.02] px-3 py-2">
                    <Thumb src={p.image} title={p.title} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12px] font-medium truncate">{p.title}</div>
                      <div className="text-[10px] text-amber-600">{p.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      <div className="grid lg:grid-cols-[260px_1fr] gap-6 items-start">
        {/* Where to manage */}
        <aside className="rounded-xl border border-foreground/[0.06] bg-background p-2 lg:sticky lg:top-4 max-h-[75vh] overflow-y-auto">
          <div className="px-3 pt-2 pb-1 text-[9px] font-bold uppercase tracking-widest text-foreground/40">Pages</div>
          {filteredPlacements
            .filter((p) => p.kind !== "collection")
            .map((p) => (
              <PlacementButton key={p.key} p={p} active={p.key === activeKey} onClick={() => choosePlacement(p.key)} />
            ))}
          <div className="px-3 pt-4 pb-1 text-[9px] font-bold uppercase tracking-widest text-foreground/40">Collections</div>
          <div className="px-2 pb-2">
            <input
              value={placementSearch}
              onChange={(e) => setPlacementSearch(e.target.value)}
              placeholder="Find a collection…"
              className="w-full bg-foreground/[0.03] border border-foreground/[0.06] rounded-md px-3 py-2 text-[11px] outline-none"
            />
          </div>
          {!overview && !overviewError && (
            <div className="px-3 py-4 text-[11px] text-foreground/40 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>
          )}
          {filteredPlacements
            .filter((p) => p.kind === "collection")
            .map((p) => (
              <PlacementButton key={p.key} p={p} active={p.key === activeKey} onClick={() => choosePlacement(p.key)} />
            ))}
        </aside>

        {/* Editor */}
        <section className="space-y-4 min-w-0">
          {loadingDetail && !detail ? (
            <div className="flex items-center justify-center min-h-[300px] gap-3 text-foreground/50">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading products…
            </div>
          ) : !detail ? (
            <div className="rounded-xl border border-foreground/[0.06] p-8 text-center text-[12px] text-foreground/50">
              Could not load this list.{" "}
              <button className="underline" onClick={() => loadDetail(activeKey)}>Try again</button>
            </div>
          ) : (
            <>
              {/* Sticky action bar */}
              <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-background/90 backdrop-blur flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold tracking-tight truncate">{detail.info.label}</h2>
                  <p className="text-[11px] text-foreground/50">
                    {isHome
                      ? `${visible.length} product${visible.length === 1 ? "" : "s"} picked`
                      : `${visible.length} showing${hidden.length ? ` · ${hidden.length} hidden` : ""}`}
                    {dirty && <span className="ml-2 text-amber-600 font-medium">Unsaved changes</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`https://zicabella.com${detail.info.liveUrl}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-md text-[10px] font-semibold uppercase tracking-widest text-foreground/60 hover:text-foreground"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> View live
                  </a>
                  {dirty && (
                    <button
                      onClick={() => { setVisible(detail.visible); setHidden(detail.hidden); setBaseline(signature(detail.visible, detail.hidden)); }}
                      className="px-3 py-2 rounded-md text-[10px] font-semibold uppercase tracking-widest text-foreground/60 hover:text-foreground"
                    >
                      Discard
                    </button>
                  )}
                  <button
                    onClick={save}
                    disabled={saving || !dirty}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-md bg-foreground text-background text-[10px] font-semibold uppercase tracking-widest disabled:opacity-40"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save &amp; publish
                  </button>
                </div>
              </div>

              {detail.note && (
                <div className="rounded-lg bg-blue-500/[0.06] border border-blue-500/20 px-4 py-3 text-[11px] text-foreground/70">{detail.note}</div>
              )}

              {isHome && shopMeta && (
                <div className="rounded-xl border border-foreground/[0.06] bg-background px-5 py-4 flex flex-col md:flex-row md:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium">Homepage &ldquo;Shop All&rdquo; button goes to</div>
                    <div className="text-[10px] text-foreground/45">Saved immediately when you change it.</div>
                  </div>
                  <select
                    value={shopMeta.shopAllLink}
                    disabled={savingLink}
                    onChange={(e) => saveShopAllLink(e.target.value)}
                    className="md:max-w-xs w-full bg-foreground/[0.03] px-3 py-2.5 rounded-md border border-foreground/[0.06] text-[11px] outline-none"
                  >
                    <option value="/collections/all">Shop All (default)</option>
                    <option value="/collections">Collections page</option>
                    {collectionOptions.map((c) => (
                      <option key={c.key} value={`/collections/${c.key}`}>{c.label}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Search inside the list */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search this list…"
                  className="w-full bg-background border border-foreground/[0.06] rounded-md pl-9 pr-3 py-2.5 text-[12px] outline-none"
                />
                {reorderDisabled && (
                  <div className="text-[10px] text-foreground/45 mt-1">Clear the search to drag products. You can still use the ↑ ↓ buttons.</div>
                )}
              </div>

              {!isHome && visible.length > 0 && (
                <p className="text-[11px] text-foreground/50 flex items-start gap-2">
                  <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  Drag to reorder, or use the arrows to jump to the top or bottom. New products you haven&rsquo;t placed yet
                  show first and are tagged <b>NEW</b>.
                </p>
              )}

              {/* The ordered list */}
              {visible.length === 0 ? (
                <div className="rounded-xl border border-dashed border-foreground/[0.12] p-10 text-center text-[12px] text-foreground/50">
                  {isHome ? "No products yet. Add some from the list below." : "Nothing is showing on this page."}
                </div>
              ) : (
                <Reorder.Group axis="y" values={visible} onReorder={reorderDisabled ? () => {} : setVisible} className="space-y-1.5">
                  {visible.map((p, idx) => {
                    const slot = isHome ? homeSlotLabel(idx + 1) : null;
                    const showHeader = isHome && (idx === 0 || homeSlotLabel(idx).from !== slot!.from);
                    if (!matches(p)) return null;
                    return (
                      <div key={p.id}>
                        {showHeader && slot && (
                          <div className={`pt-3 pb-1 text-[9px] font-bold uppercase tracking-widest ${slot.shown ? "text-foreground/45" : "text-amber-600"}`}>
                            {slot.label}
                          </div>
                        )}
                        <Reorder.Item
                          value={p}
                          dragListener={!reorderDisabled}
                          className={`flex items-center gap-3 rounded-lg border bg-background px-3 py-2 select-none ${
                            slot && !slot.shown ? "border-amber-500/30 opacity-60" : "border-foreground/[0.06]"
                          } ${reorderDisabled ? "" : "cursor-grab active:cursor-grabbing"}`}
                        >
                          <GripVertical className="w-4 h-4 text-foreground/25 shrink-0" />
                          <span className="w-7 text-right text-[11px] font-mono text-foreground/40 shrink-0">{idx + 1}</span>
                          <Thumb src={p.image} title={p.title} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[12px] font-medium truncate">{p.title}</span>
                              {p.isNew && <span className="text-[8px] font-bold tracking-widest bg-green-500/15 text-green-600 px-1.5 py-0.5 rounded">NEW</span>}
                              {p.stock <= 0 && <span className="text-[8px] font-bold tracking-widest bg-foreground/10 text-foreground/50 px-1.5 py-0.5 rounded">SOLD OUT</span>}
                            </div>
                            <div className="text-[10px] text-foreground/40 truncate">{fmtPrice(p.price)} · {p.handle}</div>
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <IconBtn title="Move to top" onClick={() => moveToTop(p.id)}><ArrowUpToLine className="w-3.5 h-3.5" /></IconBtn>
                            <IconBtn title="Move to bottom" onClick={() => moveToBottom(p.id)}><ArrowDownToLine className="w-3.5 h-3.5" /></IconBtn>
                            {isHome ? (
                              <IconBtn title="Remove from homepage" onClick={() => removeFromHome(p.id)}><X className="w-3.5 h-3.5" /></IconBtn>
                            ) : (
                              <IconBtn title="Hide from this page" onClick={() => hideProduct(p.id)}><EyeOff className="w-3.5 h-3.5" /></IconBtn>
                            )}
                          </div>
                        </Reorder.Item>
                      </div>
                    );
                  })}
                </Reorder.Group>
              )}

              {/* Hidden */}
              {!isHome && hidden.length > 0 && (
                <div className="space-y-2 pt-4">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-foreground/45">
                    Hidden from this page ({hidden.length}) &mdash; still live everywhere else
                  </div>
                  {hidden.filter(matches).map((p) => (
                    <div key={p.id} className="flex items-center gap-3 rounded-lg border border-dashed border-foreground/[0.12] px-3 py-2 opacity-70">
                      <Thumb src={p.image} title={p.title} />
                      <div className="min-w-0 flex-1 text-[12px] truncate">{p.title}</div>
                      <button
                        onClick={() => showProduct(p.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-foreground/[0.1] text-[10px] font-semibold uppercase tracking-widest hover:bg-foreground/[0.04]"
                      >
                        <Eye className="w-3.5 h-3.5" /> Show
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Homepage: add products */}
              {isHome && (
                <div className="space-y-2 pt-4">
                  <div className="text-[9px] font-bold uppercase tracking-widest text-foreground/45">Add products to the homepage</div>
                  <input
                    value={addSearch}
                    onChange={(e) => setAddSearch(e.target.value)}
                    placeholder="Search live products…"
                    className="w-full bg-background border border-foreground/[0.06] rounded-md px-3 py-2.5 text-[12px] outline-none"
                  />
                  <div className="grid sm:grid-cols-2 gap-2 max-h-[420px] overflow-y-auto pr-1">
                    {addable.slice(0, 80).map((p) => (
                      <button
                        key={p.id}
                        onClick={() => addToHome(p)}
                        className="flex items-center gap-3 rounded-lg border border-foreground/[0.06] px-3 py-2 text-left hover:bg-foreground/[0.03]"
                      >
                        <Thumb src={p.image} title={p.title} />
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-medium truncate">{p.title}</div>
                          <div className="text-[10px] text-foreground/40">{fmtPrice(p.price)}</div>
                        </div>
                        <Plus className="w-4 h-4 text-foreground/50 shrink-0" />
                      </button>
                    ))}
                    {addable.length === 0 && <div className="text-[11px] text-foreground/40 py-4">No more live products to add.</div>}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function PlacementButton({ p, active, onClick }: { p: PlacementInfo; active: boolean; onClick: () => void }) {
  const Icon = p.kind === "homepage" ? Home : p.kind === "shop-all" ? LayoutGrid : Layers;
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-[12px] transition-colors ${
        active ? "bg-foreground text-background font-medium" : "text-foreground/70 hover:bg-foreground/[0.04]"
      }`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate">{p.label}</span>
    </button>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      className="p-1.5 rounded text-foreground/40 hover:text-foreground hover:bg-foreground/[0.06]"
    >
      {children}
    </button>
  );
}
