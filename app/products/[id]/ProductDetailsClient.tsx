"use client";

import { useState, useEffect, useRef, useMemo, startTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShoppingBag, Loader2, Bookmark, X, Plus, ChevronLeft, ArrowLeft, ArrowRight } from "lucide-react";
import { useMetaEvents } from "@/hooks/useMetaEvents";
import { useSnapEvents } from "@/hooks/useSnapEvents";
import { useOpenAiEvents } from "@/hooks/useOpenAiEvents";
import { ShopifyProduct } from "@/lib/shopify-admin";
import { parseShopifyRichText, formatProductDescription, matchKey } from "@/lib/utils";
import { useCountry } from "@/lib/country-context";
import { lockScroll, unlockScroll } from "@/lib/utils/scroll-lock";

interface ShopSettings {
  showProductVideo: boolean;
  showSizeChart: boolean;
  showBrand: boolean;
  showShippingReturn: boolean;
  showCare: boolean;
  showSizeFit: boolean;
  showDetails: boolean;
  pdpBackground?: string;
}

function ProductDescriptionContainer({
  content,
  isExpanded,
  onToggleExpand,
}: {
  content: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const formattedHtml = useMemo(() => formatProductDescription(content), [content]);

  useEffect(() => {
    const checkOverflow = () => {
      if (contentRef.current) {
        setIsOverflowing(contentRef.current.scrollHeight > 92);
      }
    };

    checkOverflow();
    window.addEventListener("resize", checkOverflow);
    return () => window.removeEventListener("resize", checkOverflow);
  }, [formattedHtml]);

  return (
    <div className="relative">
      <div
        className={`transition-all duration-500 ease-in-out overflow-hidden relative ${
          !isExpanded ? "max-h-[85px]" : "max-h-[2500px]"
        }`}
      >
        <div
          ref={contentRef}
          className="text-[9.5px] font-light leading-[1.65] tracking-wide text-foreground/80 dark:text-foreground/70 space-y-2 [&_p]:mb-2.5 [&_p:last-child]:mb-0 [&_b]:font-bold [&_strong]:font-bold [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:mb-1 [&_a]:underline [&_a]:text-foreground"
          dangerouslySetInnerHTML={{ __html: formattedHtml }}
        />
        {!isExpanded && isOverflowing && (
          <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-background via-background/90 to-transparent pointer-events-none" />
        )}
      </div>

      {(isOverflowing || isExpanded) && (
        <button
          onClick={onToggleExpand}
          className="mt-2.5 px-3 py-1 rounded-full text-[6px] font-bold uppercase tracking-[0.18em] transition-all duration-200 bg-foreground/5 border border-foreground/10 text-foreground/70 dark:text-foreground/50 hover:text-foreground hover:bg-foreground/10 active:scale-95 flex items-center gap-1"
        >
          {isExpanded ? "View Less" : "View More"}
        </button>
      )}
    </div>
  );
}

import { toast } from "sonner";
import Image from "next/image";
import ProductCard from "@/components/ProductCard";
import { motion, AnimatePresence } from "framer-motion";
import { useCart } from "@/lib/cart-context";
import { useBookmarks } from "@/lib/bookmark-context";
import { trackStorefrontEvent } from "@/lib/track-client";
import { trackViewItem as zbTrackViewItem } from "@/lib/analytics-tracker";
import { useRecentlyViewed } from "@/lib/recently-viewed-context";
import { handleImageError } from "@/components/ImagePlaceholder";
import dynamic from "next/dynamic";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";

const CheckoutWebView = dynamic(() => import("@/components/CheckoutWebView"), { ssr: false });
const OrderSuccess = dynamic(() => import("@/components/OrderSuccess"), { ssr: false });
const QuickAddModal = dynamic(() => import("@/components/QuickAddModal"), { ssr: false });

interface ShopSettings {
  showProductVideo: boolean;
  showSizeChart: boolean;
  showBrand: boolean;
  showShippingReturn: boolean;
  showCare: boolean;
  showSizeFit: boolean;
  showDetails: boolean;
  pdpBackground?: string;
}

export default function ProductDetailsClient({ 
  product, 
  shopSettings, 
  recommendedProducts = [],
  allImages = []
}: { 
  product: ShopifyProduct; 
  shopSettings?: ShopSettings | null;
  recommendedProducts?: ShopifyProduct[];
  allImages?: any[];
}) {
  const router = useRouter();
  const { formatPrice: fmtPrice } = useCountry();
  const { trackViewContent, trackAddToCart, trackAddToWishlist } = useMetaEvents();
  const { trackViewContent: trackSnapViewContent, trackAddToCart: trackSnapAddToCart, trackAddToWishlist: trackSnapAddToWishlist } = useSnapEvents();
  const { trackContentsViewed: trackOaiContentsViewed, trackItemsAdded: trackOaiItemsAdded } = useOpenAiEvents();

  useEffect(() => {
    const variantId = product.variants?.[0]?.id?.toString() || product.id.toString();
    trackViewContent(variantId, product.title, parseFloat(product.variants?.[0]?.price || "0"), 'INR', product.product_type);
    trackSnapViewContent(variantId, product.title, parseFloat(product.variants?.[0]?.price || "0"), 'INR', product.product_type);
    trackOaiContentsViewed(variantId, product.title, parseFloat(product.variants?.[0]?.price || "0"), 'INR', product.product_type);
    zbTrackViewItem(product.id.toString(), variantId, parseFloat(product.variants?.[0]?.price || "0"), { title: product.title });
  }, [product.id, product.title, product.product_type]);

  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>("details");
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [showSizeChart, setShowSizeChart] = useState(false);
  const [scrollPos, setScrollPos] = useState(0);
  const [activeImg, setActiveImg] = useState(0);
  const [direction, setDirection] = useState(0);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [isAdded, setIsAdded] = useState(false);
  const [quickAddProduct, setQuickAddProduct] = useState<ShopifyProduct | null>(null);
  const [sizeError, setSizeError] = useState(false);
  const [moodBoardImages, setMoodBoardImages] = useState<string[]>([]);

  // Sync zoom status on index switches
  useEffect(() => {
    setIsZoomed(false);
  }, [activeImg]);

  // Lock background scroll and hide floating headers when gallery is open
  useEffect(() => {
    if (isGalleryOpen) {
      document.body.classList.add("gallery-open");
      lockScroll();
    } else {
      document.body.classList.remove("gallery-open");
      unlockScroll();
      setIsZoomed(false);
    }
    return () => {
      document.body.classList.remove("gallery-open");
      unlockScroll();
    };
  }, [isGalleryOpen]);



  const { add: addToCart } = useCart();
  const { toggleBookmark, isBookmarked, setIsOpen } = useBookmarks();
  const { addProduct: recordVisit, recentlyViewed } = useRecentlyViewed();

  // Fetch mood board images for this product
  useEffect(() => {
    const productId = product.id?.toString();
    if (!productId) return;
    fetch(`/api/mood-board?productId=${productId}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.images) && data.images.length > 0) {
          setMoodBoardImages(data.images.filter(Boolean));
        }
      })
      .catch(() => {});
  }, [product.id]);

  useEffect(() => {
    recordVisit(product);

    // Track Product Viewed event
    trackStorefrontEvent('Product Viewed', {
      productId: product.id.toString(),
      metadata: {
        title: product.title,
        price: product.variants?.[0]?.price,
        handle: product.handle,
        category: product.product_type
      }
    });

    // Capture and save ctwa_clid (Click-to-WhatsApp Click ID) from URL if present
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const ctwa_clid = urlParams.get('ctwa_clid');
      if (ctwa_clid) {
        localStorage.setItem('ctwa_clid', ctwa_clid);
      }
    }
  }, [product, recordVisit]);

  // Optimized Scroll Effects for Safari
  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const scroll = window.scrollY;
          setScrollPos(scroll);
          
          const overlay = document.getElementById('pdp-blur-overlay-internal');
          if (overlay) {
            const opacity = Math.min(scroll / 600, 0.4);
            overlay.style.backgroundColor = `rgba(0,0,0, ${opacity})`;
          }
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Robust helper to get metafield by key (case-insensitive, space/hyphen agnostic)
  const getMeta = (key: string) => {
    if (!product.metafields) return null;
    
    // Explicit mapping for specific storefront tabs
    const targetKey = key.toUpperCase();
    if (targetKey === 'SHIPPING & RETURN') {
      const found = product.metafields.find(
        m => m.key === 'shipping_return' || matchKey(m.key, key)
      );
      return found?.value;
    }
    if (targetKey === 'SIZE & FIT') {
      const found = product.metafields.find(
        m => m.key === 'size_fit' || matchKey(m.key, key)
      );
      return found?.value;
    }

    const found = product.metafields.find(m => matchKey(m.key, key));
    return found?.value;
  };

  const sizes = product.variants
    ?.map(v => v.option1) // Assuming option1 is Size
    .filter((v, i, a) => v && a.indexOf(v) === i) || [];

  const handleAddToBag = () => {
    if (!selectedSize && sizes.length > 0) {
      setSizeError(true);
      toast.error("Please select a size first");
      setTimeout(() => setSizeError(false), 1500);
      return;
    }

    const variant = product.variants?.find(v => v.option1 === selectedSize) || product.variants?.[0];

    if (!variant) {
      toast.error("This product is currently unavailable");
      return;
    }

    if ((variant.inventory_quantity || 0) <= 0) {
      toast.error("This size is currently sold out");
      return;
    }

    addToCart({
      productId: product.id.toString(),
      handle: product.handle,
      variantId: variant.id.toString(),
      title: product.title,
      size: selectedSize,
      price: variant.price,
      image: product.image?.src || product.images[0]?.src || "/zb-logo-220px.png",
      category: product.product_type
    });

    // Track AddToCart in Meta Pixel & Snap Pixel
    trackAddToCart(variant.id.toString(), product.title, parseFloat(variant.price || "0"), 'INR', product.product_type);
    trackSnapAddToCart(variant.id.toString(), product.title, parseFloat(variant.price || "0"), 'INR', product.product_type);
    trackOaiItemsAdded(variant.id.toString(), product.title, parseFloat(variant.price || "0"), 'INR', product.product_type);

    setIsAdded(true);
    toast.success(`${product.title} added to bag`);
    setTimeout(() => setIsAdded(false), 2000);
  };

  const handleBuyNow = async () => {
    if (!selectedSize && sizes.length > 0) {
      setSizeError(true);
      toast.error("Please select a size first");
      setTimeout(() => setSizeError(false), 1500);
      return;
    }

    const variant = product.variants?.find((v) => v.option1 === selectedSize) || product.variants?.[0];

    if (!variant) {
      toast.error("This product is currently unavailable");
      return;
    }

    if ((variant.inventory_quantity || 0) <= 0) {
      toast.error("This size is currently sold out");
      return;
    }

    addToCart({
      productId: product.id.toString(),
      handle: product.handle,
      variantId: variant.id.toString(),
      title: product.title,
      size: selectedSize,
      price: variant.price,
      image: product.image?.src || product.images[0]?.src || "/zb-logo-220px.png",
      category: product.product_type
    });

    // Track AddToCart in Meta Pixel & Snap Pixel
    trackAddToCart(variant.id.toString(), product.title, parseFloat(variant.price || "0"), 'INR', product.product_type);
    trackSnapAddToCart(variant.id.toString(), product.title, parseFloat(variant.price || "0"), 'INR', product.product_type);
    trackOaiItemsAdded(variant.id.toString(), product.title, parseFloat(variant.price || "0"), 'INR', product.product_type);

    router.push("/checkout");
  };

  const initialPrice = product.variants?.[0]?.price || "0.00";
  const comparePrice = product.variants?.[0]?.compare_at_price;
  const isAllVariantsSoldOut = product.variants ? !product.variants.some(v => (v.inventory_quantity || 0) > 0) : true;
  const activeVariant = selectedSize ? product.variants?.find(v => v.option1 === selectedSize) : null;
  const isVariantSoldOut = selectedSize 
    ? (activeVariant ? (activeVariant.inventory_quantity || 0) <= 0 : true)
    : isAllVariantsSoldOut;
  const productVideoUrl = getMeta('product-video');
  const sizeChartImageUrl = getMeta('size-chart-image');
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const isScrolling = useRef(false);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, clientWidth } = scrollRef.current;
    const width = clientWidth || window.innerWidth;
    const index = Math.round(scrollLeft / width);
    if (index !== activeImg) {
      startTransition(() => {
        setActiveImg(index);
      });
    }
  };

  const tagsList = product.tags ? product.tags.split(',').map(t => t.trim().toLowerCase()) : [];
  const hideDescription = tagsList.includes('hide:description');
  const hideDetails = tagsList.includes('hide:details');
  const hideSizeFit = tagsList.includes('hide:size_fit');
  const hideCare = tagsList.includes('hide:care');
  const hideShippingReturn = tagsList.includes('hide:shipping_return');

  const tabs = [
    { id: 'details', label: 'Description', show: (shopSettings?.showDetails ?? true) && !hideDescription },
    { id: 'more-details', label: 'Details', show: (shopSettings?.showDetails ?? true) && !hideDetails && !!getMeta('DETAILS') },
    { id: 'size-fit', label: 'Size & Fit', show: (shopSettings?.showSizeFit ?? true) && !hideSizeFit && !!getMeta('SIZE & FIT') },
    { id: 'care', label: 'Care', show: (shopSettings?.showCare ?? true) && !hideCare && !!getMeta('CARE') },
    { id: 'shipping', label: 'Shipping & Return', show: (shopSettings?.showShippingReturn ?? true) && !hideShippingReturn && !!getMeta('SHIPPING & RETURN') },
    { id: 'brand', label: 'Brand', show: false },
  ].filter(t => t.show);

  // Client-side randomization and categorization for Recommended Products
  const [shuffledRecommended, setShuffledRecommended] = useState<ShopifyProduct[]>([]);

  useEffect(() => {
    if (recommendedProducts.length > 0) {
      // Helper function to check if a product is a T-Shirt (or top/shirt)
      const isTShirt = (p: ShopifyProduct) => {
        const type = (p.product_type || "").toLowerCase();
        const title = (p.title || "").toLowerCase();
        const tags = (p.tags || "").toLowerCase();
        return (
          type.includes("t-shirt") || type.includes("tee") || type.includes("shirt") || type.includes("top") ||
          title.includes("t-shirt") || title.includes("t shirt") || title.includes("tee") || title.includes("shirt") || title.includes("top") ||
          tags.includes("t-shirt") || tags.includes("t shirt") || tags.includes("tee") || tags.includes("shirt") || tags.includes("top")
        );
      };

      // Helper function to check if a product is Jeans (or bottom/pant/denim/trouser)
      const isJeans = (p: ShopifyProduct) => {
        const type = (p.product_type || "").toLowerCase();
        const title = (p.title || "").toLowerCase();
        const tags = (p.tags || "").toLowerCase();
        return (
          type.includes("jeans") || type.includes("jean") || type.includes("denim") || type.includes("pant") || type.includes("trouser") || type.includes("bottom") ||
          title.includes("jeans") || title.includes("jean") || title.includes("denim") || title.includes("pant") || title.includes("trouser") || title.includes("bottom") ||
          tags.includes("jeans") || tags.includes("jean") || tags.includes("denim") || tags.includes("pant") || tags.includes("trouser") || tags.includes("bottom")
        );
      };

      const currentIsTShirt = isTShirt(product);
      const currentIsJeans = isJeans(product);

      let oppositeType: ShopifyProduct[] = [];
      let sameType: ShopifyProduct[] = [];
      let others: ShopifyProduct[] = [];

      recommendedProducts.forEach((p) => {
        if (currentIsTShirt) {
          if (isJeans(p)) {
            oppositeType.push(p);
          } else if (isTShirt(p)) {
            sameType.push(p);
          } else {
            others.push(p);
          }
        } else if (currentIsJeans) {
          if (isTShirt(p)) {
            oppositeType.push(p);
          } else if (isJeans(p)) {
            sameType.push(p);
          } else {
            others.push(p);
          }
        } else {
          others.push(p);
        }
      });

      // Shuffle helper
      const shuffle = (arr: ShopifyProduct[]) => [...arr].sort(() => Math.random() - 0.5);

      const shuffledOpposite = shuffle(oppositeType);
      const shuffledSameType = shuffle(sameType);
      const shuffledOthers = shuffle(others);

      // Show opposite category first, then others, then same category
      const finalShuffled = [...shuffledOpposite, ...shuffledOthers, ...shuffledSameType];
      setShuffledRecommended(finalShuffled);
    }
  }, [recommendedProducts, product]);

  // Curated Pairs Carousel Logic - Mirroring RingCarouselSection smoothness
  const curatedScrollRef = useRef<HTMLDivElement>(null);
  const curatedScrollMobileRef = useRef<HTMLDivElement>(null);
  const [isCuratedDragging, setIsCuratedDragging] = useState(false);
  const [curatedStartX, setCuratedStartX] = useState(0);
  const [curatedScrollLeft, setCuratedScrollLeft] = useState(0);

  const onCuratedMouseDown = (e: React.MouseEvent) => {
    setIsCuratedDragging(true);
    if (curatedScrollMobileRef.current) {
        setCuratedStartX(e.pageX - curatedScrollMobileRef.current.offsetLeft);
        setCuratedScrollLeft(curatedScrollMobileRef.current.scrollLeft);
    }
  };

  const onCuratedMouseMove = (e: React.MouseEvent) => {
    if (!isCuratedDragging || !curatedScrollMobileRef.current) return;
    e.preventDefault();
    const x = e.pageX - curatedScrollMobileRef.current.offsetLeft;
    const walk = (x - curatedStartX) * 1.8;
    curatedScrollMobileRef.current.scrollLeft = curatedScrollLeft - walk;
  };

  const stopCuratedDrag = () => setIsCuratedDragging(false);

  return (
    <>
      {/* ─── DESKTOP VIEW (md and up) ─── */}
      <div className="hidden md:block min-h-screen pt-4 pb-20 px-6 max-w-7xl mx-auto relative z-10 text-foreground product-page">
        <div className="grid grid-cols-12 gap-10 items-start">
          
          {/* Left Column: Media Gallery */}
          <div className="col-span-6 sticky top-28 space-y-6 flex flex-col items-center w-full">
            <div 
              onClick={() => setIsGalleryOpen(true)}
              className="relative aspect-[3/4] w-full max-w-[520px] rounded-xl overflow-hidden border border-foreground/5 shadow-2xl bg-foreground/[0.01] cursor-zoom-in hover:brightness-95 transition-all duration-300"
            >
              <Image
                src={allImages[activeImg]?.src || "/zb-logo-220px.png"}
                alt={product.title}
                fill
                className="object-cover transition-all duration-[1200ms]"
                priority
                sizes="(max-width: 1200px) 50vw, 600px"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent pointer-events-none" />
            </div>
            
            {/* Gallery Thumbnails List */}
            <div className="flex flex-wrap gap-2 justify-center">
              {allImages.map((img, i) => (
                <button
                  key={`gal-desk-${i}`}
                  onClick={() => setActiveImg(i)}
                  className={`relative w-14 h-14 rounded-[12px] overflow-hidden border transition-all duration-300 shadow-sm outline-none ${
                    activeImg === i 
                      ? "border-foreground scale-105 shadow-md ring-2 ring-foreground/20" 
                      : "border-foreground/10 hover:border-foreground/30 hover:scale-[1.02]"
                  }`}
                >
                  <Image src={img.src} alt={`${product.title} - View ${i + 1}`} fill className="object-cover" sizes="80px" />
                </button>
              ))}
            </div>
          </div>

          {/* Right Column: Checkout Info & Tabs */}
          <div className="col-span-6 space-y-4 rounded-3xl p-6 bg-white dark:bg-black border border-black/5 dark:border-white/10 backdrop-blur-[30px] shadow-[0_15px_35px_rgba(0,0,0,0.05)] dark:shadow-[0_15px_35px_rgba(0,0,0,0.7)] relative overflow-hidden">
            {/* Specular glass reflection */}
            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.01] to-white/[0.03] dark:to-white/[0.06] pointer-events-none rounded-3xl" />
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-[14px] font-bold tracking-[0.2em] uppercase text-foreground font-heading mb-1.5 leading-snug">{product.title}</h1>
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-foreground/60 tracking-tight">{fmtPrice(parseFloat(initialPrice)).formatted}</span>
                  {comparePrice && parseFloat(comparePrice) > parseFloat(initialPrice) && (
                    <span className="text-[10px] font-light text-foreground/20 line-through tracking-wider">{fmtPrice(parseFloat(comparePrice)).formatted}</span>
                  )}
                </div>
              </div>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  if (!selectedSize && sizes.length > 0) {
                    setSizeError(true);
                    toast.error("Please select a size first");
                    setTimeout(() => setSizeError(false), 1500);
                    return;
                  }
                  const activeVariant = selectedSize ? product.variants?.find(v => v.option1 === selectedSize) : product.variants?.[0];
                  const variantIdStr = activeVariant?.id?.toString();
                  const wasBookmarked = isBookmarked(product.id.toString(), variantIdStr);
                  toggleBookmark(product, variantIdStr, selectedSize || activeVariant?.option1 || undefined);
                  setIsOpen(true);
                  if (!wasBookmarked) {
                    trackAddToWishlist(product.id.toString(), product.title, product.product_type);
                    trackSnapAddToWishlist(product.id.toString(), product.title, product.product_type);
                  }
                  toast.success(wasBookmarked ? "Removed from bookmarks" : "Saved to bookmarks");
                }}
                className="w-8 h-8 rounded-full bg-foreground/5 border border-foreground/5 flex items-center justify-center hover:bg-foreground/10 transition-all active:scale-90 flex-shrink-0"
              >
                <Bookmark className={`w-3.5 h-3.5 ${(() => {
                  const activeVariant = selectedSize ? product.variants?.find(v => v.option1 === selectedSize) : product.variants?.[0];
                  return isBookmarked(product.id.toString(), activeVariant?.id?.toString()) ? "text-primary fill-primary" : "text-foreground/50";
                })()}`} />
              </button>
            </div>

            {/* Size Selector */}
            {sizes.length > 0 && (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[7.5px] font-bold uppercase tracking-[0.3em] text-foreground/40">Select Size</span>
                  {(shopSettings?.showSizeChart ?? true) && sizeChartImageUrl && (
                    <button onClick={() => setShowSizeChart(true)} className="text-[7.5px] font-bold text-foreground/40 hover:text-foreground transition-all uppercase tracking-[0.15em] border-b border-foreground/10">
                      Guide
                    </button>
                  )}
                </div>
                <div className={`grid grid-cols-6 gap-1.5 ${sizeError ? 'animate-[shake_0.3s_ease-in-out]' : ''}`}>
                  {sizes.map((size) => {
                    const variant = product.variants?.find(v => v.option1 === size);
                    const isOutOfStock = (variant?.inventory_quantity || 0) <= 0;
                    return (
                      <button
                        key={`desk-size-${size}`}
                        onClick={() => setSelectedSize(size)}
                        className={`h-8 flex items-center justify-center rounded-lg text-[8px] font-medium uppercase tracking-widest transition-all border relative overflow-hidden ${
                          selectedSize === size
                            ? "bg-foreground text-background border-transparent shadow-sm"
                            : isOutOfStock
                            ? "bg-black/[0.01] dark:bg-white/[0.01] border-black/[0.05] dark:border-white/[0.05] text-black/20 dark:text-white/20 cursor-not-allowed"
                            : "bg-black/[0.03] dark:bg-white/[0.05] border-black/[0.08] dark:border-white/[0.12] text-black/60 dark:text-white/60 hover:border-black/20 dark:hover:border-white/25"
                        }`}
                      >
                        {size}
                        {isOutOfStock && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="w-[120%] h-[1px] bg-foreground/10 rotate-[35deg] transform-gpu" /></div>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Call to Actions */}
            <div className="space-y-2 pt-1">
              <button
                onClick={handleAddToBag}
                disabled={isAdded || isAllVariantsSoldOut}
                className="w-full py-3 flex items-center justify-center text-[9px] font-bold uppercase tracking-[0.2em] transition-all active:scale-[0.99] rounded-lg bg-foreground/5 border border-foreground/10 hover:bg-foreground/10 hover:border-foreground/20 text-foreground/90 disabled:opacity-40 disabled:pointer-events-none"
              >
                {isAdded ? "Added to Bag!" : isAllVariantsSoldOut ? "Sold Out" : "Add to Bag"}
              </button>
              {!isAllVariantsSoldOut && (
                <button
                  onClick={handleBuyNow}
                  disabled={isCheckingOut}
                  className="w-full py-3 rounded-lg text-background text-[9px] font-bold uppercase tracking-[0.2em] hover:opacity-90 transition-all active:scale-[0.99] shadow-md flex items-center justify-center gap-2 disabled:opacity-60 bg-foreground"
                >
                  {isCheckingOut ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Buy Now"}
                </button>
              )}
            </div>

            {/* Tabs details */}
            <div className="p-3.5 rounded-xl border border-foreground/5 bg-foreground/[0.01] space-y-3">
              <div className="flex overflow-x-auto hide-scrollbar gap-1.5 border-b border-foreground/5 pb-1.5">
                {tabs.map((tab) => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`shrink-0 px-2.5 py-1 rounded-full text-[7.5px] font-bold uppercase tracking-widest transition-all ${activeTab === tab.id ? "bg-foreground text-background font-bold shadow-md" : "text-foreground/40 hover:text-foreground/60 bg-transparent"}`}>
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="text-[9.5px] font-light leading-relaxed text-foreground/60 min-h-[50px]">
                {activeTab === "details" ? (
                  <ProductDescriptionContainer
                    content={product.body_html || product.description || ""}
                    isExpanded={isDescriptionExpanded}
                    onToggleExpand={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                  />
                ) : (
                  tabs.map(tab => activeTab === tab.id && (
                    <div key={tab.id} className="animate-in fade-in duration-700" dangerouslySetInnerHTML={{ __html: parseShopifyRichText(getMeta(tab.label.toUpperCase())) }} />
                  ))
                )}
              </div>
            </div>

            {/* Experimental Reference Video */}
            {(shopSettings?.showProductVideo ?? true) && productVideoUrl && (
              <div className="space-y-2">
                <span className="text-[7.5px] font-bold uppercase tracking-[0.3em] text-foreground/40 block">Experimental Reference</span>
                <div className="relative aspect-[9/16] max-w-[200px] mx-auto rounded-2xl overflow-hidden border border-foreground/5 shadow-inner cursor-pointer" onClick={() => setIsMuted(!isMuted)}>
                  <video src={productVideoUrl} autoPlay loop muted={isMuted} playsInline className="w-full h-full object-cover" />
                  <div className="absolute bottom-4 right-4 z-10">{isMuted ? <X className="w-3 h-3 text-white/50" /> : <div className="flex items-center gap-0.5 opacity-80"><div className="w-[1px] h-1.5 bg-white animate-pulse" /><div className="w-[1px] h-2 bg-white animate-pulse" style={{ animationDelay: '0.1s' }} /></div>}</div>
                </div>
              </div>
            )}

            {/* Mood Board Section — Desktop */}
            {moodBoardImages.length > 0 && (
              <div className="space-y-3 mt-4">
                <span className="text-[7.5px] font-bold uppercase tracking-[0.3em] text-foreground/40 block">Mood Board</span>
                <div className="flex flex-col gap-3">
                  {moodBoardImages.slice(0, 10).map((img, idx) => (
                    <div
                      key={`mb-desk-${idx}`}
                      className="relative overflow-hidden bg-foreground/[0.02] rounded-[1.8rem] border border-foreground/[0.05] shadow-sm w-full"
                      style={{ aspectRatio: '16/10' }}
                    >
                      <img
                        src={img}
                        alt={`${product.title} mood board ${idx + 1}`}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recommended & Curated Pairs Row — full-width edge-to-edge */}
      {shuffledRecommended.length > 0 && (
        <div className="hidden md:block bg-background text-foreground py-6 border-t border-border/50 w-full overflow-hidden">
          <div className="flex items-center justify-between mb-5 px-4">
            <h2 className="text-[11px] uppercase tracking-[0.2em] font-heading text-foreground font-bold">
              CURATED PAIRS
            </h2>
            <div className="flex items-center gap-4">
              <button 
                className="flex items-center justify-center text-foreground/35 hover:text-foreground transition-all active:scale-95"
                onClick={() => curatedScrollRef.current?.scrollBy({ left: -342, behavior: 'smooth' })}
                aria-label="Previous Curated Items"
              >
                <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
              </button>
              <button 
                className="flex items-center justify-center text-foreground/35 hover:text-foreground transition-all active:scale-95"
                onClick={() => curatedScrollRef.current?.scrollBy({ left: 342, behavior: 'smooth' })}
                aria-label="Next Curated Items"
              >
                <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
              </button>
            </div>
          </div>
          
          <div 
            ref={curatedScrollRef}
            className="flex overflow-x-auto hide-scrollbar scroll-smooth snap-x gap-[2px]"
          >
            {shuffledRecommended.map((p, idx) => {
              const initialPrice = p.variants?.[0]?.price || "0.00";
              return (
                <div 
                  key={`desk-pair-${p.id}`}
                  className="min-w-[340px] w-[340px] snap-start flex flex-col group cursor-pointer transition-all duration-300"
                  onClick={() => router.push(`/products/${p.handle}`)}
                >
                  <div className="relative aspect-[3/5] w-full overflow-hidden bg-background/5">
                    <Image 
                      src={p.image?.src || p.images?.[0]?.src || "/zb-logo-220px.png"} 
                      alt={p.title} 
                      fill 
                      className="object-cover group-hover:scale-[1.03] transition-transform duration-700" 
                      sizes="400px"
                      loading="lazy"
                    />
                  </div>
                  <div className="flex items-center justify-between border-t border-black/[0.03] dark:border-white/[0.03] p-3.5">
                    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <span className="text-[9px] font-sans font-bold tracking-[0.12em] uppercase text-foreground line-clamp-1">
                        {p.title}
                      </span>
                      <span className="text-[9px] font-sans font-light text-foreground/50">
                        {fmtPrice(parseFloat(p.variants?.[0]?.price || initialPrice)).formatted}
                      </span>
                    </div>
                    <button
                      className="w-7 h-7 flex items-center justify-center text-foreground/40 hover:text-foreground active:scale-90 transition-all shrink-0 ml-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        setQuickAddProduct(p);
                      }}
                    >
                      <Plus className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── MOBILE VIEW (sm and below) ─── */}
      <div className="md:hidden">
        {/* Mobile View Gallery Carousel - Native Horizontal Swiping */}
        <div className="px-0 pt-16">
          <div className="relative w-full aspect-[3/4] overflow-hidden bg-foreground/[0.02] rounded-b-xl border-b border-black/5 dark:border-white/10 shadow-md">
            <div 
              ref={scrollRef}
              onScroll={handleScroll}
              className="w-full h-full flex overflow-x-auto snap-x snap-mandatory hide-scrollbar scroll-smooth"
              style={{ 
                scrollSnapType: 'x mandatory',
                WebkitOverflowScrolling: "touch"
              }}
            >
              {allImages.map((img, i) => (
                <div 
                  key={`mobile-gal-${i}`} 
                  className="w-full h-full flex-shrink-0 snap-center relative cursor-zoom-in"
                  onClick={() => {
                    setActiveImg(i);
                    setIsGalleryOpen(true);
                  }}
                >
                  <Image
                    src={img.src || "/zb-logo-220px.png"}
                    alt={product.title}
                    fill
                    className="object-cover"
                    priority={i === 0}
                    sizes="100vw"
                    onError={handleImageError}
                  />
                </div>
              ))}
            </div>

            {/* Dot Indicators */}
            <div className="absolute bottom-4 inset-x-0 flex justify-center gap-1.5 z-10">
              {allImages.map((_, i) => (
                <div 
                  key={`dot-${i}`}
                  className={`w-1 h-1 rounded-full transition-all duration-300 ${
                    activeImg === i ? "w-4 bg-white" : "bg-white/45"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Thumbnails Navigation */}
        <div className="relative px-2 pb-2 mt-3 flex justify-center">
          <div className="flex overflow-x-auto gap-2 py-2 hide-scrollbar snap-x justify-start sm:justify-center items-center w-full">
            {allImages.map((img, i) => (
              <button
                key={`thumb-mobile-${i}`}
                onClick={() => {
                  setActiveImg(i);
                  if (scrollRef.current) {
                    scrollRef.current.scrollTo({
                      left: i * scrollRef.current.clientWidth,
                      behavior: "smooth"
                    });
                  }
                }}
                className={`relative w-16 h-16 rounded-[12px] overflow-hidden flex-shrink-0 snap-center border transition-all duration-300 shadow-sm outline-none ${
                    activeImg === i 
                    ? "border-foreground scale-105 ring-2 ring-foreground/20" 
                    : "border-foreground/10 hover:border-foreground/30 hover:scale-[1.02]"
                }`}
              >
                <Image 
                  src={img.src || "/zb-logo-220px.png"} 
                  alt={`${product.title} - View ${i + 1}`} 
                  fill 
                  className="object-cover pointer-events-none" 
                  sizes="80px" 
                  onError={handleImageError}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable Content Container (No more negative margins) */}
        <div className="relative z-20 min-h-[100vh]">

          <main className="relative z-20 product-page px-[1px] pb-[1px]">
            <div 
              className="min-h-[60vh] rounded-[2rem] px-4 pt-6 pb-6 border border-black/5 dark:border-white/10 bg-white dark:bg-black shadow-[0_24px_50px_-12px_rgba(0,0,0,0.08)] dark:shadow-[0_24px_50px_-12px_rgba(0,0,0,0.8)] backdrop-blur-[35px] relative overflow-hidden"
            >
              {/* Specular glass reflection */}
              <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.01] to-white/[0.03] dark:to-white/[0.06] pointer-events-none rounded-[2rem]" />

              <div className="flex justify-between items-start mb-2 px-1 relative z-10">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <p className="text-[11px] sm:text-[12px] font-bold tracking-[0.25em] uppercase leading-tight text-foreground/90 font-heading">
                      {product.title}
                    </p>
                    {comparePrice && parseFloat(comparePrice) > parseFloat(initialPrice) && (
                      <div className="bg-foreground text-background px-1.5 py-[1px] rounded-[2px] leading-none mb-1">
                        <span className="text-[6px] font-bold uppercase tracking-tighter whitespace-nowrap">Sale</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-normal text-foreground/60 dark:text-foreground/40 tracking-tight">{fmtPrice(parseFloat(initialPrice)).formatted}</span>
                    {comparePrice && parseFloat(comparePrice) > parseFloat(initialPrice) && (
                      <span className="text-[10px] font-light text-foreground/15 line-through tracking-wider">{fmtPrice(parseFloat(comparePrice)).formatted}</span>
                    )}
                  </div>
                </div>
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!selectedSize && sizes.length > 0) {
                      setSizeError(true);
                      toast.error("Please select a size first");
                      setTimeout(() => setSizeError(false), 1500);
                      return;
                    }
                    const activeVariant = selectedSize ? product.variants?.find(v => v.option1 === selectedSize) : product.variants?.[0];
                    const variantIdStr = activeVariant?.id?.toString();
                    const wasBookmarked = isBookmarked(product.id.toString(), variantIdStr);
                    toggleBookmark(product, variantIdStr, selectedSize || activeVariant?.option1 || undefined);
                    setIsOpen(true);
                    if (!wasBookmarked) {
                      trackAddToWishlist(product.id.toString(), product.title, product.product_type);
                      trackSnapAddToWishlist(product.id.toString(), product.title, product.product_type);
                    }
                    toast.success(wasBookmarked ? "Removed from bookmarks" : "Saved to bookmarks");
                  }}
                  className="w-8 h-8 rounded-full bg-foreground/5 border border-foreground/5 flex items-center justify-center hover:bg-foreground/10 transition-all active:scale-90"
                >
                  <Bookmark className={`w-3.5 h-3.5 ${(() => {
                    const activeVariant = selectedSize ? product.variants?.find(v => v.option1 === selectedSize) : product.variants?.[0];
                    return isBookmarked(product.id.toString(), activeVariant?.id?.toString()) ? "text-primary fill-primary" : "text-foreground/60 dark:text-foreground/40";
                  })()}`} />
                </button>
              </div>

              <div className="flex flex-col gap-1.5 relative z-10">
                {/* Size Section - Ultra Tiny */}
                {sizes.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex justify-between items-center px-1">
                      <span className="text-[7px] font-bold uppercase tracking-[0.4em] text-black/40 dark:text-white/40">Select Size</span>
                      {(shopSettings?.showSizeChart ?? true) && sizeChartImageUrl && (
                        <button onClick={() => setShowSizeChart(true)} className="text-[7px] font-bold text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white transition-all uppercase tracking-[0.2em] border-b border-black/10 dark:border-white/10">
                          Guide
                        </button>
                      )}
                    </div>
                    {/* Equal-size 6-column grid — matches QuickAddModal */}
                    <div className={`grid grid-cols-6 gap-1.5 px-0.5 ${sizeError ? 'animate-[shake_0.3s_ease-in-out]' : ''}`}>
                      {sizes.map((size) => {
                        const variant = product.variants?.find(v => v.option1 === size);
                        const isOutOfStock = (variant?.inventory_quantity || 0) <= 0;
                        return (
                          <button
                            key={size}
                            onClick={() => setSelectedSize(size)}
                            className={`h-9 w-full flex items-center justify-center rounded-lg text-[8px] font-medium uppercase tracking-widest transition-all border relative overflow-hidden ${
                              selectedSize === size
                                ? "bg-foreground text-background border-transparent shadow-sm"
                                : isOutOfStock
                                ? "bg-black/[0.01] dark:bg-white/[0.01] border-black/[0.05] dark:border-white/[0.05] text-black/20 dark:text-white/20 cursor-not-allowed"
                                : "bg-black/[0.03] dark:bg-white/[0.05] border-black/[0.08] dark:border-white/[0.12] text-black/60 dark:text-white/60 hover:border-black/20 dark:hover:border-white/25"
                            }`}
                          >
                            {size}
                            {isOutOfStock && (
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="w-[120%] h-[1px] bg-foreground/10 rotate-[35deg] transform-gpu" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-2 mt-0.5">
                  {(() => {
                    const activeVariant = selectedSize ? product.variants?.find(v => v.option1 === selectedSize) : null;
                    const isVariantSoldOut = selectedSize 
                      ? (activeVariant ? (activeVariant.inventory_quantity || 0) <= 0 : true)
                      : (product.variants ? !product.variants.some(v => (v.inventory_quantity || 0) > 0) : true);
                    
                    return (
                      <>
                        <button
                          onClick={handleAddToBag}
                          disabled={isAdded || isAllVariantsSoldOut}
                          className="w-full py-3.5 flex items-center justify-center text-[9px] font-bold uppercase tracking-[0.25em] transition-all active:scale-[0.99] glass-button rounded-xl bg-foreground/5 border-foreground/10 hover:bg-foreground/10 hover:border-foreground/20 text-foreground/90 disabled:opacity-40 disabled:pointer-events-none"
                        >
                          <AnimatePresence mode="wait">
                            {isAdded ? (
                              <motion.span
                                key="added"
                                initial={{ opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -5 }}
                                className="flex items-center gap-2"
                              >
                                Added to Bag!
                              </motion.span>
                            ) : isAllVariantsSoldOut ? (
                              <motion.span
                                key="soldout"
                                initial={{ opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
                              >
                                Sold Out
                              </motion.span>
                            ) : (
                              <motion.span
                                key="add"
                                initial={{ opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -5 }}
                              >
                                Add to Bag
                              </motion.span>
                            )}
                          </AnimatePresence>
                        </button>
                        {!isAllVariantsSoldOut && (
                          <button
                            onClick={handleBuyNow}
                            disabled={isCheckingOut}
                            className="w-full py-3.5 rounded-[0.8rem] text-background text-[9px] font-bold uppercase tracking-[0.25em] hover:opacity-90 transition-all active:scale-[0.99] shadow-lg flex items-center justify-center gap-2 disabled:opacity-60"
                            style={{
                              background: "hsl(var(--foreground))",
                              boxShadow: "0 8px 32px -8px hsl(var(--foreground) / 0.3)"
                            }}
                          >
                            {isCheckingOut ? (
                              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Preparing…</>
                            ) : (
                              "Buy Now"
                            )}
                          </button>
                        )}
                      </>
                    );
                  })()}
                  {checkoutError && (
                    <p className="text-[8px] text-red-400/80 text-center mt-1 px-2">{checkoutError}</p>
                  )}
                </div>

                <div 
                  className="mt-0.5 p-3 rounded-[1.5rem] border border-foreground/[0.06] bg-foreground/[0.01]"
                >
                  <div className="flex overflow-x-auto hide-scrollbar gap-1.5 mb-2 px-0.5">
                    {tabs.map((tab) => (
                      <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`shrink-0 px-3 py-1.5 rounded-full text-[7px] font-bold uppercase tracking-widest transition-all ${activeTab === tab.id ? "bg-foreground text-background font-bold shadow-lg" : "text-foreground/40 hover:text-foreground/60 bg-transparent"}`}>
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <div 
                    className="rounded-[1rem] p-3 border border-foreground/[0.06] bg-foreground/[0.01]"
                    data-nosnippet=""
                  >
                    {activeTab === "details" ? (
                      <ProductDescriptionContainer
                        content={product.body_html || product.description || ""}
                        isExpanded={isDescriptionExpanded}
                        onToggleExpand={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                      />
                    ) : (
                      tabs.map(tab => activeTab === tab.id && (
                        <div key={tab.id} className="animate-in fade-in duration-700 text-[9.5px] font-light leading-[1.6] text-foreground/80 dark:text-foreground/60" dangerouslySetInnerHTML={{ __html: parseShopifyRichText(getMeta(tab.label.toUpperCase())) }} />
                      ))
                    )}
                  </div>
                </div>

                {(shopSettings?.showProductVideo ?? true) && productVideoUrl && (
                  <div className="mt-1 -mx-0.5">
                    <span className="text-[7.5px] font-bold uppercase tracking-[0.4em] text-foreground/40 dark:text-foreground/20 ml-1 mb-1.5 block">Experimental Reference</span>
                    <div 
                      className="relative aspect-[9/16] rounded-[2.2rem] overflow-hidden bg-foreground/[0.02] border border-foreground/[0.05] shadow-inner cursor-pointer"
                      onClick={() => setIsMuted(!isMuted)}
                    >
                      <video 
                        key={productVideoUrl} 
                        autoPlay 
                        loop 
                        muted={isMuted} 
                        playsInline 
                        className="w-full h-full object-cover pointer-events-none"
                      >
                        <source src={productVideoUrl} type="video/mp4" />
                      </video>
                      {/* Premium Minimal Audio Indicator */}
                      <div className="absolute bottom-4 right-4 z-10">
                        {isMuted ? (
                          <X className="w-2.5 h-2.5 text-white/50" />
                        ) : (
                          <div className="flex items-center gap-0.5 opacity-80">
                            <div className="w-[1.5px] h-2 bg-white animate-pulse" />
                            <div className="w-[1.5px] h-2.5 bg-white animate-pulse" style={{ animationDelay: '0.1s' }} />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Mood Board Section — Mobile */}
                {moodBoardImages.length > 0 && (
                  <div className="mt-4 -mx-0.5 space-y-2.5">
                    <span className="text-[7.5px] font-bold uppercase tracking-[0.4em] text-foreground/40 dark:text-foreground/20 ml-1 mb-2 block">Mood Board</span>
                    <div className="flex flex-col gap-3">
                      {moodBoardImages.slice(0, 10).map((img, idx) => (
                        <div
                          key={`mb-mob-${idx}`}
                          className="relative overflow-hidden bg-foreground/[0.02] rounded-[1.8rem] border border-foreground/[0.05] shadow-sm w-full"
                          style={{ aspectRatio: '16/10' }}
                        >
                          <img
                            src={img}
                            alt={`${product.title} mood ${idx + 1}`}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recently Viewed moved below Curated Pairs */}
              </div>
            </div>

            {/* Mobile Curated Pairs — edge-to-edge, minimal gaps */}
            {shuffledRecommended.length > 0 && (
              <div className="bg-background text-foreground py-4 mt-2 w-full overflow-hidden border-t border-border/50">
                <div className="flex items-center justify-between px-4 mb-4">
                  <h2 className="text-[11px] uppercase tracking-[0.2em] font-heading text-foreground font-bold">
                    CURATED PAIRS
                  </h2>
                  <div className="flex items-center gap-4">
                    <button 
                      className="flex items-center justify-center text-foreground/35 hover:text-foreground transition-all active:scale-95"
                      onClick={() => curatedScrollMobileRef.current?.scrollBy({ left: typeof window !== 'undefined' ? -window.innerWidth * 0.85 : -300, behavior: 'smooth' })}
                      aria-label="Previous Curated Items"
                    >
                      <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                    <button 
                      className="flex items-center justify-center text-foreground/35 hover:text-foreground transition-all active:scale-95"
                      onClick={() => curatedScrollMobileRef.current?.scrollBy({ left: typeof window !== 'undefined' ? window.innerWidth * 0.85 : 300, behavior: 'smooth' })}
                      aria-label="Next Curated Items"
                    >
                      <ArrowRight className="w-4 h-4" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
                
                <div 
                  ref={curatedScrollMobileRef}
                  className="flex overflow-x-auto snap-x snap-mandatory hide-scrollbar scroll-smooth gap-[2px] px-4"
                  style={{ 
                      scrollbarWidth: "none", 
                      msOverflowStyle: "none", 
                      WebkitOverflowScrolling: "touch",
                      scrollSnapType: 'x mandatory'
                  }}
                  onMouseDown={onCuratedMouseDown}
                  onMouseLeave={stopCuratedDrag}
                  onMouseUp={stopCuratedDrag}
                  onMouseMove={onCuratedMouseMove}
                >
                  {shuffledRecommended.map((p, idx) => {
                    const initialPrice = p.variants?.[0]?.price || "0.00";
                    return (
                      <div 
                        key={`mobile-pair-${p.id}-${idx}`}
                        className="min-w-[80vw] w-[80vw] snap-start flex flex-col group cursor-pointer"
                        onClick={(e) => { 
                          if (isCuratedDragging) e.preventDefault(); 
                          else router.push(`/products/${p.handle}`);
                        }}
                      >
                        <div className="relative w-full aspect-[3/5] overflow-hidden bg-background/5">
                          <Image 
                            src={p.image?.src || p.images?.[0]?.src || "/zb-logo-220px.png"} 
                            alt={p.title} 
                            fill 
                            className="object-cover" 
                            sizes="300px" 
                            loading="lazy"
                            onError={handleImageError}
                          />
                        </div>
                        <div className="flex items-center justify-between border-t border-black/[0.03] dark:border-white/[0.03] p-3.5">
                          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                            <span className="text-[9px] font-sans font-bold tracking-[0.12em] uppercase text-foreground line-clamp-1">
                              {p.title}
                            </span>
                            <span className="text-[9px] font-sans font-light text-foreground/50">
                              {fmtPrice(parseFloat(p.variants?.[0]?.price || initialPrice)).formatted}
                            </span>
                          </div>
                          <button
                            className="w-7 h-7 flex items-center justify-center text-foreground/40 hover:text-foreground active:scale-90 transition-all shrink-0 ml-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              setQuickAddProduct(p);
                            }}
                            aria-label="Quick Add to Bag"
                          >
                            <Plus className="w-4 h-4" strokeWidth={1.5} />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Recently Viewed — below Curated Pairs */}
            {recentlyViewed.length > 1 && (
              <div className="bg-background text-foreground py-8 w-full overflow-hidden border-t border-border/50">
                <div className="flex items-center justify-between px-4 mb-3">
                  <h2 className="text-[11px] font-bold tracking-[0.2em] uppercase text-foreground/60 dark:text-foreground/40 font-heading">Recently Viewed</h2>
                </div>
                <div className="grid grid-cols-2 gap-[2px] px-0">
                  {recentlyViewed.filter(p => p.id !== product.id).slice(0, 4).map((p) => <ProductCard key={p.id} product={p} />)}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      {showSizeChart && sizeChartImageUrl && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60" onClick={() => setShowSizeChart(false)}>
          <div className="relative w-full max-w-sm glass border border-foreground/10 rounded-[2.5rem] p-6 shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <span className="text-[8px] font-bold uppercase tracking-widest text-foreground/60 dark:text-foreground/40">Sizing Reference</span>
              <button onClick={() => setShowSizeChart(false)} className="px-4 py-1.5 rounded-full bg-foreground/5 text-[7px] uppercase tracking-widest font-bold">Dismiss</button>
            </div>
            <div className="aspect-square w-full rounded-2xl bg-foreground/[0.03] border border-foreground/5 overflow-hidden relative">
              <Image 
                src={sizeChartImageUrl} 
                alt="Size Guide" 
                fill
                className="object-contain"
                sizes="(max-width: 768px) 100vw, 384px"
              />
            </div>
          </div>
        </div>
      )}

      {/* FULL SCREEN GALLERY MODAL */}
      <AnimatePresence>
        {isGalleryOpen && (
          <FullScreenGallery
            product={product}
            allImages={allImages}
            initialImg={activeImg}
            onClose={() => setIsGalleryOpen(false)}
            onImageChange={(index) => {
              setActiveImg(index);
              if (scrollRef.current) {
                scrollRef.current.scrollLeft = index * scrollRef.current.clientWidth;
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* In-App Checkout WebView (Buy Now) */}
      {checkoutUrl && (
        <CheckoutWebView
          checkoutUrl={checkoutUrl}
          onSuccess={() => { setCheckoutUrl(null); setShowSuccess(true); }}
          onClose={() => setCheckoutUrl(null)}
        />
      )}

      {/* Order Success Screen */}
      <AnimatePresence>
        {showSuccess && (
          <OrderSuccess
            onContinue={() => {
              setShowSuccess(false);
              setCheckoutUrl(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* Quick-Add Modal for Curated Pairs */}
      {quickAddProduct && (
        <QuickAddModal product={quickAddProduct} onClose={() => setQuickAddProduct(null)} />
      )}
    </>
  );
}

interface FullScreenGalleryProps {
  product: ShopifyProduct;
  allImages: any[];
  initialImg: number;
  onClose: () => void;
  onImageChange: (index: number) => void;
}

function FullScreenGallery({
  product,
  allImages,
  initialImg,
  onClose,
  onImageChange
}: FullScreenGalleryProps) {
  const [localActiveImg, setLocalActiveImg] = useState(initialImg);
  const [isZoomed, setIsZoomed] = useState(false);
  const [zoomEnabled, setZoomEnabled] = useState(false);
  const transformRefs = useRef<Record<number, any>>({});
  const lastTap = useRef<number>(0);

  // Manual swipe state — avoids native scroll conflicts with react-zoom-pan-pinch
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const touchCurrentX = useRef(0);
  const isSwiping = useRef(false);
  const isVerticalScroll = useRef(false);
  const touchStartTime = useRef(0);
  const isPinching = useRef(false);

  // Reset zoom when switching images
  useEffect(() => {
    setIsZoomed(false);
    setZoomEnabled(false);
    // Reset transform for previous active image
    Object.values(transformRefs.current).forEach((ref: any) => {
      if (ref?.resetTransform) {
        try { ref.resetTransform(); } catch (e) { /* ignore */ }
      }
    });
  }, [localActiveImg]);

  const goToImage = (index: number) => {
    if (index < 0 || index >= allImages.length || index === localActiveImg || isAnimating) return;
    setIsAnimating(true);
    setLocalActiveImg(index);
    setSwipeOffset(0);
    startTransition(() => {
      onImageChange(index);
    });
    setTimeout(() => setIsAnimating(false), 350);
  };

  // Touch handlers for manual swipe
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length > 1) {
      // Multi-touch = pinch to zoom
      isPinching.current = true;
      setZoomEnabled(true);
      isSwiping.current = false;
      return;
    }

    isPinching.current = false;
    isVerticalScroll.current = false;

    // Double-tap detection for zoom toggle
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300;
    if (now - lastTap.current < DOUBLE_TAP_DELAY) {
      // Double tap
      if (!zoomEnabled) {
        setZoomEnabled(true);
        const activeRef = transformRefs.current[localActiveImg];
        setTimeout(() => {
          if (activeRef?.zoomIn) {
            activeRef.zoomIn(1.5);
          }
        }, 50);
      } else {
        const activeRef = transformRefs.current[localActiveImg];
        if (activeRef?.resetTransform) {
          activeRef.resetTransform();
        }
        setZoomEnabled(false);
        setIsZoomed(false);
      }
      lastTap.current = 0; // Reset to avoid triple tap
      return;
    }
    lastTap.current = now;

    // Single touch — prepare for potential swipe
    if (!isZoomed) {
      touchStartX.current = e.touches[0].clientX;
      touchStartY.current = e.touches[0].clientY;
      touchCurrentX.current = e.touches[0].clientX;
      touchStartTime.current = Date.now();
      isSwiping.current = false; // Will be set true once direction is confirmed
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isPinching.current || isZoomed || e.touches.length > 1) return;

    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const deltaX = currentX - touchStartX.current;
    const deltaY = currentY - touchStartY.current;

    // Determine scroll direction on first significant move
    if (!isSwiping.current && !isVerticalScroll.current) {
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);
      if (absDeltaX > 8 || absDeltaY > 8) {
        if (absDeltaX > absDeltaY) {
          isSwiping.current = true;
        } else {
          isVerticalScroll.current = true;
          return;
        }
      } else {
        return; // Not enough movement yet
      }
    }

    if (isVerticalScroll.current) return;

    if (isSwiping.current) {
      e.preventDefault();
      touchCurrentX.current = currentX;

      // Add resistance at edges
      let offset = deltaX;
      if ((localActiveImg === 0 && deltaX > 0) || (localActiveImg === allImages.length - 1 && deltaX < 0)) {
        offset = deltaX * 0.3; // Rubber band effect
      }
      setSwipeOffset(offset);
    }
  };

  const handleTouchEnd = () => {
    if (isPinching.current) {
      isPinching.current = false;
      return;
    }

    if (!isSwiping.current || isZoomed) {
      isSwiping.current = false;
      return;
    }

    const deltaX = touchCurrentX.current - touchStartX.current;
    const elapsed = Date.now() - touchStartTime.current;
    const velocity = Math.abs(deltaX) / elapsed;
    const threshold = window.innerWidth * 0.2;
    const isQuickSwipe = velocity > 0.4 && Math.abs(deltaX) > 30;

    if (deltaX < -threshold || (isQuickSwipe && deltaX < 0)) {
      // Swipe left → next image
      if (localActiveImg < allImages.length - 1) {
        goToImage(localActiveImg + 1);
      } else {
        setSwipeOffset(0);
      }
    } else if (deltaX > threshold || (isQuickSwipe && deltaX > 0)) {
      // Swipe right → previous image
      if (localActiveImg > 0) {
        goToImage(localActiveImg - 1);
      } else {
        setSwipeOffset(0);
      }
    } else {
      // Snap back
      setSwipeOffset(0);
    }

    isSwiping.current = false;
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-[200] bg-black flex flex-col select-none"
    >
      {/* Gallery Header */}
      <div className="flex justify-between items-center p-6 pt-10 text-white z-10">
        <div className="flex flex-col">
          <span className="text-[10px] font-bold tracking-tighter text-white/95 mb-0.5">{product.title}</span>
          <span className="text-[8px] font-medium text-white/45 uppercase tracking-widest">{localActiveImg + 1} of {allImages.length}</span>
        </div>
        <button 
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center active:scale-90 transition-all text-white/85"
        >
          <X className="w-4.5 h-4.5" />
        </button>
      </div>

      {/* Gallery Main Carousel — manual touch-based swipe */}
      <div
        className="flex-1 relative overflow-hidden flex items-center justify-center w-full"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className="w-full h-full flex will-change-transform"
          style={{
            transform: `translateX(calc(-${localActiveImg * 100}% + ${swipeOffset}px))`,
            transition: isSwiping.current ? 'none' : 'transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          }}
        >
          {allImages.map((img, i) => (
            <div key={`gallery-${img.src || i}`} className="w-full h-full flex-shrink-0 flex items-center justify-center p-2">
              {Math.abs(i - localActiveImg) <= 1 ? (
                <TransformWrapper
                  ref={(ref: any) => { if (ref) transformRefs.current[i] = ref; }}
                  disabled={i !== localActiveImg || !zoomEnabled}
                  initialScale={1}
                  minScale={1}
                  maxScale={4}
                  doubleClick={{ disabled: true }}
                  wheel={{ wheelDisabled: true }}
                  panning={{ disabled: !isZoomed || i !== localActiveImg }}
                  onTransformed={(ref) => {
                    if (i !== localActiveImg) return;
                    const currentScale = ref.state.scale;
                    setIsZoomed(currentScale > 1.05);
                    if (currentScale <= 1.05) {
                      setZoomEnabled(false);
                    }
                  }}
                >
                  <TransformComponent 
                    wrapperClass="!w-full !h-full flex items-center justify-center" 
                    contentClass="!w-full !h-full flex items-center justify-center"
                    wrapperStyle={{ touchAction: isZoomed && i === localActiveImg ? 'none' : 'pan-y' }}
                  >
                    <div className="relative w-full h-[80dvh] cursor-zoom-in">
                      <Image 
                        src={img.src || "/zb-logo-220px.png"} 
                        alt={product.title} 
                        fill 
                        className="object-contain pointer-events-none" 
                        sizes="100vw"
                        priority={i === localActiveImg}
                        onError={handleImageError}
                        draggable={false}
                      />
                    </div>
                  </TransformComponent>
                </TransformWrapper>
              ) : (
                <div className="relative w-full h-[80dvh]">
                  <Image 
                    src={img.src || "/zb-logo-220px.png"} 
                    alt={product.title} 
                    fill 
                    className="object-contain pointer-events-none" 
                    sizes="100vw"
                    onError={handleImageError}
                    draggable={false}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Gallery Nav Indicator Dots */}
      <div className="p-8 pb-12 flex justify-center gap-2">
        {allImages.map((_, i) => (
          <button
            key={`gal-thumb-${i}`}
            onClick={() => {
              if (isZoomed || isAnimating) return;
              goToImage(i);
            }}
            className={`w-1 h-1 rounded-full transition-all duration-500 ${localActiveImg === i ? "w-4 bg-white" : "bg-white/20"}`}
          />
        ))}
      </div>
    </motion.div>
  );
}

