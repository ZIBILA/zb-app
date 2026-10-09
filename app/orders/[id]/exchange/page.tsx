"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  ChevronLeft, 
  CheckCircle2, 
  Loader2,
  ArrowLeftRight,
  AlertCircle,
  Search,
  X,
  Plus
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

export default function ExchangeRequestPage() {
  const { id } = useParams();
  const { data: session, status } = useSession();
  const router = useRouter();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [replacements, setReplacements] = useState<Record<string, any>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Product selector modal state
  const [showSelector, setShowSelector] = useState(false);
  const [selectingForItemId, setSelectingForItemId] = useState<string | null>(null);
  const [products, setProducts] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [selectedSize, setSelectedSize] = useState("M");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push(`/login?callbackUrl=/orders/${id}/exchange`);
    }
  }, [status, router, id]);

  useEffect(() => {
    fetchOrder();
  }, [id]);

  const fetchOrder = async () => {
    try {
      const res = await fetch(`/api/orders/${id}`);
      if (res.status === 401) {
        router.push(`/login?callbackUrl=/orders/${id}/exchange`);
        return;
      }
      const data = await res.json();
      if (res.ok) setOrder(data.order);
    } catch (e) {
      console.error("Error fetching order", e);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = (itemId: string) => {
    const newSet = new Set(selectedItems);
    if (newSet.has(itemId)) {
      newSet.delete(itemId);
    } else {
      newSet.add(itemId);
    }
    setSelectedItems(newSet);
  };

  const openProductSelector = async (itemId: string) => {
    setSelectingForItemId(itemId);
    setShowSelector(true);
    setSelectedProduct(null);
    setSearchQuery("");

    const originalItem = order.items.find((i: any) => i.id === itemId);
    if (originalItem?.size) {
      setSelectedSize(originalItem.size);
    } else {
      setSelectedSize('M');
    }

    if (products.length === 0) {
      setLoadingProducts(true);
      try {
        const res = await fetch("/api/app/products?limit=100");
        const data = await res.json();
        if (res.ok && data.products) setProducts(data.products);
      } catch (err) {
        console.error("Failed to fetch products", err);
      } finally {
        setLoadingProducts(false);
      }
    }
  };

  const confirmSelection = () => {
    if (!selectedProduct || !selectingForItemId) return;
    const itemImage = selectedProduct.image || selectedProduct.images?.[0] || null;
    setReplacements(prev => ({
      ...prev,
      [selectingForItemId]: {
        id: selectedProduct.id,
        title: `${selectedProduct.title} - ${selectedSize}`,
        price: selectedProduct.price,
        size: selectedSize,
        image: itemImage,
        images: selectedProduct.images || (itemImage ? [itemImage] : [])
      }
    }));
    setShowSelector(false);
    setSelectingForItemId(null);
    setSelectedProduct(null);
  };

  const priceDifference = Array.from(selectedItems).reduce((diff, itemId) => {
    const originalItem = order?.items?.find((i: any) => i.id === itemId);
    const replacement = replacements[itemId];
    if (originalItem && replacement) {
      diff += (replacement.price - originalItem.price) * originalItem.quantity;
    }
    return diff;
  }, 0);

  const [settlementPreference, setSettlementPreference] = useState<"PREPAID_NOW" | "COD_ON_DELIVERY">("PREPAID_NOW");

  const submitExchangeRequest = async (
    razorpayResponse: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string } | null = null,
    paymentMethod: string = 'cod'
  ) => {
    const exchangeItemsPayload = Array.from(selectedItems).map(itemId => {
      const item = order.items.find((i: any) => i.id === itemId);
      const rep = replacements[itemId];
      return {
        orderItemId: itemId,
        quantity: item.quantity,
        replacementProductId: rep.id,
        replacementVariant: { size: rep.size || 'M', color: rep.color || 'Black' }
      };
    });

    const res = await fetch("/api/exchanges/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: order.id,
        exchangeItems: exchangeItemsPayload,
        settlementPreference,
        // The server recalculates the price difference and verifies this payment with Razorpay.
        paymentDetails: {
          razorpayPaymentId: razorpayResponse?.razorpay_payment_id || null,
          razorpayOrderId: razorpayResponse?.razorpay_order_id || null,
          razorpaySignature: razorpayResponse?.razorpay_signature || null,
          paymentMethod: settlementPreference === 'COD_ON_DELIVERY' ? 'cod' : 'razorpay'
        }
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to submit exchange request");

    setSuccess(true);
    setTimeout(() => router.push(`/orders/${id}`), 2000);
  };

  const handleSubmit = async () => {
    if (selectedItems.size === 0) {
      setError("Please select at least one item to exchange");
      return;
    }
    for (const itemId of selectedItems) {
      if (!replacements[itemId]) {
        setError("Please select a replacement for all selected items");
        return;
      }
    }

    setIsSubmitting(true);
    setError("");

    try {
      if (priceDifference > 0 && settlementPreference === "PREPAID_NOW") {
        // Clean and normalize phone helper
        const cleanAndNormalizePhone = (phoneStr: string) => {
          const digits = phoneStr.replace(/\D/g, "");
          const baseNumber = digits.slice(-10);
          if (baseNumber.length === 10) {
            return `+91${baseNumber}`;
          }
          return phoneStr;
        };

        const finalPhone = cleanAndNormalizePhone((session as any)?.customer?.phone || (session?.user as any)?.phone || order?.customer?.phone || "");
        const finalEmail = (session?.user?.email || order?.customer?.email || "").trim();
        const finalName = (session?.user?.name || order?.customer?.name || "Zica Customer").trim();

        console.log("[Razorpay Exchange Prefill]", {
          userId: (session?.user as any)?.id || "guest",
          name: finalName,
          phone: finalPhone,
          email: finalEmail || "OMITTED (missing/empty)"
        });

        const payRes = await fetch("/api/checkout/razorpay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: priceDifference,
            notes: {
              contact: finalPhone,
              email: finalEmail || undefined,
              name: finalName,
            }
          }),
        });

        const orderData = await payRes.json();
        if (!payRes.ok) throw new Error(orderData.error || "Failed to initiate payment");

        const isMobile = /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent);

        const options: any = {
          key: orderData.keyId,
          amount: orderData.amount,
          currency: "INR",
          name: "Zica Bella",
          description: "Exchange Price Difference",
          order_id: orderData.id,
          handler: async function (response: any) {
            try {
              await submitExchangeRequest(
                {
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_signature: response.razorpay_signature,
                },
                "razorpay"
              );
            } catch (err: any) {
              setError(err.message || "Exchange submission failed. Contact support.");
              setIsSubmitting(false);
            }
          },
          prefill: {
            name: finalName,
            contact: finalPhone,
          },
          modal: {
            ondismiss: function () {
              setIsSubmitting(false);
            }
          },
          theme: {
            color: "#000000",
          },
          config: {
            display: {
              blocks: {
                upi: {
                  name: "Pay using UPI",
                  instruments: [
                    {
                      method: "upi",
                      flows: isMobile ? ["intent"] : ["qr", "collect"],
                    }
                  ]
                }
              },
              sequence: ["block.upi"],
              preferences: {
                show_default_blocks: true
              }
            }
          }
        };

        if (finalEmail && /^[^@]+@[^@]+\.[^@]+$/.test(finalEmail)) {
          options.prefill.email = finalEmail;
        }

        const rzp = new (window as any).Razorpay(options);
        rzp.open();
      } else {
        await submitExchangeRequest(null, settlementPreference === 'COD_ON_DELIVERY' ? 'cod' : 'free');
      }
    } catch (err: any) {
      setError(err.message || "An error occurred");
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-5 h-5 animate-spin text-foreground/20" />
        <p className="text-[8px] text-foreground/30 font-black uppercase tracking-[0.3em]">Loading</p>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 text-center px-6">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 200 }}>
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
        </motion.div>
        <h2 className="text-[14px] font-bold text-foreground uppercase tracking-wider">Exchange Request Submitted</h2>
        <p className="text-[10px] text-foreground/50">We'll review your request and get back to you within 24-48 hours.</p>
        <Link href={`/orders/${id}`} className="glass-cta px-8 py-3 text-[9px] mt-4">Back to Order</Link>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 text-center px-6">
        <AlertCircle className="w-8 h-8 text-red-500/50" />
        <p className="text-[11px] text-foreground/60">Order not found</p>
        <Link href="/orders" className="glass-cta px-8 py-3 text-[9px]">Back to Orders</Link>
      </div>
    );
  }

  const filteredProducts = products.filter(p => 
    p.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="max-w-2xl mx-auto px-4 pt-28 pb-40">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link href={`/orders/${id}`} className="group flex items-center gap-2 p-2 -ml-2 rounded-full hover:bg-foreground/5 transition-colors">
            <ChevronLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
          </Link>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-foreground">Request Exchange</h1>
            <p className="text-[11px] text-foreground/40 font-medium">Select items and choose replacements from our catalog.</p>
          </div>
        </div>

        {/* Items */}
        <div className="space-y-4">
          {order.items?.map((item: any) => {
            const isSelected = selectedItems.has(item.id);
            const imgUrl = item.image || item.product?.featuredImage;
            const rep = replacements[item.id];
            return (
              <motion.div 
                key={item.id} 
                layout
                className={`rounded-2xl glass-panel overflow-hidden transition-all ${isSelected ? 'ring-2 ring-foreground/30' : ''}`}
              >
                {/* Item row */}
                <button
                  onClick={() => toggleSelection(item.id)}
                  className="w-full flex items-center gap-4 p-4 text-left"
                >
                  {/* Checkbox */}
                  <div className={`w-5 h-5 rounded-full border-[1.5px] flex items-center justify-center shrink-0 transition-all ${
                    isSelected ? 'bg-foreground border-foreground' : 'border-foreground/20'
                  }`}>
                    {isSelected && <CheckCircle2 className="w-3 h-3 text-background" />}
                  </div>

                  {/* Image */}
                  <div className="w-12 h-12 rounded-xl overflow-hidden bg-foreground/5 shrink-0">
                    {imgUrl ? (
                      <img src={imgUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-foreground/20 text-[14px] font-bold">{item.title[0]}</div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-foreground/80 truncate">{item.title}</p>
                    <p className="text-[10px] text-foreground/40 mt-0.5">Qty: {item.quantity} · ₹{item.price.toLocaleString('en-IN')}</p>
                  </div>
                </button>

                {/* Replacement section */}
                <AnimatePresence>
                  {isSelected && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }} 
                      animate={{ height: "auto", opacity: 1 }} 
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 pt-2 border-t border-foreground/5">
                        <p className="text-[10px] font-bold text-foreground/60 mb-3 uppercase tracking-wider">Replacement Product</p>

                        {rep ? (
                          <div className="flex items-center gap-3 p-3 rounded-xl bg-foreground/[0.03] border border-foreground/5">
                            <div className="w-10 h-10 rounded-lg overflow-hidden bg-foreground/5">
                              {rep.images?.[0] ? (
                                <img src={rep.images[0]} alt="" className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-foreground/20">?</div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-bold text-foreground/80 truncate">{rep.title}</p>
                              <p className="text-[9px] text-foreground/40">₹{rep.price.toLocaleString('en-IN')}</p>
                            </div>
                            <button
                              onClick={() => openProductSelector(item.id)}
                              className="px-3 py-1 rounded-lg glass-button text-[8px] font-bold uppercase tracking-wider"
                            >
                              Change
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => openProductSelector(item.id)}
                            className="w-full p-4 rounded-xl border border-dashed border-foreground/10 text-center flex items-center justify-center gap-2 text-foreground/40 hover:text-foreground/60 hover:border-foreground/20 transition-all"
                          >
                            <Plus className="w-4 h-4" />
                            <span className="text-[11px] font-bold">Select Replacement</span>
                          </button>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>

        {/* Error */}
        {error && (
          <div className="mt-6 flex items-center gap-2 p-3.5 rounded-xl text-[10px] font-bold bg-red-500/5 border border-red-500/15 text-red-500">
            <AlertCircle className="w-3.5 h-3.5" />
            {error}
          </div>
        )}
      </main>

      {/* Fixed Bottom Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 glass border-t border-foreground/5 px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="max-w-2xl mx-auto">
          {priceDifference > 0 && (
            <div className="mb-3 space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/50">Settlement Option for Difference</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSettlementPreference("PREPAID_NOW")}
                  className={`flex-1 py-2 rounded-xl text-[10px] font-bold border transition-all ${
                    settlementPreference === "PREPAID_NOW"
                      ? "bg-foreground text-background border-foreground"
                      : "border-foreground/10 text-foreground/50 hover:border-foreground/20"
                  }`}
                >
                  Pay Now (Prepaid)
                </button>
                <button
                  type="button"
                  onClick={() => setSettlementPreference("COD_ON_DELIVERY")}
                  className={`flex-1 py-2 rounded-xl text-[10px] font-bold border transition-all ${
                    settlementPreference === "COD_ON_DELIVERY"
                      ? "bg-foreground text-background border-foreground"
                      : "border-foreground/10 text-foreground/50 hover:border-foreground/20"
                  }`}
                >
                  Pay on Delivery (COD)
                </button>
              </div>
            </div>
          )}
          <div className="flex justify-between items-center mb-3">
            <span className="text-[11px] text-foreground/50 font-medium">
              {priceDifference > 0 ? "Additional Payment" : priceDifference < 0 ? "Refund Credit" : "Price Difference"}
            </span>
            <span className={`text-lg font-bold ${priceDifference > 0 ? 'text-red-500' : priceDifference < 0 ? 'text-emerald-500' : 'text-foreground'}`}>
              {priceDifference > 0 ? '+' : ''}₹{Math.abs(priceDifference).toLocaleString('en-IN')}
            </span>
          </div>
          <button
            onClick={handleSubmit}
            disabled={selectedItems.size === 0 || isSubmitting}
            className="glass-cta w-full py-4 text-[11px] flex items-center justify-center gap-2 disabled:opacity-30"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <ArrowLeftRight className="w-4 h-4" />
                {priceDifference > 0 ? (settlementPreference === "PREPAID_NOW" ? 'Proceed to Payment' : 'Submit COD Exchange Request') : 'Submit Exchange Request'}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Product Selector Modal */}
      <AnimatePresence>
        {showSelector && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm"
              onClick={() => { setShowSelector(false); setSelectedProduct(null); }}
            />
            <motion.div 
              initial={{ y: "100%" }} 
              animate={{ y: 0 }} 
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed inset-x-0 bottom-0 z-[90] max-h-[85vh] flex flex-col rounded-t-3xl glass overflow-hidden"
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-foreground/5">
                <div>
                  <h3 className="text-[14px] font-bold text-foreground">Choose Replacement</h3>
                  <p className="text-[10px] text-foreground/40 mt-0.5">Select a product from our live catalog</p>
                </div>
                <button 
                  onClick={() => { setShowSelector(false); setSelectedProduct(null); }}
                  className="w-8 h-8 rounded-full bg-foreground/5 flex items-center justify-center hover:bg-foreground/10 transition-colors"
                >
                  <X className="w-4 h-4 text-foreground/50" />
                </button>
              </div>

              {/* Search */}
              <div className="px-5 py-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
                  <input
                    type="text"
                    placeholder="Search products..."
                    className="glass-input w-full pl-10 pr-4 py-3 text-[12px]"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                      <X className="w-3.5 h-3.5 text-foreground/30" />
                    </button>
                  )}
                </div>
              </div>

              {/* Selected product detail */}
              {selectedProduct && (
                <div className="px-5 pb-3">
                  <div className="p-4 rounded-2xl glass-panel border-foreground/20">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-12 h-12 rounded-xl overflow-hidden bg-foreground/5">
                        {selectedProduct.image || selectedProduct.images?.[0] ? (
                          <img src={selectedProduct.image || selectedProduct.images[0]} alt="" className="w-full h-full object-cover" />
                        ) : null}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-bold text-foreground/80 truncate">{selectedProduct.title}</p>
                        <p className="text-[11px] font-bold text-foreground/60">₹{selectedProduct.price?.toLocaleString('en-IN')}</p>
                      </div>
                    </div>

                    <p className="text-[9px] font-bold text-foreground/50 mb-2 uppercase tracking-wider">Choose Size</p>
                    <div className="flex gap-2 mb-3">
                      {SIZES.map(sz => (
                        <button
                          key={sz}
                          onClick={() => setSelectedSize(sz)}
                          className={`w-10 h-9 rounded-xl text-[10px] font-bold border transition-all ${
                            selectedSize === sz
                              ? 'bg-foreground text-background border-foreground'
                              : 'border-foreground/10 text-foreground/50 hover:border-foreground/20'
                          }`}
                        >
                          {sz}
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={confirmSelection}
                      className="glass-cta w-full py-3 text-[10px]"
                    >
                      Confirm Selection
                    </button>
                  </div>
                </div>
              )}

              {/* Product List */}
              <div className="flex-1 overflow-y-auto px-5 pb-8">
                {loadingProducts ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <Loader2 className="w-5 h-5 animate-spin text-foreground/20" />
                    <p className="text-[9px] text-foreground/30">Loading catalog...</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredProducts.map(product => {
                      const isSelected = selectedProduct?.id === product.id;
                      const pImage = product.image || product.images?.[0];
                      return (
                        <button
                          key={product.id}
                          onClick={() => setSelectedProduct(product)}
                          className={`w-full flex items-center gap-3 p-3 rounded-2xl text-left transition-all ${
                            isSelected ? 'glass-panel ring-2 ring-foreground/20' : 'hover:bg-foreground/[0.02]'
                          }`}
                        >
                          <div className="w-12 h-12 rounded-xl overflow-hidden bg-foreground/5 shrink-0">
                            {pImage ? (
                              <img src={pImage} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-foreground/20 text-sm font-bold">{product.title[0]}</div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-bold text-foreground/80 truncate">{product.title}</p>
                            <p className="text-[10px] font-bold text-foreground/50">₹{product.price?.toLocaleString('en-IN')}</p>
                          </div>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                            isSelected ? 'border-foreground' : 'border-foreground/15'
                          }`}>
                            {isSelected && <div className="w-2.5 h-2.5 rounded-full bg-foreground" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
