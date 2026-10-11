"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useRef, useCallback } from "react";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard,
  ShoppingBag,
  Users,
  Image as ImageIcon,
  Tag,
  ArrowLeft,
  Menu,
  X,
  Bell,
  User,
  LogOut,
  Settings,
  Sparkles,
  History
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import ThemeToggle from "@/components/ThemeToggle";

interface WebStoreAdminLayoutProps {
  children: React.ReactNode;
  user?: {
    name?: string | null;
    email?: string | null;
    role?: string | null;
  };
}

export default function WebStoreAdminLayout({ children, user }: WebStoreAdminLayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    setIsSidebarOpen(false);
    setIsProfileOpen(false);
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

  const navItems = [
    { name: "Overview", href: "/web-store", icon: LayoutDashboard },
    { name: "Web Store Orders", href: "/web-store/orders", icon: ShoppingBag },
    { name: "Web Store Customers", href: "/web-store/customers", icon: Users },
    { name: "Login Logs", href: "/web-store/logins", icon: History },
    { name: "Banners / CMS", href: "/web-store/banners", icon: ImageIcon },
    { name: "Gallery CMS", href: "/web-store/gallery", icon: Sparkles },
    { name: "Coupons", href: "/web-store/coupons", icon: Tag },
  ];

  const isActive = useCallback(
    (href: string) => pathname === href || (href !== "/web-store" && pathname.startsWith(href)),
    [pathname]
  );

  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  const getPageTitle = () => {
    if (pathname === "/web-store") return "Web Store Overview";
    const segment = pathname.split("/").filter(Boolean)[1];
    if (!segment) return "Web Store";
    return `Web Store ${segment.charAt(0).toUpperCase() + segment.slice(1)}`;
  };

  return (
    <div className="min-h-[100dvh] flex text-foreground bg-background dark:bg-[#0A0A0A] font-sans selection:bg-foreground/20 selection:text-foreground">
      {/* Subtle glass background effects */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden bg-background" aria-hidden="true">
        <div
          className="absolute inset-0 bg-center opacity-[0.03] dark:opacity-[0.05]"
          style={{ backgroundImage: "url('/grid.svg')" }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(212,175,55,0.05),transparent_70%),radial-gradient(circle_at_bottom_right,rgba(212,175,55,0.05),transparent_70%)] opacity-60" />
      </div>

      {/* Mobile sidebar overlay */}
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
        className={`fixed inset-y-0 left-0 w-72 lg:m-4 lg:rounded-[2.5rem] glass overflow-hidden border-r lg:border border-foreground/5 shadow-3xl z-[60] flex flex-col transition-transform duration-500 ease-apple lg:translate-x-0 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex flex-col h-full px-4 lg:px-6 pt-6 lg:pt-10 pb-4 lg:pb-8">
          {/* Brand header */}
          <div className="mb-8 lg:mb-10 px-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-foreground/5 text-foreground rounded-2xl flex items-center justify-center shadow-lg border border-foreground/10 backdrop-blur-md">
                <Image
                  src="/zb-logo-220px.png"
                  alt="Logo"
                  width={30}
                  height={30}
                  priority
                  className="dark:brightness-200 dark:grayscale dark:contrast-200"
                />
              </div>
              <div className="flex flex-col">
                <span className="text-[14px] font-semibold text-foreground/90 font-inter">
                  Zica Bella
                </span>
                <span className="text-[10px] text-amber-500/80 mt-0.5 font-semibold font-inter uppercase tracking-wider flex items-center gap-1">
                  <Sparkles className="w-2.5 h-2.5" /> Web Store
                </span>
              </div>
            </div>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="lg:hidden p-2 rounded-xl text-foreground/40 hover:text-foreground hover:bg-foreground/5"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Links */}
          <div className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar space-y-6 pr-1 -mr-1">
            <div>
              <div className="mb-2 px-5">
                <span className="text-[10px] font-semibold text-foreground/40 uppercase tracking-wider font-inter">
                  Store Management
                </span>
              </div>
              <div className="space-y-1">
                {navItems.map((item) => {
                  const active = isActive(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={`group flex items-center gap-4 px-5 py-3 rounded-2xl transition-all duration-300 relative overflow-hidden ${
                        active
                          ? "text-foreground bg-foreground/10 shadow-lg border border-foreground/10"
                          : "text-foreground/60 hover:text-foreground hover:bg-foreground/5"
                      }`}
                    >
                      <Icon
                        className={`w-[18px] h-[18px] shrink-0 transition-colors duration-300 ${
                          active ? "text-amber-500" : "opacity-40 group-hover:opacity-100"
                        }`}
                        strokeWidth={active ? 2 : 1.5}
                      />
                      <span className="text-[12px] font-medium relative z-10 truncate">{item.name}</span>
                      {active && (
                        <motion.div
                          layoutId="activeNav"
                          className="absolute inset-0 bg-gradient-to-r from-amber-500/5 to-transparent -z-10"
                          transition={{ type: "spring", stiffness: 300, damping: 30 }}
                        />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Back to Core Configurator button */}
          <div className="mt-4 pt-4 border-t border-foreground/[0.06] space-y-2">
            <Link
              href="/dashboard"
              className="flex items-center gap-3 px-5 py-3 rounded-xl transition-all duration-300 text-amber-500 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 hover:text-amber-400"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-[12px] font-semibold font-inter">Core Configurator</span>
            </Link>
          </div>
        </div>
      </aside>

      {/* ──────── Main Content ──────── */}
      <main className="flex-1 lg:ml-80 flex flex-col min-h-[100dvh] relative z-10 overflow-x-hidden">
        {/* Header */}
        <header className="h-14 lg:h-16 flex items-center justify-between px-4 lg:px-8 m-2 lg:mx-8 lg:my-6 rounded-3xl glass shadow-2xl sticky top-2 lg:top-6 z-40 border border-foreground/5 shrink-0">
          <div className="flex items-center gap-3 lg:gap-6 min-w-0">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden p-2 rounded-2xl bg-foreground/5 text-foreground/60 hover:text-foreground transition-colors border border-foreground/10"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="text-[14px] lg:text-[16px] font-semibold text-foreground font-inter truncate">
              {getPageTitle()}
            </h2>
          </div>

          <div className="flex items-center gap-2 lg:gap-4">
            <ThemeToggle />
            <div className="hidden sm:block w-[1px] h-4 bg-foreground/10" />

            <div ref={profileRef} className="relative">
              <button
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className="flex items-center gap-2 lg:gap-3 p-1 lg:p-1.5 pl-3 lg:pl-4 bg-foreground/5 border border-foreground/10 hover:bg-foreground/10 transition-all rounded-full group shadow-inner"
              >
                <span className="hidden sm:inline text-[12px] font-medium text-foreground/60 group-hover:text-foreground transition-colors font-inter">
                  {user?.name || "Admin"}
                </span>
                <div className="h-7 w-7 rounded-full bg-amber-500 text-black flex items-center justify-center shadow-2xl transition-transform group-hover:scale-105 duration-500">
                  <span className="text-[10px] font-bold font-inter">{getInitials(user?.name)}</span>
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
                        {user?.name || "Admin"}
                      </div>
                      <div className="text-[10px] text-foreground/40 truncate">
                        {user?.email || "admin@zicabella.in"}
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

        {/* Content area */}
        <div className="flex-1 px-4 lg:px-8 py-4 lg:py-8 overflow-y-auto overflow-x-hidden custom-scrollbar relative w-full">
          <div className="max-w-[1400px] w-full mx-auto relative overflow-x-clip">{children}</div>
        </div>
      </main>
    </div>
  );
}
