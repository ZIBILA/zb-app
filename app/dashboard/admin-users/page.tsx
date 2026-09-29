"use client";

import React, { useState, useEffect } from 'react';
import { 
  Users, 
  UserPlus, 
  Shield, 
  Mail, 
  Calendar, 
  Edit2, 
  Trash2, 
  Key, 
  ChevronRight,
  Plus,
  Check,
  X,
  AlertCircle,
  Loader2,
  MoreVertical,
  ShieldCheck,
  Lock,
  Unlock,
  RefreshCw,
  Search
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from 'next-auth/react';
import { toast } from 'sonner';

const MODULES = [
  { id: 'DASHBOARD_HOME', label: 'Dashboard Home' },
  { id: 'SUPPORT', label: 'Support' },
  { id: 'ORDERS', label: 'Orders' },
  { id: 'MOBILE_ORDERS', label: 'Mobile Orders' },
  { id: 'CUSTOMERS', label: 'Customers' },
  { id: 'PRODUCTS', label: 'Products' },
  { id: 'INVENTORY', label: 'Inventory' },
  { id: 'LOGISTICS', label: 'Logistics' },
  { id: 'RETURNS_EXCHANGES', label: 'Returns & Exchanges' },
  { id: 'STOREFRONT', label: 'Storefront' },
  { id: 'COMMUNITY', label: 'Community' },
  { id: 'MARKETING', label: 'Marketing' },
  { id: 'MANUFACTURING', label: 'Manufacturing' },
  { id: 'FINANCIAL', label: 'Financial' },
  { id: 'INTEGRATIONS', label: 'Integrations' },
  { id: 'AI_SERVICES', label: 'AI Services' },
  { id: 'SETTINGS', label: 'Settings' },
  { id: 'ADMIN_USERS', label: 'Admin Users' },
  { id: 'AUDIT_LOG', label: 'Audit Log' },
];

const MODULE_PAGES: Record<string, { name: string; href: string }[]> = {
  DASHBOARD_HOME: [
    { name: "Overview", href: "/dashboard" }
  ],
  SUPPORT: [
    { name: "Support List", href: "/dashboard/support" }
  ],
  ORDERS: [
    { name: "Orders List", href: "/dashboard/orders" }
  ],
  MOBILE_ORDERS: [
    { name: "Mobile Orders List", href: "/dashboard/mobile-orders" }
  ],
  CUSTOMERS: [
    { name: "Customers List", href: "/dashboard/customers" }
  ],
  PRODUCTS: [
    { name: "Products List", href: "/dashboard/products" },
    { name: "Collections", href: "/dashboard/collections" },
  ],
  INVENTORY: [
    { name: "Inventory Management", href: "/dashboard/inventory" },
    { name: "Barcode Scanner", href: "/dashboard/inventory/scanner" },
    { name: "Scanner Records", href: "/dashboard/scanner-records" },
    { name: "Price Tags Creator", href: "/dashboard/price-tags" },
  ],
  LOGISTICS: [
    { name: "Logistics Hub", href: "/dashboard/logistics" }
  ],
  RETURNS_EXCHANGES: [
    { name: "Returns Portal", href: "/dashboard/returns" },
    { name: "Exchanges Portal", href: "/dashboard/exchanges" },
    { name: "Refunds Portal", href: "/dashboard/refunds" },
  ],
  STOREFRONT: [
    { name: "Overview Dashboard", href: "/web-store" },
    { name: "Orders List", href: "/web-store/orders" },
    { name: "Customers List", href: "/web-store/customers" },
    { name: "Abandoned Carts", href: "/web-store/abandoned-carts" },
    { name: "Web Storefront config", href: "/web-store/storefront" },
    { name: "Homepage Products", href: "/web-store/homepage" },
    { name: "All Products", href: "/web-store/products" },
    { name: "Homepage Banners CMS", href: "/web-store/banners" },
    { name: "Public Gallery CMS", href: "/web-store/gallery" },
    { name: "Promo Coupons", href: "/web-store/coupons" },
    { name: "Web App Logins", href: "/web-store/logins" },
    { name: "Preferences", href: "/dashboard/webstore-settings/preferences" },
  ],
  COMMUNITY: [
    { name: "Admin Chat Room", href: "/dashboard/community/chat" },
    { name: "Community Management", href: "/dashboard/community" },
    { name: "Blogs & Articles", href: "/dashboard/blogs" },
  ],
  MARKETING: [
    { name: "SEO Dashboard", href: "/dashboard/marketing/seo" },
    { name: "Catalogue Feeds", href: "/dashboard/marketing/catalogue-feeds" },
    { name: "Omnichannel Analytics", href: "/dashboard/marketing/analytics" },
    { name: "Meta Pixel Tracker", href: "/dashboard/marketing/meta-pixel" },
    { name: "Customer Wishlist", href: "/dashboard/wishlist" },
    { name: "Push Notifications", href: "/dashboard/notifications" },
    { name: "Discounts & Promos", href: "/dashboard/marketing/discounts" },
    { name: "WhatsApp Marketing Hub", href: "/dashboard/marketing/whatsapp" },
    { name: "Email Marketing Center", href: "/dashboard/marketing/email" },
    { name: "SMS Campaigns", href: "/dashboard/marketing/sms" },
    { name: "WhatsApp Overview", href: "/dashboard/whatsapp-events/overview" },
    { name: "WhatsApp Events Feed", href: "/dashboard/whatsapp-events/events" },
    { name: "WhatsApp Campaign Analytics", href: "/dashboard/whatsapp-events/campaign-analytics" },
    { name: "WhatsApp Template Manager", href: "/dashboard/whatsapp-events/templates" },
    { name: "WhatsApp Customer Journeys", href: "/dashboard/whatsapp-events/customer-journeys" },
    { name: "WhatsApp Meta Review Status", href: "/dashboard/whatsapp-events/meta-review" },
  ],
  FINANCIAL: [
    { name: "Payments Dashboard", href: "/dashboard/payments" },
    { name: "Store Credits Manager", href: "/dashboard/payments/store-credits" },
    { name: "Refunds Portal", href: "/dashboard/refunds" },
  ],
  MANUFACTURING: [
    { name: "Manufacturing Hub", href: "/dashboard/manufacturing" },
    { name: "Design Assignments", href: "/dashboard/manufacturing/designs" },
    { name: "Sample Queue", href: "/dashboard/manufacturing/samples" },
    { name: "Pending Work Tasks", href: "/dashboard/manufacturing/tasks" },
    { name: "Production Tracker", href: "/dashboard/manufacturing/production" },
    { name: "Fabric Inventory", href: "/dashboard/manufacturing/fabric" },
    { name: "Fabric Movement Log", href: "/dashboard/manufacturing/movement" },
    { name: "Vendors Database", href: "/dashboard/manufacturing/vendors" },
    { name: "Mfg Cost Ledger", href: "/dashboard/manufacturing/costs" },
    { name: "Manufacturing KB", href: "/dashboard/manufacturing/knowledge-base" },
    { name: "Team Performance Stats", href: "/dashboard/manufacturing/employees" },
    { name: "Mfg Reports Hub", href: "/dashboard/manufacturing/reports" },
  ],
  INTEGRATIONS: [
    { name: "App Integrations Manager", href: "/dashboard/app-integration" },
    { name: "Live Shopping Carts", href: "/dashboard/live-carts" },
    { name: "App Logins Log", href: "/dashboard/app-logins" },
    { name: "Razorpay Gateway", href: "/dashboard/payments/razorpay" },
  ],
  AI_SERVICES: [
    { name: "Zica AI Engine Hub", href: "/dashboard/ai" },
    { name: "Admin AI Controller", href: "/dashboard/ai/admin" },
    { name: "Customer-Facing AI Settings", href: "/dashboard/ai/user" },
    { name: "Model Training Center", href: "/dashboard/ai/training" },
  ],
  SETTINGS: [
    { name: "General Settings", href: "/dashboard/settings" }
  ],
  ADMIN_USERS: [
    { name: "Admins Management", href: "/dashboard/admin-users" }
  ],
  AUDIT_LOG: [
    { name: "Activity Audit Logs", href: "/dashboard/audit-log" }
  ]
};

export default function AdminUsersPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    role: 'ADMIN',
    permissions: MODULES.map(m => ({
      module: m.id,
      canView: false,
      canEdit: false,
      canDelete: false,
      pages: [] as string[],
    }))
  });
  const [isSaving, setIsSaving] = useState(false);
  const [showTempPassword, setShowTempPassword] = useState<string | null>(null);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Permission Checks
  const currentUserRole = (session?.user as any)?.role;
  const currentUserPermissions = (session?.user as any)?.permissions || [];
  const isSuperAdmin = currentUserRole === 'SUPER_ADMIN';
  const adminUsersPermission = currentUserPermissions.find((p: any) => p.module === 'ADMIN_USERS');
  
  const canEdit = isSuperAdmin || !!adminUsersPermission?.canEdit;
  const canDelete = isSuperAdmin || !!adminUsersPermission?.canDelete;

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (res.ok) {
        setUsers(data);
      } else {
        toast.error(data.error || 'Failed to fetch users');
      }
    } catch (error) {
      toast.error('An error occurred while fetching users');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenModal = (user: any = null) => {
    if (user) {
      setEditingUser(user);
      setFormData({
        name: user.name || '',
        email: user.email,
        role: user.role,
        permissions: MODULES.map(m => {
          const existing = user.permissions.find((p: any) => p.module === m.id);
          return existing ? {
            module: m.id,
            canView: existing.canView,
            canEdit: existing.canEdit,
            canDelete: existing.canDelete,
            pages: existing.pages ? existing.pages.split(',') : [],
          } : {
            module: m.id,
            canView: false,
            canEdit: false,
            canDelete: false,
            pages: [] as string[],
          };
        })
      });
    } else {
      setEditingUser(null);
      setFormData({
        name: '',
        email: '',
        role: 'ADMIN',
        permissions: MODULES.map(m => ({
          module: m.id,
          canView: false,
          canEdit: false,
          canDelete: false,
          pages: [] as string[],
        }))
      });
    }
    setIsModalOpen(true);
  };

  const handleTogglePermission = (moduleIndex: number, field: string) => {
    const newPermissions = [...formData.permissions];
    const val = !(newPermissions[moduleIndex] as any)[field];
    newPermissions[moduleIndex] = {
      ...newPermissions[moduleIndex],
      [field]: val
    };
    
    // If canEdit or canDelete is true, canView must be true
    if ((field === 'canEdit' || field === 'canDelete') && val) {
      newPermissions[moduleIndex].canView = true;
    }

    // If canView is disabled, clear all selected pages
    if (field === 'canView' && !val) {
      newPermissions[moduleIndex].pages = [];
    }

    // If canView becomes true and pages was empty, select all subpages by default
    if (field === 'canView' && val && (!newPermissions[moduleIndex].pages || newPermissions[moduleIndex].pages.length === 0)) {
      const modId = newPermissions[moduleIndex].module;
      newPermissions[moduleIndex].pages = MODULE_PAGES[modId] ? MODULE_PAGES[modId].map(pg => pg.href) : [];
    }
    
    setFormData({ ...formData, permissions: newPermissions });
  };

  const handleTogglePage = (moduleIndex: number, pageHref: string) => {
    const newPermissions = [...formData.permissions];
    const currentPages = newPermissions[moduleIndex].pages || [];
    let nextPages: string[];
    if (currentPages.includes(pageHref)) {
      nextPages = currentPages.filter(p => p !== pageHref);
    } else {
      nextPages = [...currentPages, pageHref];
    }
    newPermissions[moduleIndex] = {
      ...newPermissions[moduleIndex],
      pages: nextPages
    };
    // Ensure canView is active if page is selected
    if (nextPages.length > 0) {
      newPermissions[moduleIndex].canView = true;
    }
    setFormData({ ...formData, permissions: newPermissions });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) {
      toast.error('You do not have permission to modify users');
      return;
    }
    setIsSaving(true);
    try {
      const url = editingUser ? `/api/admin/users/${editingUser.id}` : '/api/admin/users';
      const method = editingUser ? 'PATCH' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      
      const data = await res.json();
      
      if (res.ok) {
        toast.success(editingUser ? 'User updated successfully' : 'User created successfully');
        if (!editingUser && data.tempPassword) {
          setShowTempPassword(data.tempPassword);
        } else {
          setIsModalOpen(false);
        }
        fetchUsers();
      } else {
        toast.error(data.error || 'Operation failed');
      }
    } catch (error) {
      toast.error('An error occurred');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!canDelete) {
      toast.error('You do not have permission to delete users');
      return;
    }
    if (!confirm('Are you sure you want to delete this user?')) return;
    
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('User deleted');
        fetchUsers();
      } else {
        const data = await res.json();
        toast.error(data.error || 'Failed to delete');
      }
    } catch (error) {
      toast.error('An error occurred');
    }
  };

  const handleResetPassword = async (id: string) => {
    if (!canEdit) {
      toast.error('You do not have permission to reset passwords');
      return;
    }
    if (!confirm('Reset password for this user?')) return;
    
    try {
      const res = await fetch(`/api/admin/users/${id}/reset-password`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setShowTempPassword(data.tempPassword);
      } else {
        toast.error(data.error || 'Failed to reset');
      }
    } catch (error) {
      toast.error('An error occurred');
    }
  };

  const toggleUserStatus = async (user: any) => {
    if (!canEdit) {
      toast.error('You do not have permission to modify users');
      return;
    }
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !user.isActive })
      });
      if (res.ok) {
        toast.success(`User ${user.isActive ? 'deactivated' : 'activated'}`);
        fetchUsers();
      }
    } catch (error) {
      toast.error('An error occurred');
    }
  };

  // Reactive filtering of the users list
  const filteredUsers = users.filter((user) => {
    const nameMatch = (user.name || '').toLowerCase().includes(searchQuery.toLowerCase());
    const emailMatch = (user.email || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesSearch = nameMatch || emailMatch;

    const matchesRole = roleFilter === 'ALL' || user.role === roleFilter;

    const matchesStatus = statusFilter === 'ALL' ||
      (statusFilter === 'ACTIVE' && user.isActive) ||
      (statusFilter === 'DISABLED' && !user.isActive);

    return matchesSearch && matchesRole && matchesStatus;
  });

  return (
    <div className="space-y-8 pb-20">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/50 bg-clip-text text-transparent">
            Admin Management
          </h1>
          <p className="text-foreground/50 text-sm">
            Manage administrative access and granular module permissions.
          </p>
        </div>
        
        {canEdit && (
          <button 
            onClick={() => handleOpenModal()}
            className="flex items-center gap-2 px-5 py-2.5 bg-foreground text-background rounded-2xl font-medium hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg"
          >
            <UserPlus className="w-4 h-4" />
            Add New Admin
          </button>
        )}
      </div>

      {/* Filters Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="relative">
          <input 
            type="text"
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-foreground/5 border border-foreground/5 rounded-2xl px-5 py-3 pl-12 text-sm focus:bg-foreground/10 focus:border-foreground/20 transition-all outline-none"
          />
          <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-foreground/40" />
        </div>

        <div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="w-full bg-foreground/5 border border-foreground/5 rounded-2xl px-5 py-3 text-sm focus:bg-foreground/10 focus:border-foreground/20 transition-all outline-none appearance-none cursor-pointer text-foreground"
          >
            <option value="ALL">All Roles</option>
            <option value="SUPER_ADMIN">Super Admin</option>
            <option value="ADMIN">Standard Admin</option>
          </select>
        </div>

        <div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full bg-foreground/5 border border-foreground/5 rounded-2xl px-5 py-3 text-sm focus:bg-foreground/10 focus:border-foreground/20 transition-all outline-none appearance-none cursor-pointer text-foreground"
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">Active Only</option>
            <option value="DISABLED">Disabled Only</option>
          </select>
        </div>
      </div>

      {/* Users Table */}
      <div className="glass-card rounded-[2.5rem] border border-foreground/5 shadow-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-foreground/[0.03]">
                <th className="px-8 py-5 text-[12px] font-semibold text-foreground/40 uppercase tracking-wider">User</th>
                <th className="px-8 py-5 text-[12px] font-semibold text-foreground/40 uppercase tracking-wider">Role</th>
                <th className="px-8 py-5 text-[12px] font-semibold text-foreground/40 uppercase tracking-wider">Status</th>
                <th className="px-8 py-5 text-[12px] font-semibold text-foreground/40 uppercase tracking-wider">Created</th>
                <th className="px-8 py-5 text-[12px] font-semibold text-foreground/40 uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-8 py-20 text-center">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-foreground/20" />
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-8 py-20 text-center">
                    <div className="space-y-2">
                      <Users className="w-12 h-12 mx-auto text-foreground/10" />
                      <p className="text-foreground/40">No admin users found.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr 
                    key={user.id}
                    className="group border-b border-foreground/[0.03] hover:bg-foreground/[0.01] transition-colors"
                  >
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-foreground/5 flex items-center justify-center text-sm font-bold border border-foreground/5 group-hover:scale-110 transition-transform">
                          {user.name ? user.name.substring(0, 2).toUpperCase() : '??'}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="font-semibold text-[14px] truncate">{user.name || 'Unnamed User'}</span>
                          <span className="text-[12px] text-foreground/40 truncate">{user.email}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase ${
                        user.role === 'SUPER_ADMIN' 
                          ? 'bg-violet-500/10 text-violet-500 border border-violet-500/20' 
                          : 'bg-blue-500/10 text-blue-500 border border-blue-500/20'
                      }`}>
                        <Shield className="w-3 h-3" />
                        {user.role.replace('_', ' ')}
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <button 
                        onClick={() => canEdit && toggleUserStatus(user)}
                        disabled={!canEdit}
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase transition-all ${
                          !canEdit ? 'cursor-not-allowed opacity-80' : ''
                        } ${
                          user.isActive 
                            ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 hover:bg-emerald-500/20' 
                            : 'bg-red-500/10 text-red-500 border border-red-500/20 hover:bg-red-500/20'
                        }`}
                      >
                        {user.isActive ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        {user.isActive ? 'Active' : 'Disabled'}
                      </button>
                    </td>
                    <td className="px-8 py-5">
                      <div className="flex flex-col">
                        <span className="text-[13px] font-medium">{new Date(user.createdAt).toLocaleDateString()}</span>
                        <span className="text-[11px] text-foreground/40">by {user.creator?.name || 'System'}</span>
                      </div>
                    </td>
                    <td className="px-8 py-5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {canEdit && (
                          <button 
                            onClick={() => handleResetPassword(user.id)}
                            className="p-2 rounded-xl hover:bg-foreground/5 text-foreground/40 hover:text-foreground transition-all"
                            title="Reset Password"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                        )}
                        {canEdit && (
                          <button 
                            onClick={() => handleOpenModal(user)}
                            className="p-2 rounded-xl hover:bg-foreground/5 text-foreground/40 hover:text-foreground transition-all"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                        {canDelete && user.role !== 'SUPER_ADMIN' && (
                          <button 
                            onClick={() => handleDelete(user.id)}
                            className="p-2 rounded-xl hover:bg-red-500/10 text-foreground/40 hover:text-red-500 transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal / Slide-over */}
      <AnimatePresence>
        {isModalOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isSaving && setIsModalOpen(false)}
              className="fixed inset-0 bg-background/60 backdrop-blur-xl z-[100]"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 right-0 w-full max-w-2xl bg-background border-l border-foreground/10 z-[101] shadow-2xl overflow-hidden flex flex-col"
            >
              {showTempPassword ? (
                <div className="p-12 flex flex-col items-center justify-center h-full text-center space-y-8">
                  <div className="w-20 h-20 bg-amber-500/10 rounded-full flex items-center justify-center">
                    <Key className="w-10 h-10 text-amber-500" />
                  </div>
                  <div className="space-y-4">
                    <h2 className="text-2xl font-bold">Temporary Password Generated</h2>
                    <p className="text-foreground/60 text-sm max-w-sm">
                      Please copy this temporary password and provide it to the user. It will be shown only once and the user will be forced to change it on login.
                    </p>
                  </div>
                  <div className="w-full max-w-xs p-6 bg-foreground/5 rounded-3xl border border-foreground/10 font-mono text-xl font-bold tracking-widest relative group">
                    {showTempPassword}
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(showTempPassword);
                        toast.success('Copied to clipboard');
                      }}
                      className="absolute inset-0 bg-foreground/80 text-background opacity-0 group-hover:opacity-100 transition-opacity rounded-3xl flex items-center justify-center font-sans text-sm font-medium"
                    >
                      Click to Copy
                    </button>
                  </div>
                  <button 
                    onClick={() => {
                      setShowTempPassword(null);
                      setIsModalOpen(false);
                    }}
                    className="px-8 py-3 bg-foreground text-background rounded-2xl font-medium"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="flex flex-col h-full">
                  <div className="p-8 border-b border-foreground/5 flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-bold">{editingUser ? 'Edit Admin' : 'Add New Admin'}</h2>
                      <p className="text-foreground/40 text-sm">Configure access and permissions.</p>
                    </div>
                    <button 
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      className="p-2 rounded-xl hover:bg-foreground/5 text-foreground/40"
                    >
                      <X className="w-6 h-6" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar">
                    {/* Basic Info */}
                    <div className="space-y-6">
                      <div className="flex items-center gap-2 text-foreground/40 font-semibold text-[11px] uppercase tracking-wider">
                        <Users className="w-3 h-3" />
                        Basic Information
                      </div>
                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-foreground/60 ml-1">Full Name</label>
                          <input 
                            required
                            type="text" 
                            value={formData.name}
                            onChange={(e) => setFormData({...formData, name: e.target.value})}
                            placeholder="John Doe"
                            className="w-full bg-foreground/5 border border-foreground/5 rounded-2xl px-5 py-3 text-sm focus:bg-foreground/10 focus:border-foreground/20 transition-all outline-none"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-foreground/60 ml-1">Email Address</label>
                          <input 
                            required
                            type="email" 
                            value={formData.email}
                            onChange={(e) => setFormData({...formData, email: e.target.value})}
                            placeholder="john@example.com"
                            className="w-full bg-foreground/5 border border-foreground/5 rounded-2xl px-5 py-3 text-sm focus:bg-foreground/10 focus:border-foreground/20 transition-all outline-none"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-foreground/60 ml-1">Account Role</label>
                        <div className="grid grid-cols-2 gap-4">
                          <button 
                            type="button"
                            onClick={() => setFormData({...formData, role: 'ADMIN'})}
                            className={`flex items-center gap-3 p-4 rounded-2xl border transition-all ${
                              formData.role === 'ADMIN' 
                                ? 'bg-blue-500/10 border-blue-500/50 text-blue-500' 
                                : 'bg-foreground/5 border-foreground/5 text-foreground/40'
                            }`}
                          >
                            <Shield className="w-5 h-5" />
                            <div className="text-left">
                              <div className="text-sm font-bold">Standard Admin</div>
                              <div className="text-[10px] opacity-60">Requires module permissions</div>
                            </div>
                          </button>
                          <button 
                            type="button"
                            onClick={() => setFormData({...formData, role: 'SUPER_ADMIN'})}
                            className={`flex items-center gap-3 p-4 rounded-2xl border transition-all ${
                              formData.role === 'SUPER_ADMIN' 
                                ? 'bg-violet-500/10 border-violet-500/50 text-violet-500' 
                                : 'bg-foreground/5 border-foreground/5 text-foreground/40'
                            }`}
                          >
                            <ShieldCheck className="w-5 h-5" />
                            <div className="text-left">
                              <div className="text-sm font-bold">Super Admin</div>
                              <div className="text-[10px] opacity-60">Full access, bypasses all checks</div>
                            </div>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Permissions Matrix */}
                    <AnimatePresence>
                      {formData.role === 'ADMIN' && (
                        <motion.div 
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 20 }}
                          className="space-y-6"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-foreground/40 font-semibold text-[11px] uppercase tracking-wider">
                              <Lock className="w-3 h-3" />
                              Module Permissions
                            </div>
                            <button 
                              type="button"
                              onClick={() => {
                                setFormData({
                                  ...formData,
                                  permissions: formData.permissions.map(p => ({ 
                                    ...p, 
                                    canView: true, 
                                    canEdit: true, 
                                    canDelete: true,
                                    pages: MODULE_PAGES[p.module] ? MODULE_PAGES[p.module].map(pg => pg.href) : [],
                                  }))
                                });
                              }}
                              className="text-[10px] font-bold text-blue-500 hover:underline"
                            >
                              Select All
                            </button>
                          </div>

                          <div className="glass-card rounded-3xl border border-foreground/5 overflow-hidden">
                            <table className="w-full text-left">
                              <thead>
                                <tr className="bg-foreground/[0.02] border-b border-foreground/5">
                                  <th className="px-6 py-3 text-[10px] font-bold text-foreground/40 uppercase">Module</th>
                                  <th className="px-6 py-3 text-[10px] font-bold text-foreground/40 uppercase text-center">View</th>
                                  <th className="px-6 py-3 text-[10px] font-bold text-foreground/40 uppercase text-center">Edit</th>
                                  <th className="px-6 py-3 text-[10px] font-bold text-foreground/40 uppercase text-center">Delete</th>
                                </tr>
                              </thead>
                              <tbody>
                                {formData.permissions.map((p, idx) => (
                                  <React.Fragment key={p.module}>
                                    <tr className="border-b border-foreground/[0.03] hover:bg-foreground/[0.01] transition-colors">
                                      <td className="px-6 py-4">
                                        <div className="flex flex-col">
                                          <span className="text-[13px] font-semibold text-foreground">{MODULES.find(m => m.id === p.module)?.label}</span>
                                          <span className="text-[9px] text-foreground/30 uppercase tracking-widest font-bold">{p.module.replace('_', ' ')}</span>
                                        </div>
                                      </td>
                                      <td className="px-6 py-4 text-center">
                                        <div className="flex justify-center">
                                          <input 
                                            type="checkbox" 
                                            checked={p.canView}
                                            onChange={() => handleTogglePermission(idx, 'canView')}
                                            className="w-5 h-5 rounded-lg border-2 border-foreground/10 bg-background checked:bg-foreground checked:border-foreground transition-all cursor-pointer appearance-none relative checked:after:content-['✓'] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center checked:after:text-background checked:after:text-[10px] checked:after:font-black"
                                          />
                                        </div>
                                      </td>
                                      <td className="px-6 py-4 text-center">
                                        <div className="flex justify-center">
                                          <input 
                                            type="checkbox" 
                                            checked={p.canEdit}
                                            onChange={() => handleTogglePermission(idx, 'canEdit')}
                                            className="w-5 h-5 rounded-lg border-2 border-foreground/10 bg-background checked:bg-foreground checked:border-foreground transition-all cursor-pointer appearance-none relative checked:after:content-['✓'] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center checked:after:text-background checked:after:text-[10px] checked:after:font-black"
                                          />
                                        </div>
                                      </td>
                                      <td className="px-6 py-4 text-center">
                                        <div className="flex justify-center">
                                          <input 
                                            type="checkbox" 
                                            checked={p.canDelete}
                                            onChange={() => handleTogglePermission(idx, 'canDelete')}
                                            className="w-5 h-5 rounded-lg border-2 border-foreground/10 bg-background checked:bg-foreground checked:border-foreground transition-all cursor-pointer appearance-none relative checked:after:content-['✓'] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center checked:after:text-background checked:after:text-[10px] checked:after:font-black"
                                          />
                                        </div>
                                      </td>
                                    </tr>
                                    {p.canView && MODULE_PAGES[p.module] && MODULE_PAGES[p.module].length > 1 && (
                                      <tr className="bg-foreground/[0.01] border-b border-foreground/[0.03]">
                                        <td colSpan={4} className="px-8 py-4">
                                          <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                              <span className="text-[10px] font-bold text-foreground/45 uppercase tracking-wider">Allowed Pages in {MODULES.find(m => m.id === p.module)?.label}</span>
                                              <div className="flex gap-3">
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    const newPermissions = [...formData.permissions];
                                                    newPermissions[idx].pages = MODULE_PAGES[p.module].map(pg => pg.href);
                                                    setFormData({ ...formData, permissions: newPermissions });
                                                  }}
                                                  className="text-[9px] font-bold text-blue-500 hover:underline"
                                                >
                                                  Select All Pages
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    const newPermissions = [...formData.permissions];
                                                    newPermissions[idx].pages = [];
                                                    setFormData({ ...formData, permissions: newPermissions });
                                                  }}
                                                  className="text-[9px] font-bold text-foreground/40 hover:underline"
                                                >
                                                  Deselect All Pages
                                                </button>
                                              </div>
                                            </div>
                                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-2">
                                              {MODULE_PAGES[p.module].map((page) => {
                                                const isPageSelected = (p.pages || []).includes(page.href);
                                                return (
                                                  <label key={page.href} className="flex items-center gap-2.5 p-2.5 rounded-xl border border-foreground/[0.03] bg-background hover:bg-foreground/[0.02] cursor-pointer transition-all select-none">
                                                    <input
                                                      type="checkbox"
                                                      checked={isPageSelected}
                                                      onChange={() => handleTogglePage(idx, page.href)}
                                                      className="w-4 h-4 rounded border-2 border-foreground/10 bg-background checked:bg-foreground checked:border-foreground transition-all cursor-pointer appearance-none relative checked:after:content-['✓'] checked:after:absolute checked:after:inset-0 checked:after:flex checked:after:items-center checked:after:justify-center checked:after:text-background checked:after:text-[8px] checked:after:font-black"
                                                    />
                                                    <div className="flex flex-col">
                                                      <span className="text-[11px] font-medium text-foreground">{page.name}</span>
                                                      <span className="text-[8px] text-foreground/40 font-mono tracking-tight">{page.href}</span>
                                                    </div>
                                                  </label>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="p-8 border-t border-foreground/5 bg-foreground/[0.01] flex items-center justify-end gap-4">
                    <button 
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      disabled={isSaving}
                      className="px-6 py-3 rounded-2xl text-sm font-medium hover:bg-foreground/5 transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button 
                      type="submit"
                      disabled={isSaving}
                      className="px-10 py-3 bg-foreground text-background rounded-2xl text-sm font-bold shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                      {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                      {editingUser ? 'Save Changes' : 'Create Admin'}
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <style jsx global>{`
        .glass-card {
          background: rgba(255, 255, 255, 0.01);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }
        .dark .glass-card {
          background: rgba(0, 0, 0, 0.2);
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(var(--foreground), 0.1);
          border-radius: 10px;
        }
      `}</style>
    </div>
  );
}
