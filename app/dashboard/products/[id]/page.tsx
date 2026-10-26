"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Save,
  Loader2,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Tag,
  Package,
  Layers,
  ArrowUpDown,
  Eye,
  EyeOff,
  Code,
  FileText,
} from "lucide-react";
import { formatProductDescription, stripHtmlTags } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface ShopifyVariant {
  id: number;
  title: string;
  price: string;
  compare_at_price: string | null;
  sku: string | null;
  barcode: string | null;
  inventory_item_id: number;
  inventory_quantity: number;
  option1: string | null;
  option2: string | null;
}

interface ShopifyMetafield {
  id: number;
  namespace: string;
  key: string;
  value: string;
  value_type?: string;
  description: string | null;
  owner_id?: number;
}

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  status: string;
  product_type: string;
  vendor: string;
  tags: string;
  image: { src: string } | null;
  images: { id: number; src: string }[];
  variants: ShopifyVariant[];
  metafields?: ShopifyMetafield[];
}

const SHOPIFY_DOMAIN =
  process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN || "8tiahf-bk.myshopify.com";

// Helper to convert Shopify Rich Text JSON to plain text for editing
function shopifyRichTextToPlainText(jsonStr: string): string {
  if (!jsonStr) return "";
  try {
    const data = JSON.parse(jsonStr);
    if (!data || data.type !== 'root') return jsonStr;
    
    const parseNodes = (nodes: any[]): string => {
      if (!nodes) return "";
      return nodes.map(node => {
        if (node.type === 'text') {
          return node.value || "";
        }
        if (node.type === 'paragraph') {
          return `${parseNodes(node.children)}\n`;
        }
        if (node.type === 'list') {
          return `${parseNodes(node.children)}`;
        }
        if (node.type === 'list-item') {
          return `• ${parseNodes(node.children)}\n`;
        }
        return parseNodes(node.children || []);
      }).join('');
    };

    return parseNodes(data.children).trim();
  } catch (e) {
    return jsonStr;
  }
}

// Helper to convert editable plain text back to Shopify Rich Text JSON
function plainTextToShopifyRichText(text: string): string {
  if (!text) return "";
  
  if (text.trim().startsWith('{') && text.trim().endsWith('}')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.type === 'root') {
        return text;
      }
    } catch (e) {
      // Fall through to standard parse
    }
  }

  const lines = text.split('\n');
  const children = lines.map(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*')) {
      const content = trimmed.substring(1).trim();
      return {
        type: 'list-item',
        children: [{ type: 'text', value: content }]
      };
    } else {
      return {
        type: 'paragraph',
        children: [{ type: 'text', value: line }]
      };
    }
  });

  const groupedChildren: any[] = [];
  let currentList: any = null;

  for (const child of children) {
    if (child.type === 'list-item') {
      if (!currentList) {
        currentList = {
          type: 'list',
          listType: 'unordered',
          children: []
        };
        groupedChildren.push(currentList);
      }
      currentList.children.push(child);
    } else {
      currentList = null;
      groupedChildren.push(child);
    }
  }

  return JSON.stringify({
    type: 'root',
    children: groupedChildren
  });
}

