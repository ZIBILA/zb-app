"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Search, Save, RefreshCw, CheckCircle, Loader2, Upload, X, Link as LinkIcon,
  Image as ImageIcon, Package, ChevronDown, ChevronRight, Info, Sparkles, ExternalLink,
  GripVertical
} from "lucide-react";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import { toast } from "sonner";
import NextImage from "next/image";

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  status: string;
  product_type: string;
  image: { src: string } | null;
  images: { id: number; src: string }[];
}

interface MoodBoardData {
  shopifyProductId: string;
  images: string; // JSON string array
}

export default function WebStoreProductsPage() {
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [moodBoards, setMoodBoards] = useState<Record<string, string[]>>({});
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [savingProduct, setSavingProduct] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<Record<string, 'idle' | 'success' | 'error'>>({});
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);

  // Load data
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [productsRes, moodBoardsRes] = await Promise.all([
        fetch("/api/shopify/products?pageSize=250"),
        fetch("/api/admin/mood-board"),
      ]);

      let loadedProducts: ShopifyProduct[] = [];
      if (productsRes.ok) {
        const data = await productsRes.json();
        loadedProducts = data.products || [];
      }

      if (moodBoardsRes.ok) {
        const boards: MoodBoardData[] = await moodBoardsRes.json();
        const map: Record<string, string[]> = {};
        boards.forEach((b) => {
          try {
            map[b.shopifyProductId] = JSON.parse(b.images);
          } catch {
            map[b.shopifyProductId] = [];
          }
        });
        setMoodBoards(map);
      }

      setProducts(loadedProducts);

    } catch (err) {
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  // Filter products by search
  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return products;
    const q = searchQuery.toLowerCase();
    return products.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.handle.toLowerCase().includes(q) ||
        p.product_type?.toLowerCase().includes(q) ||
        p.id.toString().includes(q)
    );
  }, [products, searchQuery]);

  // Get mood board images for a product
  const getMoodBoardImages = useCallback(
    (productId: string): string[] => {
      return moodBoards[productId] || [];
    },
    [moodBoards]
  );

  // Update local mood board state
  const updateLocalMoodBoard = (productId: string, images: string[]) => {
    setMoodBoards((prev) => ({ ...prev, [productId]: images.slice(0, 10) }));
  };

  // Add image to mood board
  const addImage = (productId: string, url: string) => {
    const current = getMoodBoardImages(productId);
    if (current.length >= 10) {
      toast.error("Maximum 10 images per mood board");
      return;
    }
    updateLocalMoodBoard(productId, [...current, url]);
  };

  // Remove image from mood board
  const removeImage = (productId: string, index: number) => {
    const current = getMoodBoardImages(productId);
    updateLocalMoodBoard(
      productId,
      current.filter((_, i) => i !== index)
    );
  };

  // Handle file upload for a specific slot
  const handleUpload = async (productId: string, slotIndex: number, file: File) => {
    const slotKey = `${productId}-${slotIndex}`;
    setUploadingSlot(slotKey);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.url) {
        const current = [...getMoodBoardImages(productId)];
        if (slotIndex >= current.length) {
          // Adding a new image
          current.push(data.url);
        } else {
          current[slotIndex] = data.url;
        }
        updateLocalMoodBoard(productId, current);
        toast.success("Image uploaded");
      } else {
        toast.error(data.error || "Upload failed");
      }
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploadingSlot(null);
    }
  };

  // Save mood board for a product
  const saveMoodBoard = async (productId: string) => {
    setSavingProduct(productId);
    setSaveStatus((prev) => ({ ...prev, [productId]: "idle" }));

    try {
      const images = getMoodBoardImages(productId).filter(Boolean);
      const res = await fetch("/api/admin/mood-board", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shopifyProductId: productId, images }),
      });

      if (!res.ok) throw new Error("Save failed");
      setSaveStatus((prev) => ({ ...prev, [productId]: "success" }));
      toast.success("Mood board saved");
    } catch {
      setSaveStatus((prev) => ({ ...prev, [productId]: "error" }));
      toast.error("Failed to save mood board");
    } finally {
      setSavingProduct(null);
      setTimeout(() => {
        setSaveStatus((prev) => ({ ...prev, [productId]: "idle" }));
      }, 3000);
    }
  };

  const productCount = products.length;
  const moodBoardCount = Object.values(moodBoards).filter(
    (imgs) => imgs.length > 0
  ).length;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="w-5 h-5 text-foreground/60 animate-spin" />
        <span className="text-[10px] font-medium uppercase tracking-widest text-foreground/60">
          Loading Products…
        </span>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="max-w-5xl mx-auto space-y-8 pb-20 relative z-10 px-4 md:px-0"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pt-4 relative z-10">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            All Products — Webstore Manager
          </h1>
          <p className="text-[11px] text-foreground/50 tracking-wide max-w-xl">
            Customize mood boards. Product order and visibility for the homepage, Shop All and collections is now in "Products & Order".
          </p>
        </div>
        <div className="flex items-center gap-3 text-[9px] font-semibold uppercase tracking-widest text-foreground/50">
          <span>{productCount} Products</span>
          <span className="text-foreground/20">•</span>
          <span>{moodBoardCount} Mood Boards</span>
        </div>
      </div>

      {/* Mood boards */}
      {(
        <div className="space-y-6">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search products by name, handle, type, or ID..."
              className="w-full bg-background pl-10 pr-4 py-3 rounded-xl border border-foreground/[0.06] focus:border-foreground/20 text-[12px] font-medium text-foreground placeholder:text-foreground/30 outline-none transition-all"
            />
          </div>

          {/* Info Banner */}
          <div className="px-4 py-3 bg-foreground/[0.02] rounded-xl border border-foreground/[0.05] flex items-center gap-3">
            <Info className="w-4 h-4 text-foreground/50 shrink-0" />
            <p className="text-[10px] font-medium text-foreground/50 uppercase tracking-widest">
              Click a product to expand and manage its mood board. Upload images or
              paste URLs. Up to 10 images per product.
            </p>
          </div>

          {/* Product List */}
          <div className="space-y-2">
            {filteredProducts.map((product) => {
              const productId = product.id.toString();
              const isExpanded = expandedProduct === productId;
              const images = getMoodBoardImages(productId);
              const hasMoodBoard = images.length > 0;
              const isSaving = savingProduct === productId;
              const status = saveStatus[productId] || "idle";

              return (
                <motion.div
                  key={product.id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="bg-background border border-foreground/[0.05] rounded-xl overflow-hidden shadow-sm"
                >
                  {/* Product Header Row */}
                  <button
                    onClick={() =>
                      setExpandedProduct(isExpanded ? null : productId)
                    }
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-foreground/[0.01] transition-colors text-left"
                  >
                    {/* Expand indicator */}
                    <div className="text-foreground/30 shrink-0">
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </div>

                    {/* Product image */}
                    <div className="relative w-10 h-10 rounded-md overflow-hidden border border-foreground/[0.06] bg-foreground/[0.02] shrink-0">
                      {product.image?.src || product.images?.[0]?.src ? (
                        <NextImage
                          src={
                            product.image?.src || product.images?.[0]?.src || ""
                          }
                          alt={product.title}
                          fill
                          className="object-cover"
                          sizes="40px"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Package className="w-4 h-4 text-foreground/15" />
                        </div>
                      )}
                    </div>

                    {/* Product info */}
                    <div className="min-w-0 flex-1">
                      <h4 className="text-[11px] font-semibold text-foreground truncate">
                        {product.title}
                      </h4>
                      <p className="text-[9px] text-foreground/45 font-mono truncate">
                        {product.handle} • ID: {product.id}
                      </p>
                    </div>

                    {/* Mood board status badge */}
                    <div className="shrink-0 flex items-center gap-2">
                      {hasMoodBoard ? (
                        <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-foreground/5 text-[8px] font-bold uppercase tracking-widest text-foreground/60">
                          <Sparkles className="w-2.5 h-2.5" />
                          {images.length} image{images.length > 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-full text-[8px] font-bold uppercase tracking-widest text-foreground/25">
                          No Mood Board
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Expanded: Mood Board Editor */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-5 pt-2 border-t border-foreground/[0.04]">
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                              <ImageIcon className="w-3.5 h-3.5 text-foreground/60" />
                              <span className="text-[9px] font-semibold uppercase tracking-widest text-foreground/50">
                                Mood Board Images ({images.length}/10)
                              </span>
                            </div>
                            <button
                              onClick={() => saveMoodBoard(productId)}
                              disabled={isSaving}
                              className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-[9px] font-medium tracking-[0.1em] uppercase transition-all ${
                                status === "success"
                                  ? "bg-green-500 text-white"
                                  : "bg-foreground text-background hover:opacity-90"
                              } disabled:opacity-50`}
                            >
                              {isSaving ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : status === "success" ? (
                                <CheckCircle className="w-3.5 h-3.5" />
                              ) : (
                                <Save className="w-3.5 h-3.5" />
                              )}
                              {isSaving
                                ? "Saving…"
                                : status === "success"
                                ? "Saved"
                                : "Save Mood Board"}
                            </button>
                          </div>

                          {/* Image Slots Grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                            {/* Existing images */}
                            {images.map((imgUrl, idx) => {
                              const slotKey = `${productId}-${idx}`;
                              const isUploadingThis = uploadingSlot === slotKey;

                              return (
                                <div
                                  key={idx}
                                  className="relative group rounded-lg overflow-hidden border border-foreground/[0.06] bg-foreground/[0.02] aspect-square"
                                >
                                  {imgUrl ? (
                                    <>
                                      <img
                                        src={imgUrl}
                                        alt={`Mood board ${idx + 1}`}
                                        className="w-full h-full object-cover"
                                      />
                                      {/* Remove button */}
                                      <button
                                        onClick={() =>
                                          removeImage(productId, idx)
                                        }
                                        className="absolute top-1.5 right-1.5 p-1 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                      {/* Slot number */}
                                      <span className="absolute bottom-1.5 left-1.5 text-[7px] font-bold text-white/70 bg-black/40 px-1.5 py-0.5 rounded">
                                        {idx + 1}
                                      </span>
                                    </>
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                      <ImageIcon className="w-5 h-5 text-foreground/15" />
                                    </div>
                                  )}

                                  {isUploadingThis && (
                                    <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                                      <Loader2 className="w-4 h-4 animate-spin text-foreground/60" />
                                    </div>
                                  )}
                                </div>
                              );
                            })}

                            {/* Add new image slot (if under 10) */}
                            {images.length < 10 && (
                              <div className="relative rounded-lg border-2 border-dashed border-foreground/[0.08] bg-foreground/[0.01] aspect-square flex flex-col items-center justify-center gap-2 hover:border-foreground/20 transition-colors group cursor-pointer">
                                <label className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer">
                                  <Upload className="w-4 h-4 text-foreground/30 group-hover:text-foreground/50 transition-colors" />
                                  <span className="text-[7px] font-bold uppercase tracking-widest text-foreground/30 group-hover:text-foreground/50 transition-colors mt-1">
                                    Upload
                                  </span>
                                  <input
                                    type="file"
                                    className="hidden"
                                    accept="image/*"
                                    onChange={(e) => {
                                      const file = e.target.files?.[0];
                                      if (file) {
                                        handleUpload(
                                          productId,
                                          images.length,
                                          file
                                        );
                                      }
                                      e.target.value = "";
                                    }}
                                  />
                                </label>
                              </div>
                            )}
                          </div>

                          {/* URL input for adding by link */}
                          {images.length < 10 && (
                            <div className="mt-3 flex gap-2">
                              <input
                                type="text"
                                placeholder="Paste image URL here and press Enter..."
                                className="flex-1 bg-foreground/[0.02] px-3 py-2 rounded-md border border-foreground/[0.06] focus:border-foreground/20 text-[11px] font-medium text-foreground placeholder:text-foreground/30 outline-none transition-colors"
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    const input = e.target as HTMLInputElement;
                                    const url = input.value.trim();
                                    if (url) {
                                      addImage(productId, url);
                                      input.value = "";
                                    }
                                  }
                                }}
                              />
                              <button
                                onClick={() => {
                                  const input = document.querySelector(
                                    `input[placeholder="Paste image URL here and press Enter..."]`
                                  ) as HTMLInputElement;
                                  if (input?.value.trim()) {
                                    addImage(productId, input.value.trim());
                                    input.value = "";
                                  }
                                }}
                                className="px-3 py-2 rounded-md bg-foreground/5 border border-foreground/[0.06] text-[9px] font-bold uppercase tracking-widest text-foreground/50 hover:text-foreground hover:bg-foreground/10 transition-colors shrink-0"
                              >
                                Add
                              </button>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>

          {/* Empty State */}
          {filteredProducts.length === 0 && (
            <div className="text-center py-16">
              <Package className="w-8 h-8 text-foreground/15 mx-auto mb-3" />
              <p className="text-[11px] font-semibold text-foreground/40 uppercase tracking-widest">
                {searchQuery ? "No products match your search" : "No products found"}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Footer status */}
      <div className="text-center pt-4">
        <div className="inline-flex items-center gap-2 px-4 py-2 border border-foreground/[0.05] rounded-md bg-background shadow-sm">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[9px] font-semibold uppercase tracking-widest text-foreground/50">
            Mood Board Management — Web Storefront Only
          </span>
        </div>
      </div>
    </motion.div>
  );
}
