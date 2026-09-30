"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef, useCallback } from "react";
import { useSession, signOut } from "next-auth/react";
import {
  BarChart3,
  Package,
  LogOut,
  User,
  ShoppingCart,
  ArrowLeftRight,
  Undo2,
  ScanLine,
  Settings,
  Bell,
  Monitor,
  BoxSelect,
  LayoutGrid,
  Users,
  ShoppingBag,
  Newspaper,
  Menu,
  Globe,
  FileText,
  MessageSquare,
  Smartphone,
  Building2,
  Star,
  Layers2,
  Coins,
  Truck,
  X,
  TrendingUp,
  Sparkles,
  Megaphone,
  Mail,
  MessageCircle,
  CreditCard,
  Tag,
  History,
  Heart,
  Wallet,
  Bot,
  GraduationCap,
  Database,
  ShieldCheck,
  Search,
  ChevronLeft,
  ChevronRight,
  AlertTriangle
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { useRealtimeSync } from "@/lib/hooks/useRealtime";
import ThemeToggle from "@/components/ThemeToggle";
import ZicaAI from "@/components/ZicaAI";
import AdminPolarisProvider from "@/components/AdminPolarisProvider";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const profileRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const navScrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLAnchorElement>(null);
  useRealtimeSync();

  const [dbStatus, setDbStatus] = useState<{ status: string; isMock?: boolean; mockReason?: string | null; error: string | null; hint?: string | null } | null>(null);

  // Poll DB health every 60s — lightweight check for the persistent banner
  useEffect(() => {
    let cancelled = false;
    const checkDbHealth = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch('/api/admin/db-status', { cache: 'no-store' });
        if (!cancelled) {
          if (res.ok) {
            const data = await res.json();
            setDbStatus({ status: data.status, isMock: data.isMock, mockReason: data.mockReason, error: data.error, hint: data.hint });
          } else {
            setDbStatus({ status: 'error', error: `HTTP ${res.status}` });
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          setDbStatus({ status: 'error', error: e.message });
        }
      }
    };
    checkDbHealth();
    const interval = setInterval(checkDbHealth, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    const val = localStorage.getItem("admin_sidebar_collapsed");
    setIsCollapsed(val === "true");
  }, []);

  const toggleCollapse = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      localStorage.setItem("admin_sidebar_collapsed", String(next));
      return next;
    });
  };

  // Close mobile sidebar and profile dropdown on navigation — but DON'T touch scroll
  useEffect(() => {
    setIsSidebarOpen(false);
    setIsProfileOpen(false);
  }, [pathname]);

  // Poll unread notification count
  useEffect(() => {
    const fetchUnread = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const res = await fetch("/api/admin/notifications/unread-count");
        if (res.ok) {
          const data = await res.json();
          setUnreadCount(data.unreadCount || 0);
        }
      } catch {}
    };
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => clearInterval(interval);
  }, [pathname]);

  // Click outside to close profile dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setIsProfileOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const getInitials = (name?: string | null) => {
    if (!name) return "AD";
    const parts = name.trim().split(/\s+/);
    if (parts.length === 0) return "AD";
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Mandatory password change check
  useEffect(() => {
    if (session?.user && (session.user as any).needsPasswordChange && pathname !== '/dashboard/change-password') {
      router.push('/dashboard/change-password');
    }
  }, [session, pathname, router]);

  // Admin Inactivity Auto-logout (1 hour = 3,600,000 ms)
  useEffect(() => {
    const role = (session?.user as any)?.role;
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") return;

    let inactivityTimer: NodeJS.Timeout;
    const INACTIVITY_LIMIT_MS = 60 * 60 * 1000; // 1 hour

    const resetInactivityTimer = () => {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(async () => {
        console.warn("[AUTH] Auto logging out due to 1 hour of inactivity.");
        await signOut({ callbackUrl: "/dashboard/login" });
      }, INACTIVITY_LIMIT_MS);
    };

    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((evt) => window.addEventListener(evt, resetInactivityTimer, { passive: true }));

    resetInactivityTimer();

    return () => {
      clearTimeout(inactivityTimer);
      events.forEach((evt) => window.removeEventListener(evt, resetInactivityTimer));
    };
  }, [session]);

  // Scroll the active link into view on mount and when pathname changes
  useEffect(() => {
    requestAnimationFrame(() => {
      activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [pathname]);

  const coreNav = [
    { name: "Overview", href: "/dashboard", icon: BarChart3, module: 'DASHBOARD_HOME' },
    { name: "Analytics", href: "/dashboard/analytics", icon: TrendingUp, module: 'ANALYTICS' },
    { name: "Support", href: "/dashboard/support", icon: MessageCircle, module: 'SUPPORT' },
    { name: "Orders", href: "/dashboard/orders", icon: ShoppingBag, module: 'ORDERS' },
    { name: "Mobile Orders", href: "/dashboard/mobile-orders", icon: Smartphone, module: 'MOBILE_ORDERS' },
    { name: "Customers", href: "/dashboard/customers", icon: Users, module: 'CUSTOMERS' },
    { name: "Products", href: "/dashboard/products", icon: Layers2, module: 'PRODUCTS' },
    { name: "Product Reviews", href: "/dashboard/reviews", icon: Star, module: 'PRODUCTS' },
    { name: "Guide", href: "/dashboard/guide", icon: FileText },
  ];

  const webStoreNav = [
    { name: "Web Store Overview", href: "/web-store", icon: BarChart3, module: 'STOREFRONT' },
    { name: "Web Store Orders", href: "/web-store/orders", icon: ShoppingBag, module: 'STOREFRONT' },
    { name: "Web Store Customers", href: "/web-store/customers", icon: Users, module: 'STOREFRONT' },
    { name: "Abandoned Carts", href: "/web-store/abandoned-carts", icon: ShoppingCart, module: 'STOREFRONT' },
    { name: "Web Storefront", href: "/web-store/storefront", icon: Monitor, module: 'STOREFRONT' },
    { name: "Homepage Products", href: "/web-store/homepage", icon: LayoutGrid, module: 'STOREFRONT' },
    { name: "All Products", href: "/web-store/products", icon: Sparkles, module: 'STOREFRONT' },
    { name: "Homepage Banners", href: "/web-store/banners", icon: Monitor, module: 'STOREFRONT' },
    { name: "Gallery CMS", href: "/web-store/gallery", icon: Sparkles, module: 'STOREFRONT' },
    { name: "Global Store", href: "/dashboard/global-store", icon: Globe, module: 'STOREFRONT' },
    { name: "Preferences", href: "/dashboard/webstore-settings/preferences", icon: Settings, module: 'STOREFRONT' },
  ];

  const operationalNav = [
    { name: "Collections", href: "/dashboard/collections", icon: Package, module: 'PRODUCTS' },
    { name: "Inventory", href: "/dashboard/inventory", icon: BoxSelect, module: 'INVENTORY' },
    { name: "Scanner", href: "/dashboard/inventory/scanner", icon: ScanLine, module: 'INVENTORY' },
    { name: "Scanner Records", href: "/dashboard/scanner-records", icon: FileText, module: 'INVENTORY' },
    { name: "Price Tags", href: "/dashboard/price-tags", icon: Tag, module: 'INVENTORY' },
    { name: "Returns", href: "/dashboard/returns", icon: Undo2, module: 'RETURNS_EXCHANGES' },
    { name: "Exchanges", href: "/dashboard/exchanges", icon: ArrowLeftRight, module: 'RETURNS_EXCHANGES' },
    { name: "Refunds", href: "/dashboard/refunds", icon: Coins, module: 'RETURNS_EXCHANGES' },
    { name: "Logistics", href: "/dashboard/logistics", icon: Truck, module: 'LOGISTICS' },
  ];

  const aestheticNav = [
    { name: "Chat Management", href: "/dashboard/community/chat", icon: MessageSquare, module: 'COMMUNITY' },
    { name: "Community", href: "/dashboard/community", icon: Users, module: 'COMMUNITY' },
    { name: "Blogs", href: "/dashboard/blogs", icon: Newspaper, module: 'COMMUNITY' },
    { name: "Policies", href: "/dashboard/policies", icon: FileText, module: 'STOREFRONT' },
  ];

  const integrationNav = [
    { name: "App Integration", href: "/dashboard/app-integration", icon: Smartphone, module: 'INTEGRATIONS' },
    { name: "Live Carts", href: "/dashboard/live-carts", icon: ShoppingCart, module: 'INTEGRATIONS' },
    { name: "App Login Logs", href: "/dashboard/app-logins", icon: History, module: 'INTEGRATIONS' },
    { name: "Razorpay", href: "/dashboard/payments/razorpay", icon: CreditCard, module: 'INTEGRATIONS' },
    { name: "Global Store", href: "/dashboard/global-store", icon: Globe, module: 'INTEGRATIONS' },
  ];

  const intelligenceNav = [
    { name: "Zica AI Hub", href: "/dashboard/ai", icon: Sparkles, module: 'AI_SERVICES' },
    { name: "Zica AI - Admin", href: "/dashboard/ai/admin", icon: Settings, module: 'AI_SERVICES' },
    { name: "Zica AI - User", href: "/dashboard/ai/user", icon: Bot, module: 'AI_SERVICES' },
    { name: "Zica AI - Training", href: "/dashboard/ai/training", icon: GraduationCap, module: 'AI_SERVICES' },
  ];



  const marketingNav = [
    { name: "SEO Dashboard", href: "/dashboard/marketing/seo", icon: Search, module: 'MARKETING' },
    { name: "Omnichannel Analytics", href: "/dashboard/marketing/analytics", icon: BarChart3, module: 'MARKETING' },
    { name: "Meta Pixel", href: "/dashboard/marketing/meta-pixel", icon: ShieldCheck, module: 'MARKETING' },
    { name: "Wishlist Management", href: "/dashboard/wishlist", icon: Heart, module: 'MARKETING' },
    { name: "Push Notifications", href: "/dashboard/notifications", icon: Bell, module: 'MARKETING' },
    { name: "Discounts", href: "/dashboard/marketing/discounts", icon: Tag, module: 'MARKETING' },
    { name: "WhatsApp Hub", href: "/dashboard/marketing/whatsapp", icon: MessageCircle, module: 'MARKETING' },
    { name: "Email Center", href: "/dashboard/marketing/email", icon: Mail, module: 'MARKETING' },
    { name: "SMS Campaigns", href: "/dashboard/marketing/sms", icon: MessageSquare, module: 'MARKETING' },
    { name: "Affiliates", href: "/dashboard/affiliates", icon: Users, module: 'AFFILIATES' },
    { name: "Affiliate Payouts", href: "/dashboard/affiliates/withdrawals", icon: Wallet, module: 'AFFILIATES' },
  ];

  const whatsappEventsNav = [
    { name: "Overview", href: "/dashboard/whatsapp-events/overview", icon: BarChart3, module: 'MARKETING' },
    { name: "Live Chat", href: "/dashboard/whatsapp-events/chat", icon: MessageSquare, module: 'MARKETING' },
    { name: "Chat Media", href: "/dashboard/whatsapp-events/media", icon: Image, module: 'MARKETING' },
    { name: "Events Feed", href: "/dashboard/whatsapp-events/events", icon: Database, module: 'MARKETING' },
    { name: "Campaign Analytics", href: "/dashboard/whatsapp-events/campaign-analytics", icon: TrendingUp, module: 'MARKETING' },
    { name: "Templates Manager", href: "/dashboard/whatsapp-events/templates", icon: FileText, module: 'MARKETING' },
    { name: "Customer Journeys", href: "/dashboard/whatsapp-events/customer-journeys", icon: History, module: 'MARKETING' },
    { name: "Meta Review", href: "/dashboard/whatsapp-events/meta-review", icon: ShieldCheck, module: 'MARKETING' },
  ];

  const financialNav = [
    { name: "Payments", href: "/dashboard/payments", icon: CreditCard, module: 'FINANCIAL' },
    { name: "Transactions", href: "/dashboard/transactions", icon: CreditCard, module: 'FINANCIAL' },
    { name: "Store Credits", href: "/dashboard/payments/store-credits", icon: Wallet, module: 'FINANCIAL' },
    { name: "Refunds", href: "/dashboard/refunds", icon: ArrowLeftRight, module: 'FINANCIAL' },
  ];

  const userPermissions = (session?.user as any)?.permissions || [];
  const userRole = (session?.user as any)?.role;

  const hasPermission = useCallback((moduleName: string) => {
    if (userRole === 'SUPER_ADMIN') return true;
    const perm = userPermissions.find((p: any) => p.module === moduleName);
    return perm?.canView;
  }, [userRole, userPermissions]);

  const hasPageAccess = useCallback((item: { href: string; module?: string }) => {
    if (userRole === 'SUPER_ADMIN') return true;
    if (!item.module) return true;

    const perm = userPermissions.find((p: any) => p.module === item.module);
    if (!perm || !perm.canView) return false;

    if (perm.pages) {
      const allowedPages = (perm.pages as string).split(',');
      return allowedPages.includes(item.href);
    }

    return true;
  }, [userRole, userPermissions]);

  const filterNav = (navItems: any[]) => {
    return navItems.filter(item => hasPageAccess(item));
  };

  const isSuperAdmin = (session?.user as any)?.role === 'SUPER_ADMIN';

  const systemNav = [
    { name: "Admin Users", href: "/dashboard/admin-users", icon: Users, module: 'ADMIN_USERS' },
    { name: "Audit Log", href: "/dashboard/audit-log", icon: History, module: 'AUDIT_LOG' },
  ];

  const isActive = useCallback(
    (href: string) =>
      pathname === href || (href !== "/dashboard" && href !== "/web-store" && pathname.startsWith(href)),
    [pathname]
  );

  const NavLink = useCallback(
    ({ item }: { item: { name: string; href: string; icon: any } }) => {
      const active = isActive(item.href);
      const Icon = item.icon;
      return (
        <Link
          ref={active ? activeRef : undefined}
          href={item.href}
          title={isCollapsed ? item.name : undefined}
          className={`group flex items-center transition-all duration-300 relative overflow-hidden ${
            isCollapsed
              ? "lg:p-0 lg:justify-center lg:h-10 lg:w-10 lg:mx-auto lg:rounded-xl gap-4 px-5 py-2.5 rounded-2xl w-full lg:w-auto"
              : "gap-4 px-5 py-2.5 rounded-2xl w-full"
          } ${
            active
              ? "text-foreground bg-foreground/10 shadow-lg border border-foreground/10"
              : "text-foreground/60 hover:text-foreground hover:bg-foreground/5"
          }`}
        >
          <Icon
            className={`w-[18px] h-[18px] shrink-0 transition-colors duration-300 ${
              active ? "text-foreground" : "opacity-40 group-hover:opacity-100"
            }`}
            strokeWidth={active ? 2 : 1.5}
          />
          <span className={`text-[12px] font-medium relative z-10 truncate ${isCollapsed ? "lg:hidden" : ""}`}>{item.name}</span>
          {active && (
            <motion.div
              layoutId="activeNav"
              className={`absolute inset-0 bg-gradient-to-r from-foreground/5 to-transparent -z-10 ${isCollapsed ? "lg:hidden" : ""}`}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
            />
          )}
        </Link>
      );
    },
    [isActive, isCollapsed]
  );

  const SectionLabel = ({ children: label }: { children: React.ReactNode }) => (
    <div className={`mb-2 px-5 transition-all duration-300 ${isCollapsed ? "lg:opacity-0 lg:h-0 lg:overflow-hidden lg:mb-0" : ""}`}>
      <span className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider font-inter">
        {label}
      </span>
    </div>
  );

  const isLoginPage = pathname === "/dashboard/login";
  if (isLoginPage) return <>{children}</>;

  const pageTitle =
    pathname === "/dashboard"
      ? "Overview"
      : pathname
          .split("/")
          .filter(Boolean)
          .pop()
          ?.replace(/-/g, " ")
          .replace(/\b\w/g, (l) => l.toUpperCase());

  return (
    <AdminPolarisProvider>
      <div className="min-h-[100dvh] flex text-foreground bg-background dark:bg-[#0A0A0A] font-sans selection:bg-foreground/20 selection:text-foreground">
      {/* Subtle background */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden bg-background" aria-hidden="true">
        <div
          className="absolute inset-0 bg-center opacity-[0.03] dark:opacity-[0.05]"
          style={{ backgroundImage: "url('/grid.svg')" }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(var(--primary),0.05),transparent_70%),radial-gradient(circle_at_bottom_right,rgba(var(--primary),0.05),transparent_70%)] opacity-60" />
      </div>

      {/* Mobile overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-background/60 backdrop-blur-md z-[55] lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* ──────── Sidebar ──────── */}
      <aside
        className={`fixed inset-y-0 left-0 lg:m-4 lg:rounded-[2.5rem] glass overflow-hidden border-r lg:border border-foreground/5 shadow-3xl z-[60] flex flex-col transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] lg:translate-x-0 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        } ${isCollapsed ? "lg:w-20 w-72" : "w-72"}`}
      >
        <div className={`flex flex-col h-full pt-6 lg:pt-10 pb-4 lg:pb-8 transition-all duration-300 ${isCollapsed ? "lg:px-2 px-4" : "px-4 lg:px-6"}`}>
          {/* Brand + close button (mobile) */}
          <div className={`mb-8 lg:mb-10 flex items-center justify-between ${isCollapsed ? "lg:px-0 lg:flex-col lg:gap-3 lg:justify-center px-4" : "px-4"}`}>
            <div className={`flex items-center gap-4 ${isCollapsed ? "lg:flex-col lg:justify-center" : ""}`}>
              <div className="w-10 h-10 bg-foreground/5 text-foreground rounded-2xl flex items-center justify-center shadow-lg border border-foreground/10 backdrop-blur-md shrink-0">
                <Image
                  src="/zb-logo-220px.png"
                  alt="Logo"
                  width={30}
                  height={30}
                  priority
                  className="dark:brightness-200 dark:grayscale dark:contrast-200"
                />
              </div>
              <div className={`flex flex-col ${isCollapsed ? "lg:hidden" : ""}`}>
                <span className="text-[14px] font-semibold text-foreground/90 font-inter">
                  Zica Bella
                </span>
                <span className="text-[10px] text-foreground/40 mt-0.5 font-medium font-inter">
                  System Configurator
                </span>
              </div>
            </div>

            {/* Collapse toggle button on desktop */}
            <button
              onClick={toggleCollapse}
              className={`flex max-lg:hidden p-1.5 rounded-lg bg-foreground/5 text-foreground/50 hover:text-foreground hover:bg-foreground/10 border border-foreground/10 transition-all shrink-0 ${isCollapsed ? "mt-2" : ""}`}
              title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            >
              {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
            </button>

            <button
              onClick={() => setIsSidebarOpen(false)}
              className="lg:hidden p-2 rounded-xl text-foreground/40 hover:text-foreground hover:bg-foreground/5"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable nav — ref preserved across renders */}
          <div
            ref={navScrollRef}
            className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar space-y-6 pr-1 -mr-1"
          >
            <div>
              <SectionLabel>Core Services</SectionLabel>
              <div className="space-y-0.5">
                {filterNav(coreNav).map((item) => (
                  <NavLink key={item.name} item={item} />
                ))}
              </div>
            </div>

            {filterNav(webStoreNav).length > 0 && (
              <div>
                <SectionLabel>Web Store CMS</SectionLabel>
                <div className="space-y-0.5">
                  {filterNav(webStoreNav).map((item) => (
                    <NavLink key={item.name} item={item} />
                  ))}
                </div>
              </div>
            )}

            {filterNav(operationalNav).length > 0 && (
              <div>
                <SectionLabel>Logistics</SectionLabel>
                <div className="space-y-0.5">
                  {filterNav(operationalNav).map((item) => (
                    <NavLink key={item.name} item={item} />
                  ))}
                </div>
              </div>
            )}

            {filterNav(aestheticNav).length > 0 && (
              <div>
                <SectionLabel>Experience</SectionLabel>
                <div className="space-y-0.5">
                  {filterNav(aestheticNav).map((item) => (
                    <NavLink key={item.name} item={item} />
                  ))}
                </div>
              </div>
            )}

            {filterNav(financialNav).length > 0 && (
              <div>
                <SectionLabel>Financial</SectionLabel>
                <div className="space-y-0.5">
                  {filterNav(financialNav).map((item) => (
                    <NavLink key={item.name} item={item} />
                  ))}
                </div>
              </div>
            )}

            {filterNav(integrationNav).length > 0 && (
              <div>
                <SectionLabel>Integration</SectionLabel>
                <div className="space-y-0.5">
                  {filterNav(integrationNav).map((item) => (
                    <NavLink key={item.name} item={item} />
                  ))}
                </div>
              </div>
            )}

            {filterNav(intelligenceNav).length > 0 && (
              <div>
                <div className="mb-2 px-5 flex items-center gap-2">
                  <Sparkles className="w-3 h-3 text-violet-400" strokeWidth={2} />
                  <span className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider font-inter">
                    Intelligence
                  </span>
                </div>
                <div className="space-y-0.5">
                  {filterNav(intelligenceNav).map((item) => (
                    <NavLink key={item.name} item={item} />
                  ))}
                </div>
              </div>
            )}

            {filterNav(marketingNav).length > 0 && (
              <div>
                <div className="mb-2 px-5 flex items-center gap-2">
                  <Megaphone className="w-3 h-3 text-foreground/40" strokeWidth={2} />
                  <span className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider font-inter">
                    Marketing
                  </span>
                </div>
                <div className="space-y-0.5">
                  {filterNav(marketingNav).map((item) => (
                    <NavLink key={item.name} item={item} />
                  ))}
                </div>
              </div>
            )}

            {filterNav(whatsappEventsNav).length > 0 && (
              <div>
                <div className="mb-2 px-5 flex items-center gap-2">
                  <MessageCircle className="w-3 h-3 text-emerald-400" strokeWidth={2} />
                  <span className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider font-inter">
                    WhatsApp Events
                  </span>
                </div>
                <div className="space-y-0.5">
                  {filterNav(whatsappEventsNav).map((item) => (
                    <NavLink key={item.name} item={item} />
                  ))}
                </div>
              </div>
            )}



            {filterNav(systemNav).length > 0 && (
              <div>
                <SectionLabel>System Management</SectionLabel>
                <div className="space-y-0.5">
                  {filterNav(systemNav).map((item) => (
                    <NavLink key={item.name} item={item} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Settings — always visible at bottom if permitted */}
          {hasPermission('SETTINGS') && (
            <div className="mt-4 pt-3 border-t border-foreground/[0.06]">
              <Link
                ref={pathname === "/dashboard/settings" ? activeRef : undefined}
                href="/dashboard/settings"
                title={isCollapsed ? "Settings" : undefined}
                className={`flex items-center transition-all duration-300 ${
                  isCollapsed
                    ? "lg:p-0 lg:justify-center lg:h-10 lg:w-10 lg:mx-auto lg:rounded-xl gap-3 px-5 py-2.5 rounded-xl w-full"
                    : "gap-3 px-5 py-2.5 rounded-xl w-full"
                } ${
                  pathname === "/dashboard/settings"
                    ? "bg-foreground text-background shadow-lg shadow-black/10"
                    : "text-foreground/50 hover:text-foreground hover:bg-foreground/[0.04]"
                }`}
              >
                <Settings
                  className="w-4 h-4 shrink-0"
                  strokeWidth={pathname === "/dashboard/settings" ? 2 : 1.5}
                />
                <span className={`text-[12px] font-medium font-inter ${isCollapsed ? "lg:hidden" : ""}`}>Settings</span>
              </Link>
            </div>
          )}
        </div>
      </aside>

      {/* ──────── Main content ──────── */}
      <main className={`flex-1 flex flex-col min-h-[100dvh] relative z-10 overflow-x-hidden transition-all duration-300 ${
        isCollapsed ? "lg:ml-28" : "lg:ml-80"
      }`}>
        {/* Header */}
        <header className="h-14 lg:h-16 flex items-center justify-between px-4 lg:px-8 m-2 lg:mx-8 lg:my-6 rounded-3xl glass shadow-2xl sticky top-2 lg:top-6 z-40 border border-foreground/5 shrink-0">
          <div className="flex items-center gap-3 lg:gap-6 min-w-0">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden p-2 rounded-2xl bg-foreground/5 text-foreground/60 hover:text-foreground transition-colors border border-foreground/10"
            >
              <Menu className="w-5 h-5" />
            </button>
            {/* Desktop toggle collapse */}
            <button
              onClick={toggleCollapse}
              className="flex max-lg:hidden p-2 rounded-2xl bg-foreground/5 text-foreground/60 hover:text-foreground hover:bg-foreground/10 transition-colors border border-foreground/10 shrink-0"
              title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            >
              {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
            <h2 className="text-[14px] lg:text-[16px] font-semibold text-foreground font-inter truncate">
              {pageTitle}
            </h2>
          </div>

          <div className="flex items-center gap-2 lg:gap-4">
            <ThemeToggle />
            <div className="hidden sm:block w-[1px] h-4 bg-foreground/10" />
            <Link
              href="/dashboard/admin-notifications"
              className="hidden sm:flex w-9 h-9 items-center justify-center rounded-2xl bg-foreground/5 text-foreground/40 hover:text-foreground transition-all border border-foreground/5 relative"
            >
              <Bell className="w-[18px] h-[18px]" />
              {unreadCount > 0 && pathname !== '/dashboard/admin-notifications' && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-blue-500 text-white text-[9px] font-bold shadow-lg shadow-blue-500/30"
                >
                  {unreadCount > 99 ? '99+' : unreadCount}
                </motion.span>
              )}
            </Link>
            
            <div ref={profileRef} className="relative">
              <button
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className="flex items-center gap-2 lg:gap-3 p-1 lg:p-1.5 pl-3 lg:pl-4 bg-foreground/5 border border-foreground/10 hover:bg-foreground/10 transition-all rounded-full group shadow-inner"
              >
                <span className="hidden sm:inline text-[12px] font-medium text-foreground/60 group-hover:text-foreground transition-colors font-inter">
                  {session?.user?.name || "Admin"}
                </span>
                <div className="h-7 w-7 rounded-full bg-foreground text-background flex items-center justify-center shadow-2xl transition-transform group-hover:scale-105 duration-500">
                  <span className="text-[10px] font-medium font-inter">{getInitials(session?.user?.name)}</span>
                </div>
              </button>

              <AnimatePresence>
                {isProfileOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="absolute right-0 mt-3 w-56 rounded-2xl glass border border-foreground/10 shadow-2xl z-50 overflow-hidden py-1.5 backdrop-blur-xl"
                  >
                    <div className="px-4 py-2 border-b border-foreground/5 mb-1">
                      <div className="text-[12px] font-semibold text-foreground truncate">
                        {session?.user?.name || "Admin"}
                      </div>
                      <div className="text-[10px] text-foreground/40 truncate">
                        {session?.user?.email || "admin@zicabella.in"}
                      </div>
                    </div>

                    <Link
                      href="/dashboard/change-password"
                      onClick={() => setIsProfileOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2 text-[12px] text-foreground/75 hover:text-foreground hover:bg-foreground/5 transition-colors font-medium font-inter"
                    >
                      <User className="w-4 h-4 opacity-60" />
                      Profile Settings
                    </Link>

                    {isSuperAdmin && (
                      <Link
                        href="/dashboard/admin-users"
                        onClick={() => setIsProfileOpen(false)}
                        className="flex items-center gap-2.5 px-4 py-2 text-[12px] text-foreground/75 hover:text-foreground hover:bg-foreground/5 transition-colors font-medium font-inter"
                      >
                        <Users className="w-4 h-4 opacity-60" />
                        Admin Management
                      </Link>
                    )}

                    <Link
                      href="/dashboard/settings"
                      onClick={() => setIsProfileOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2 text-[12px] text-foreground/75 hover:text-foreground hover:bg-foreground/5 transition-colors font-medium font-inter"
                    >
                      <Settings className="w-4 h-4 opacity-60" />
                      System Config
                    </Link>

                    <div className="h-[1px] bg-foreground/5 my-1" />

                    <button
                      onClick={() => {
                        setIsProfileOpen(false);
                        signOut({ callbackUrl: "/dashboard/login" });
                      }}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-[12px] text-red-500 hover:bg-red-500/10 hover:text-red-600 transition-all font-medium font-inter text-left"
                    >
                      <LogOut className="w-4 h-4" />
                      Logout
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </header>

        {/* Content area — scrollable */}
        <div className="flex-1 px-4 lg:px-8 py-4 lg:py-8 overflow-y-auto overflow-x-hidden custom-scrollbar relative w-full">
          {/* DB Unavailable / Mock Fallback Banner */}
          {dbStatus && (dbStatus.status !== 'connected' || dbStatus.isMock) && (
            <div className="max-w-[1400px] w-full mx-auto mb-4">
              <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border backdrop-blur-sm text-sm font-medium ${
                dbStatus.isMock 
                  ? 'border-purple-500/30 bg-purple-500/10 text-purple-200 dark:text-purple-300'
                  : 'border-amber-500/20 bg-amber-500/10 text-amber-200 dark:text-amber-300'
              }`}>
                <AlertTriangle className={`w-4 h-4 shrink-0 ${dbStatus.isMock ? 'text-purple-400' : 'text-amber-400'}`} />
                <span className="flex-1">
                  {dbStatus.isMock ? (
                    <>
                      Running on Mock Database Fallback (ALLOW_DB_MOCK=true). Real database is unreachable.
                      {dbStatus.mockReason && <span className="opacity-80 ml-1 text-xs block mt-0.5">Reason: {dbStatus.mockReason}</span>}
                    </>
                  ) : (
                    <>
                      Database connection issue — real data may be unavailable.
                      {dbStatus.hint && <span className="opacity-80 ml-1 text-xs block mt-0.5">{dbStatus.hint}</span>}
                      {dbStatus.error && !dbStatus.hint && <span className="opacity-70 ml-1 text-xs">({dbStatus.error})</span>}
                    </>
                  )}
                </span>
                <a
                  href="/api/admin/db-status"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`text-xs underline underline-offset-2 shrink-0 ${dbStatus.isMock ? 'text-purple-300 hover:text-purple-200' : 'text-amber-400 hover:text-amber-300'}`}
                >
                  Check status →
                </a>
              </div>
            </div>
          )}
          <div className="max-w-[1400px] w-full mx-auto relative overflow-x-clip">{children}</div>
        </div>
      </main>

      {/* Zica AI — Floating Command Center */}
      <ZicaAI />
    </div>
  </AdminPolarisProvider>
  );
}