export default function ProductDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const productId = params.id;

  // State
  const [product, setProduct] = useState<ShopifyProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastType, setToastType] = useState<"success" | "error">("success");

  // Form Fields State
  const [title, setTitle] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [status, setStatus] = useState("active");
  const [productType, setProductType] = useState("");
  const [vendor, setVendor] = useState("");
  const [tags, setTags] = useState("");
  const [variants, setVariants] = useState<ShopifyVariant[]>([]);

  // Metafield States
  const [metaDetails, setMetaDetails] = useState("");
  const [metaSizeFit, setMetaSizeFit] = useState("");
  const [metaCare, setMetaCare] = useState("");
  const [metaShippingReturn, setMetaShippingReturn] = useState("");
  const [metaModelInfo, setMetaModelInfo] = useState("");

  // Tab Visibility States (true = show/visible, false = hide/hidden)
  const [showDescription, setShowDescription] = useState(true);
  const [showDetails, setShowDetails] = useState(true);
  const [showSizeFit, setShowSizeFit] = useState(true);
  const [showCare, setShowCare] = useState(true);
  const [showShippingReturn, setShowShippingReturn] = useState(true);

  // Description View Mode ("text" | "html")
  const [descMode, setDescMode] = useState<"text" | "html">("text");

  const loadProduct = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shopify/products/${productId}`);
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to load product");
      }
      if (data.product) {
        setProduct(data.product);
        initForm(data.product);
      } else {
        throw new Error("Product data not found");
      }
    } catch (err: any) {
      setError(err.message || "An unknown error occurred");
    } finally {
      setLoading(false);
    }
  };

  const initForm = (p: ShopifyProduct) => {
    setTitle(p.title || "");
    setBodyHtml(p.body_html || "");
    setStatus(p.status || "active");
    setProductType(p.product_type || "");
    setVendor(p.vendor || "");
    setTags(p.tags || "");
    setVariants(p.variants || []);

    const getMetaValue = (namespace: string, key: string) => {
      const found = p.metafields?.find(
        (m) => m.namespace === namespace && m.key === key
      );
      return found?.value || "";
    };

    setMetaDetails(shopifyRichTextToPlainText(getMetaValue("custom", "details")));
    setMetaSizeFit(shopifyRichTextToPlainText(getMetaValue("custom", "size_fit")));
    setMetaCare(shopifyRichTextToPlainText(getMetaValue("custom", "care")));
    setMetaShippingReturn(shopifyRichTextToPlainText(getMetaValue("custom", "shipping_return")));
    setMetaModelInfo(
      shopifyRichTextToPlainText(getMetaValue("custom", "model_info")) ||
        getMetaValue("custom", "model_info")
    );

    // Read visibility states from tags
    const tagsList = p.tags ? p.tags.split(',').map(t => t.trim().toLowerCase()) : [];
    setShowDescription(!tagsList.includes('hide:description'));
    setShowDetails(!tagsList.includes('hide:details'));
    setShowSizeFit(!tagsList.includes('hide:size_fit'));
    setShowCare(!tagsList.includes('hide:care'));
    setShowShippingReturn(!tagsList.includes('hide:shipping_return'));
  };

  useEffect(() => {
    if (productId) {
      loadProduct();
    }
  }, [productId]);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast(msg);
    setToastType(type);
    setTimeout(() => setToast(null), 4000);
  };

  const handleVariantChange = (
    index: number,
    field: keyof ShopifyVariant,
    value: string | number
  ) => {
    setVariants((prev) =>
      prev.map((v, i) => (i === index ? { ...v, [field]: value } : v))
    );
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      // Clean variants: ensure proper types before PATCH
      const formattedVariants = variants.map((v) => ({
        id: v.id,
        price: v.price,
        compare_at_price: v.compare_at_price === "" ? null : v.compare_at_price,
        sku: v.sku === "" ? null : v.sku,
        barcode: v.barcode === "" ? null : v.barcode,
        inventory_item_id: v.inventory_item_id,
        inventory_quantity: v.inventory_quantity,
      }));

      // Filter out any existing visibility tags from the user's manual tag list
      let cleanTags = tags
        .split(',')
        .map(t => t.trim())
        .filter(t => {
          const lower = t.toLowerCase();
          return !lower.startsWith('hide:');
        });

      if (!showDescription) cleanTags.push('hide:description');
      if (!showDetails) cleanTags.push('hide:details');
      if (!showSizeFit) cleanTags.push('hide:size_fit');
      if (!showCare) cleanTags.push('hide:care');
      if (!showShippingReturn) cleanTags.push('hide:shipping_return');

      const finalTagsString = cleanTags.filter(Boolean).join(', ');

      const res = await fetch(`/api/shopify/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body_html: bodyHtml,
          status,
          product_type: productType,
          vendor,
          tags: finalTagsString,
          variants: formattedVariants,
          metafields: {
            "custom.details": plainTextToShopifyRichText(metaDetails),
            "custom.size_fit": plainTextToShopifyRichText(metaSizeFit),
            "custom.care": plainTextToShopifyRichText(metaCare),
            "custom.shipping_return": plainTextToShopifyRichText(metaShippingReturn),
            "custom.model_info": metaModelInfo.trim(),
          },
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Update failed");
      }

      if (data.product) {
        setProduct(data.product);
        initForm(data.product);
      }
      showToast("Product synchronized successfully!");
    } catch (err: any) {
      showToast(err.message || "Failed to update product details", "error");
    } finally {
      setSaving(false);
    }
  };

  const stats = useMemo(() => {
    if (!variants.length) return { totalStock: 0 };
    return {
      totalStock: variants.reduce((acc, v) => acc + (Number(v.inventory_quantity) || 0), 0),
    };
  }, [variants]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[500px] gap-4">
        <Loader2 className="w-6 h-6 text-foreground/40 animate-spin" />
        <span className="text-[11px] font-medium uppercase tracking-widest text-foreground/40">
          Fetching product details...
        </span>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="max-w-xl mx-auto py-16 px-6 text-center space-y-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-rose-500/10 text-rose-500 border border-rose-500/20">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-bold text-foreground">Could not load product</h2>
          <p className="text-[12px] text-foreground/50">
            {error || "The requested product information was not found."}
          </p>
        </div>
        <Link
          href="/dashboard/products"
          className="glass-button inline-flex items-center gap-2 px-6 py-2.5 text-[11px] font-medium !rounded-xl"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Products
        </Link>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="pb-24 space-y-6 relative z-10"
    >
      {/* Toast Alert */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: -20, x: "-50%" }}
            className={`fixed top-6 left-1/2 z-50 glass-panel px-6 py-3 text-[11px] font-semibold flex items-center gap-2.5 shadow-2xl !rounded-full ${
              toastType === "error"
                ? "!border-rose-500/20 text-rose-500"
                : "!border-emerald-500/20 text-foreground"
            }`}
          >
            {toastType === "error" ? (
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
            ) : (
              <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
            )}
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header Panel */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-foreground/[0.04] pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <Link
              href="/dashboard/products"
              className="p-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 transition-colors text-foreground/60 hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="text-xl font-semibold text-foreground tracking-tight truncate max-w-lg">
              {product.title}
            </h1>
          </div>
          <p className="text-[11px] font-medium text-foreground/40 pl-11">
            Product ID: {product.id} · Total Stock: {stats.totalStock} units
          </p>
        </div>

        <div className="flex items-center gap-2.5 pl-11 md:pl-0">
          <a
            href={`https://${SHOPIFY_DOMAIN}/admin/products/${product.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="glass-button flex items-center gap-2 px-4 py-2.5 text-[11px] font-medium !rounded-xl text-foreground/60 hover:text-foreground"
            title="Open in Shopify Admin"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Shopify
          </a>
          <button
            onClick={handleSave}
            disabled={saving}
            className="glass-button flex items-center gap-2 px-5 py-2.5 text-[11px] font-semibold !rounded-xl !bg-foreground !text-background disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Columns (Product Details Form) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Main Info Card */}
          <div className="glass-panel !rounded-2xl p-6 space-y-5">
            <h2 className="text-[12px] font-bold uppercase tracking-[0.25em] text-foreground/45 flex items-center gap-2">
              <Package className="w-4 h-4" /> Product Details
            </h2>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Heavyweight Oversized Tee"
                  className="w-full bg-foreground/5 px-4 py-3 rounded-xl border border-foreground/5 focus:border-foreground/20 text-left text-[13px] font-medium text-foreground outline-none transition-all duration-300"
                />
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">
                      Description
                    </label>
                    {/* Mode Selector: Text View vs HTML View */}
                    <div className="flex items-center bg-foreground/5 p-0.5 rounded-lg border border-foreground/5">
                      <button
                        type="button"
                        onClick={() => setDescMode("text")}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all duration-200 ${
                          descMode === "text"
                            ? "bg-foreground text-background shadow-sm"
                            : "text-foreground/50 hover:text-foreground"
                        }`}
                      >
                        <FileText className="w-3 h-3" /> Text View
                      </button>
                      <button
                        type="button"
                        onClick={() => setDescMode("html")}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all duration-200 ${
                          descMode === "html"
                            ? "bg-foreground text-background shadow-sm"
                            : "text-foreground/50 hover:text-foreground"
                        }`}
                      >
                        <Code className="w-3 h-3" /> HTML View
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowDescription(!showDescription)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all duration-300 ${
                      showDescription
                        ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                        : "bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
                    }`}
                  >
                    {showDescription ? (
                      <>
                        <Eye className="w-3.5 h-3.5" /> Visible on Webstore
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-3.5 h-3.5" /> Hidden on Webstore
                      </>
                    )}
                  </button>
                </div>

                {descMode === "text" ? (
                  <div className="space-y-3">
                    {/* Rendered Text View Preview */}
                    <div className="w-full bg-foreground/[0.03] p-4 rounded-xl border border-foreground/10 space-y-2">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-foreground/40 mb-1 flex items-center justify-between">
                        <span>Formatted Text View (As shown in Shopify & Webstore)</span>
                        <span className="text-[9px] font-normal text-emerald-500 dark:text-emerald-400">Live Preview</span>
                      </div>
                      <div 
                        className="text-[13px] leading-relaxed text-foreground/90 font-sans space-y-2 [&_p]:mb-2 [&_b]:font-bold [&_strong]:font-bold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1"
                        dangerouslySetInnerHTML={{ __html: formatProductDescription(bodyHtml) || "<p className='italic text-foreground/40'>No description content provided.</p>" }}
                      />
                    </div>

                    {/* Plain Text Editor */}
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold uppercase tracking-wider text-foreground/40">
                        Edit Plain Text Content
                      </label>
                      <textarea
                        value={stripHtmlTags(bodyHtml)}
                        onChange={(e) => setBodyHtml(formatProductDescription(e.target.value))}
                        placeholder="Type or edit plain product description text..."
                        rows={6}
                        className="w-full bg-foreground/5 px-4 py-3 rounded-xl border border-foreground/5 focus:border-foreground/20 text-left text-[13px] font-medium text-foreground outline-none transition-all duration-300 min-h-[140px] font-sans resize-y"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold uppercase tracking-wider text-foreground/40">
                      HTML Source Code
                    </label>
                    <textarea
                      value={bodyHtml}
                      onChange={(e) => setBodyHtml(e.target.value)}
                      placeholder="<p>A refined take on modern denim layering...</p>"
                      rows={8}
                      className="w-full bg-foreground/5 px-4 py-3 rounded-xl border border-foreground/5 focus:border-foreground/20 text-left text-[12px] font-mono text-foreground outline-none transition-all duration-300 min-h-[180px] resize-y"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Storefront Tabs Metafields Card */}
          <div className="glass-panel !rounded-2xl p-6 space-y-5">
            <h2 className="text-[12px] font-bold uppercase tracking-[0.25em] text-foreground/45 flex items-center gap-2">
              <Tag className="w-4 h-4" /> Storefront Tabs (Metafields)
            </h2>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40 flex items-center gap-1.5">
                    Details <span className="text-[9px] font-normal text-foreground/30 capitalize">(custom.details)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowDetails(!showDetails)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all duration-300 ${
                      showDetails
                        ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                        : "bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
                    }`}
                  >
                    {showDetails ? (
                      <>
                        <Eye className="w-3.5 h-3.5" /> Visible
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-3.5 h-3.5" /> Hidden
                      </>
                    )}
                  </button>
                </div>
                <textarea
                  value={metaDetails}
                  onChange={(e) => setMetaDetails(e.target.value)}
                  placeholder="Specific product specifications, fabric weight, composition, etc."
                  rows={3}
                  className="w-full bg-foreground/5 px-4 py-3 rounded-xl border border-foreground/5 focus:border-foreground/20 text-left text-[13px] font-medium text-foreground outline-none transition-all duration-300 font-sans resize-y"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40 flex items-center gap-1.5">
                  Model / fit line <span className="text-[9px] font-normal text-foreground/30 capitalize">(custom.model_info)</span>
                </label>
                <input
                  value={metaModelInfo}
                  onChange={(e) => setMetaModelInfo(e.target.value)}
                  placeholder={`e.g. Model is 6'0", wearing size 32 · Oversized fit, true to waist`}
                  className="w-full bg-foreground/5 px-4 py-3 rounded-xl border border-foreground/5 focus:border-foreground/20 text-left text-[13px] font-medium text-foreground outline-none transition-all duration-300 font-sans"
                />
                <p className="text-[9px] text-foreground/30">
                  Shown under size pills on the app PDP. Leave blank to use the theme default from App Integration → Product Page.
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40 flex items-center gap-1.5">
                    Size & Fit <span className="text-[9px] font-normal text-foreground/30 capitalize">(custom.size_fit)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowSizeFit(!showSizeFit)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all duration-300 ${
                      showSizeFit
                        ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                        : "bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
                    }`}
                  >
                    {showSizeFit ? (
                      <>
                        <Eye className="w-3.5 h-3.5" /> Visible
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-3.5 h-3.5" /> Hidden
                      </>
                    )}
                  </button>
                </div>
                <textarea
                  value={metaSizeFit}
                  onChange={(e) => setMetaSizeFit(e.target.value)}
                  placeholder="Fit guidelines, height/size reference of model, measurements."
                  rows={3}
                  className="w-full bg-foreground/5 px-4 py-3 rounded-xl border border-foreground/5 focus:border-foreground/20 text-left text-[13px] font-medium text-foreground outline-none transition-all duration-300 font-sans resize-y"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40 flex items-center gap-1.5">
                    Care <span className="text-[9px] font-normal text-foreground/30 capitalize">(custom.care)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowCare(!showCare)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all duration-300 ${
                      showCare
                        ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                        : "bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
                    }`}
                  >
                    {showCare ? (
                      <>
                        <Eye className="w-3.5 h-3.5" /> Visible
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-3.5 h-3.5" /> Hidden
                      </>
                    )}
                  </button>
                </div>
                <textarea
                  value={metaCare}
                  onChange={(e) => setMetaCare(e.target.value)}
                  placeholder="Washing instructions, drying, ironing advice."
                  rows={3}
                  className="w-full bg-foreground/5 px-4 py-3 rounded-xl border border-foreground/5 focus:border-foreground/20 text-left text-[13px] font-medium text-foreground outline-none transition-all duration-300 font-sans resize-y"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40 flex items-center gap-1.5">
                    Shipping & Return <span className="text-[9px] font-normal text-foreground/30 capitalize">(custom.shipping_return)</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowShippingReturn(!showShippingReturn)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all duration-300 ${
                      showShippingReturn
                        ? "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                        : "bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
                    }`}
                  >
                    {showShippingReturn ? (
                      <>
                        <Eye className="w-3.5 h-3.5" /> Visible
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-3.5 h-3.5" /> Hidden
                      </>
                    )}
                  </button>
                </div>
                <textarea
                  value={metaShippingReturn}
                  onChange={(e) => setMetaShippingReturn(e.target.value)}
                  placeholder="Delivery times, refund and exchange policy summaries."
                  rows={3}
                  className="w-full bg-foreground/5 px-4 py-3 rounded-xl border border-foreground/5 focus:border-foreground/20 text-left text-[13px] font-medium text-foreground outline-none transition-all duration-300 font-sans resize-y"
                />
              </div>
            </div>
          </div>

          {/* Variants Management Card */}
          <div className="glass-panel !rounded-2xl p-6 space-y-5">
            <h2 className="text-[12px] font-bold uppercase tracking-[0.25em] text-foreground/45 flex items-center gap-2">
              <Layers className="w-4 h-4" /> Pricing & Inventory (Variants)
            </h2>

            <div className="space-y-5">
              {variants.map((variant, idx) => (
                <div
                  key={variant.id}
                  className="p-4 rounded-xl border border-foreground/[0.04] bg-foreground/[0.01] space-y-4"
                >
                  <div className="flex items-center justify-between border-b border-foreground/[0.04] pb-2">
                    <span className="text-[12px] font-semibold text-foreground">
                      {variant.title === "Default Title" ? "Single Variant" : variant.title}
                    </span>
                    <span className="text-[9px] font-mono text-foreground/30">
                      ID: {variant.id}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold uppercase tracking-wider text-foreground/40">
                        Price (₹)
                      </label>
                      <input
                        type="text"
                        value={variant.price}
                        onChange={(e) => handleVariantChange(idx, "price", e.target.value)}
                        placeholder="1999.00"
                        className="w-full bg-foreground/5 px-3 py-2 rounded-lg border border-foreground/5 focus:border-foreground/20 text-left text-[12px] font-semibold text-foreground outline-none font-mono"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] font-bold uppercase tracking-wider text-foreground/40">
                        Compare Price (₹)
                      </label>
                      <input
                        type="text"
                        value={variant.compare_at_price || ""}
                        onChange={(e) =>
                          handleVariantChange(idx, "compare_at_price", e.target.value)
                        }
                        placeholder="2999.00"
                        className="w-full bg-foreground/5 px-3 py-2 rounded-lg border border-foreground/5 focus:border-foreground/20 text-left text-[12px] font-semibold text-foreground outline-none font-mono"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] font-bold uppercase tracking-wider text-foreground/40">
                        SKU
                      </label>
                      <input
                        type="text"
                        value={variant.sku || ""}
                        onChange={(e) => handleVariantChange(idx, "sku", e.target.value)}
                        placeholder="ZB-TEE-BLK-S"
                        className="w-full bg-foreground/5 px-3 py-2 rounded-lg border border-foreground/5 focus:border-foreground/20 text-left text-[12px] font-semibold text-foreground outline-none font-mono"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] font-bold uppercase tracking-wider text-foreground/40">
                        Barcode
                      </label>
                      <input
                        type="text"
                        value={variant.barcode || ""}
                        onChange={(e) => handleVariantChange(idx, "barcode", e.target.value)}
                        placeholder="8901234567"
                        className="w-full bg-foreground/5 px-3 py-2 rounded-lg border border-foreground/5 focus:border-foreground/20 text-left text-[12px] font-semibold text-foreground outline-none font-mono"
                      />
                    </div>

                    <div className="space-y-1 col-span-2 sm:col-span-1">
                      <label className="text-[9px] font-bold uppercase tracking-wider text-foreground/40">
                        Inventory (Stock)
                      </label>
                      <input
                        type="number"
                        value={variant.inventory_quantity}
                        onChange={(e) =>
                          handleVariantChange(
                            idx,
                            "inventory_quantity",
                            parseInt(e.target.value, 10) || 0
                          )
                        }
                        placeholder="45"
                        className="w-full bg-foreground/5 px-3 py-2 rounded-lg border border-foreground/5 focus:border-foreground/20 text-left text-[12px] font-semibold text-foreground outline-none font-mono"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column (Categorization / Images) */}
        <div className="space-y-6">
          {/* Status & Organization */}
          <div className="glass-panel !rounded-2xl p-6 space-y-5">
            <h2 className="text-[12px] font-bold uppercase tracking-[0.25em] text-foreground/45 flex items-center gap-2">
              <Tag className="w-4 h-4" /> Classification
            </h2>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">
                  Status
                </label>
                <div className="relative">
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full bg-foreground/5 px-4 py-3 rounded-xl border border-foreground/5 focus:border-foreground/20 text-left text-[13px] font-medium text-foreground outline-none transition-all duration-300 appearance-none cursor-pointer capitalize"
                  >
                    <option value="active" className="text-black bg-white">
                      Active
                    </option>
                    <option value="draft" className="text-black bg-white">
                      Draft
                    </option>
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-foreground/30 pointer-events-none">
                    <ArrowUpDown className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">
                  Product Type
                </label>
                <input
                  type="text"
                  value={productType}
                  onChange={(e) => setProductType(e.target.value)}
                  placeholder="T-Shirt"
                  className="w-full bg-foreground/5 px-4 py-3 rounded-xl border border-foreground/5 focus:border-foreground/20 text-left text-[13px] font-medium text-foreground outline-none transition-all duration-300"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">
                  Vendor
                </label>
                <input
                  type="text"
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                  placeholder="Zica Bella"
                  className="w-full bg-foreground/5 px-4 py-3 rounded-xl border border-foreground/5 focus:border-foreground/20 text-left text-[13px] font-medium text-foreground outline-none transition-all duration-300"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">
                  Tags (Comma separated)
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="Oversized, Vintage, Drop Shoulder"
                  className="w-full bg-foreground/5 px-4 py-3 rounded-xl border border-foreground/5 focus:border-foreground/20 text-left text-[13px] font-medium text-foreground outline-none transition-all duration-300"
                />
              </div>
            </div>
          </div>

          {/* Product Media */}
          {product.images && product.images.length > 0 && (
            <div className="glass-panel !rounded-2xl p-6 space-y-4">
              <h2 className="text-[12px] font-bold uppercase tracking-[0.25em] text-foreground/45 flex items-center gap-2">
                <Layers className="w-4 h-4" /> Media Gallery ({product.images.length})
              </h2>

              <div className="grid grid-cols-3 gap-2.5">
                {product.images.map((img) => (
                  <div
                    key={img.id}
                    className="aspect-square rounded-lg border border-foreground/[0.06] overflow-hidden bg-foreground/[0.02] flex items-center justify-center relative group"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.src}
                      alt="Product Media"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
