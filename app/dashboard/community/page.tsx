"use client";

import { useState, useEffect } from "react";
import { 
  Zap,
  Sparkles,
  Search,
  Check,
  X,
  Eye,
  MoreVertical,
  Flag,
  Globe,
  Upload,
  Calendar,
  MessageCircle,
  Plus,
  Users,
  Trash2,
  ShieldCheck,
  Smartphone,
  MessageSquare,
  CheckCircle2,
  User
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

// --- Components ---
   const SettingsGroup = ({ title, children }: { title: string, children: React.ReactNode }) => (
    <div className="mb-6 lg:mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
     <h3 className="px-6 mb-3 text-[11px] lg:text-[12px] font-semibold tracking-wide text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/40 font-inter uppercase">{title}</h3>
      <div className="glass-card rounded-[1.5rem] lg:rounded-[2rem] overflow-hidden border border-foreground/10">
        {children}
      </div>
    </div>
  );

   const SettingsRow = ({ icon: Icon, label, description, children, last }: any) => (
    <div className={`flex items-center justify-between px-6 lg:px-8 py-4 lg:py-5 ${!last ? 'border-b border-foreground/[0.05]' : ''} hover:bg-foreground/[0.02] transition-all group`}>
      <div className="flex items-center gap-4 lg:gap-5">
        <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-full bg-foreground/5 flex items-center justify-center group-hover:bg-foreground/10 transition-colors border border-foreground/5 shadow-inner">
          <Icon className="w-4 h-4 text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/40 group-hover:text-foreground/80 transition-colors" />
        </div>
        <div className="flex flex-col">
          <span className="text-[13px] lg:text-[14px] font-semibold text-foreground/90 font-inter">{label}</span>
          {description && <span className="text-[11px] text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/40 mt-1 font-inter">{description}</span>}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {children}
      </div>
    </div>
  );

 const InputField = ({ value, onChange, placeholder }: any) => (
  <input
    value={value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    className="bg-foreground/5 border border-foreground/10 rounded-xl px-4 py-2 text-[13px] font-medium text-foreground placeholder:text-foreground/40 dark:text-foreground/40 dark:text-foreground/40 dark:text-foreground/40 dark:text-foreground/20 focus:outline-none focus:border-foreground/30 transition-all text-right w-[160px] font-inter"
  />
);

 const ActionButton = ({ onClick, icon: Icon, label, variant = 'primary' }: any) => (
  <button
    onClick={onClick}
    className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[12px] font-medium transition-all active:scale-95 shadow-sm font-inter ${
      variant === 'primary' 
        ? 'bg-foreground text-background hover:opacity-90' 
        : variant === 'secondary'
        ? 'bg-blue-500 text-foreground hover:bg-blue-600'
        : 'bg-foreground/5 text-foreground/80 dark:text-foreground/80 dark:text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 hover:bg-foreground/10'
    }`}
  >
    {Icon && <Icon className="w-4 h-4" />}
    {label}
  </button>
);

 const StatusBadge = ({ type, label }: { type: 'success' | 'warning' | 'info', label: string }) => {
  const styles = {
    success: 'bg-emerald-500/5 text-emerald-500 border-emerald-500/10',
    warning: 'bg-amber-500/5 text-amber-500 border-amber-500/10',
    info: 'bg-blue-500/5 text-blue-500 border-blue-500/10'
  };
  return (
    <div className={`px-2.5 py-1 rounded-full text-[10px] font-medium flex items-center gap-1.5 font-inter ${styles[type]}`}>
       <div className={`w-1.5 h-1.5 rounded-full ${type === 'success' ? 'bg-emerald-500' : type === 'warning' ? 'bg-amber-500' : 'bg-blue-500'}`} />
       {label}
    </div>
  );
};

export default function CommunityAdminPage() {
  const [updates, setUpdates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newUpdate, setNewUpdate] = useState({ title: '', description: '', type: 'EVENT' });
  
  // Featured Looks State
  const [featuredUsers, setFeaturedUsers] = useState<any[]>([]);
  const [newFeatured, setNewFeatured] = useState({ name: '', email: '', imageUrl: '', instagramUrl: '', styleDescription: '' });
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [showManualForm, setShowManualForm] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setNewFeatured((prev) => ({ ...prev, imageUrl: data.url }));
      } else {
        alert("Upload failed: " + data.error);
      }
    } catch (err) {
      console.error(err);
      alert("Error uploading file");
    } finally {
      setIsUploading(false);
    }
  };

  // Global Shop Settings
  const [settings, setSettings] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);

  const fetchUpdates = async () => {
    try {
      const res = await fetch('/api/community/updates');
      const data = await res.json();
      setUpdates(data.updates || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUpdates();
    fetchFeaturedUsers();
    fetchShopSettings();
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    try {
      const res = await fetch('/api/admin/community/members');
      const data = await res.json();
      setMembers(data.members || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchShopSettings = async () => {
    try {
      const res = await fetch('/api/admin/settings');
      const data = await res.json();
      setSettings(data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveSettings = async (updates: any) => {
    setSavingSettings(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      if (res.ok) fetchShopSettings();
    } catch (e) {
      console.error(e);
    } finally {
      setSavingSettings(false);
    }
  };

  const fetchFeaturedUsers = async () => {
    try {
      const res = await fetch('/api/admin/featured-users', {
        cache: 'no-store',
        headers: {
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache'
        }
      });
      const data = await res.json();
      setFeaturedUsers(data.users || []);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveFeatured = async () => {
    if (!newFeatured.name || !newFeatured.imageUrl) return;
    setProcessing('save-featured');
    try {
      if (editingUser) {
        // Update existing
        const res = await fetch(`/api/admin/featured-users/${editingUser.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newFeatured)
        });
        if (res.ok) {
          setEditingUser(null);
          setNewFeatured({ name: '', email: '', imageUrl: '', instagramUrl: '', styleDescription: '' });
          setShowManualForm(false);
          fetchFeaturedUsers();
        }
      } else {
        // Create new
        const res = await fetch('/api/admin/featured-users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...newFeatured, status: 'APPROVED' })
        });
        if (res.ok) {
          setNewFeatured({ name: '', email: '', imageUrl: '', instagramUrl: '', styleDescription: '' });
          setShowManualForm(false);
          fetchFeaturedUsers();
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setProcessing(null);
    }
  };

  const handleEditClick = (user: any) => {
    setEditingUser(user);
    setNewFeatured({
      name: user.name,
      email: user.email,
      imageUrl: user.imageUrl,
      instagramUrl: user.instagramUrl || '',
      styleDescription: user.styleDescription || ''
    });
    setShowManualForm(true);
  };

  const handleUpdateStatus = async (id: string, status: string) => {
    setProcessing(id);
    try {
      const res = await fetch(`/api/admin/featured-users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (res.ok) fetchFeaturedUsers();
    } catch (e) {
      console.error(e);
    } finally {
      setProcessing(null);
    }
  };

  const handleUpdateMember = async (id: string, status: string) => {
    setProcessing('member-' + id);
    try {
      const res = await fetch('/api/admin/community/members', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status })
      });
      if (res.ok) fetchMembers();
    } catch (e) {
      console.error(e);
    } finally {
      setProcessing(null);
    }
  };

  const handleToggleFeatured = async (id: string, current: boolean) => {
    setProcessing(id);
    try {
      const res = await fetch(`/api/admin/featured-users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isTopFeatured: !current })
      });
      if (res.ok) fetchFeaturedUsers();
    } catch (e) {
      console.error(e);
    } finally {
      setProcessing(null);
    }
  };

  const handleDeleteFeatured = async (id: string) => {
    try {
       await fetch(`/api/admin/featured-users?id=${id}`, { method: 'DELETE' });
       fetchFeaturedUsers();
    } catch (e) {
       console.error(e);
    }
  };

  const handleAddUpdate = async () => {
    if (!newUpdate.title) return;
    try {
      const res = await fetch('/api/community/updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUpdate)
      });
      if (res.ok) {
        setNewUpdate({ title: '', description: '', type: 'EVENT' });
        fetchUpdates();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteUpdate = async (id: string) => {
    try {
       await fetch(`/api/community/updates?id=${id}`, { method: 'DELETE' });
       fetchUpdates();
    } catch (e) {
       console.error(e);
    }
  };

   return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 pb-32 px-6 pt-4 lg:pt-8">
      
      {/* Moderation Hub Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8 lg:mb-12">
         <div className="space-y-1.5 lg:space-y-2">
           <div className="flex items-center gap-3">
              <div className="px-3 py-1 bg-foreground/5 rounded-full text-[10px] font-medium text-foreground/80 dark:text-foreground/80 dark:text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 border border-foreground/10 font-inter uppercase tracking-widest">Moderation Hub</div>
              <div className="flex items-center gap-2 opacity-50">
                 <Globe className="w-3 h-3 text-foreground/80 dark:text-foreground/80 dark:text-foreground/80 dark:text-foreground/80 dark:text-foreground/60" />
                 <span className="text-[10px] font-medium text-foreground/80 dark:text-foreground/80 dark:text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 font-inter uppercase tracking-widest">Active System</span>
              </div>
           </div>
           <div>
              <h1 className="text-2xl lg:text-3xl font-semibold text-foreground tracking-tight mb-1 font-inter uppercase">Community Control</h1>
              <div className="flex items-center gap-4 mt-1">
                 <p className="text-[11px] lg:text-[12px] text-foreground/70 dark:text-foreground/70 dark:text-foreground/70 dark:text-foreground/70 dark:text-foreground/50 font-medium font-inter">Approve and curate the public community board.</p>
                 <div className="px-2 py-0.5 bg-blue-500/10 text-blue-500 rounded-full text-[9px] font-bold border border-blue-500/20 font-inter uppercase tracking-widest">
                    {featuredUsers.filter((u: any) => u.status === 'APPROVED').length}/20 Displayed
                 </div>
              </div>
           </div>
        </div>

           <div className="flex items-center gap-3">
            <ActionButton label="Add Featured User" icon={Plus} variant="primary" onClick={() => { setEditingUser(null); setNewFeatured({ name: '', email: '', imageUrl: '', instagramUrl: '', styleDescription: '' }); setShowManualForm(true); }} />
            <ActionButton label="View Community" icon={Globe} variant="secondary" onClick={() => window.open('/community', '_blank')} />
            <div className="h-10 px-5 bg-foreground/5 border border-foreground/10 rounded-full flex items-center gap-3 backdrop-blur-md shadow-sm">
              <Users className="w-4 h-4 text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/40" />
              <span className="text-[12px] font-medium text-foreground/80 dark:text-foreground/80 dark:text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 font-inter">{featuredUsers.length} Users</span>
            </div>
          </div>
      </div>

      {/* Membership Moderation */}
      <div className="mb-16 animate-in fade-in slide-in-from-bottom-4 duration-700">
         <div className="flex items-center gap-3 mb-6 px-1">
            <div className="px-2 py-0.5 bg-blue-500/10 text-blue-500 rounded-md text-[8px] font-black uppercase tracking-widest border border-blue-500/20">
               {members.filter(m => m.status === 'PENDING').length} Pending Requests
            </div>
            <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/50 dark:text-foreground/30 dark:text-foreground/20">Membership Guard</h2>
         </div>

         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <AnimatePresence mode="popLayout">
               {members.filter(m => m.status === 'PENDING').map((member) => (
                    <motion.div
                    key={member.id}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="glass-card p-8 flex flex-col gap-6 group relative rounded-[2.5rem]"
                  >
                     <div className="flex items-center gap-4">
                        <div className="w-11 h-11 rounded-full bg-foreground/[0.03] dark:bg-foreground/[0.03] flex items-center justify-center overflow-hidden border border-foreground/[0.08] shadow-inner">
                           {member.customer.image ? (
                             <img src={member.customer.image} className="w-full h-full object-cover" alt={member.customer.name} />
                           ) : (
                             <User className="w-5 h-5 text-foreground/40 dark:text-foreground/40 dark:text-foreground/40 dark:text-foreground/40 dark:text-foreground/20" />
                           )}
                        </div>
                        <div className="flex flex-col min-w-0">
                           <span className="text-[14px] font-bold text-foreground uppercase tracking-tight truncate leading-none">{member.customer.name || 'Anonymous'}</span>
                           <span className="text-[9px] font-bold text-foreground/50 dark:text-foreground/30 dark:text-foreground/10 uppercase tracking-[0.2em] leading-none mt-2 truncate">{member.customer.email}</span>
                        </div>
                     </div>

                     <div className="grid grid-cols-2 gap-2.5">
                        <div className="bg-foreground/[0.02] dark:bg-foreground/[0.01] rounded-[1.2rem] border border-foreground/[0.04] p-3 shadow-inner">
                           <p className="text-[7.5px] font-bold text-foreground/50 dark:text-foreground/30 dark:text-foreground/10 uppercase tracking-[0.15em] mb-1.5">Transmission</p>
                           <p className="text-[13px] font-bold text-foreground leading-none">{member.customer.ordersCount || member.customer.orders?.length || 0}</p>
                        </div>
                        <div className="bg-foreground/[0.02] dark:bg-foreground/[0.01] rounded-[1.2rem] border border-foreground/[0.04] p-3 shadow-inner">
                           <p className="text-[7.5px] font-bold text-foreground/50 dark:text-foreground/30 dark:text-foreground/10 uppercase tracking-[0.15em] mb-1.5">Contact</p>
                           <p className="text-[10px] font-medium text-foreground/80 dark:text-foreground/80 dark:text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 leading-none truncate">{member.phone || 'N/A'}</p>
                        </div>
                     </div>

                     <div className="flex items-center gap-2 pt-1">
                        <button 
                          onClick={() => handleUpdateMember(member.id, 'APPROVED')}
                          disabled={processing === 'member-' + member.id}
                          className="flex-1 py-3 bg-foreground dark:bg-foreground text-background dark:text-background rounded-xl text-[9px] font-bold uppercase tracking-[0.3em] active:scale-95 transition-all disabled:opacity-20 shadow-xl shadow-foreground/10"
                        >
                           Access Grant
                        </button>
                        <button 
                          onClick={() => handleUpdateMember(member.id, 'REJECTED')}
                          disabled={processing === 'member-' + member.id}
                          className="h-11 px-4 bg-foreground/[0.04] text-foreground/50 dark:text-foreground/50 dark:text-foreground/50 dark:text-foreground/50 dark:text-foreground/30 rounded-xl hover:bg-rose-500/10 hover:text-rose-500 transition-all disabled:opacity-20 border border-foreground/[0.05]"
                        >
                           <X className="w-4 h-4" />
                        </button>
                     </div>
                  </motion.div>
               ))}
               {members.filter(m => m.status === 'PENDING').length === 0 && (
                  <div className="col-span-full py-16 border border-dashed border-foreground/5 dark:border-foreground/5 rounded-[2rem] flex flex-col items-center justify-center text-foreground/30 dark:text-foreground/10 dark:text-foreground/5">
                     <ShieldCheck className="w-10 h-10 mb-3 opacity-20" />
                     <p className="text-[10px] font-black uppercase tracking-[0.3em] text-center">Secure Layer Active<br/><span className="opacity-50 font-medium">No pending transmission detected</span></p>
                  </div>
               )}
            </AnimatePresence>
         </div>
      </div>

      {/* Photo Submissions waiting for review (customers' "Publish your look" uploads from the app and website) */}
      <div className="mb-16 animate-in fade-in slide-in-from-bottom-4 duration-700">
         <div className="flex items-center gap-3 mb-6 px-1">
            <div className="px-2 py-0.5 bg-amber-500/10 text-amber-500 rounded-md text-[8px] font-black uppercase tracking-widest border border-amber-500/20">
               {featuredUsers.filter((u: any) => u.status === 'PENDING').length} Pending Photos
            </div>
            <h2 className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground/50 dark:text-foreground/30">Look Submissions</h2>
         </div>

         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <AnimatePresence mode="popLayout">
               {featuredUsers.filter((u: any) => u.status === 'PENDING').map((user: any) => (
                  <motion.div
                     key={`pending-${user.id}`}
                     layout
                     initial={{ opacity: 0, y: 20 }}
                     animate={{ opacity: 1, y: 0 }}
                     exit={{ opacity: 0, scale: 0.95 }}
                     className="bg-foreground/[0.02] border border-foreground/[0.06] rounded-[1.5rem] overflow-hidden shadow-lg shadow-black/5"
                  >
                     <a href={user.imageUrl} target="_blank" rel="noopener noreferrer" className="block aspect-[4/5] overflow-hidden bg-foreground/5">
                        <img src={user.imageUrl} alt={user.name} className="w-full h-full object-cover" />
                     </a>
                     <div className="p-4 space-y-3">
                        <div>
                           <h4 className="text-[13px] font-semibold text-foreground leading-none">{user.name}</h4>
                           <p className="text-[11px] text-foreground/60 mt-1 break-all">{user.email}</p>
                           <p className="text-[10px] text-foreground/40 mt-1">{new Date(user.createdAt).toLocaleString()}</p>
                        </div>
                        {user.styleDescription && (
                           <p className="text-[11px] text-foreground/70 leading-snug">&ldquo;{user.styleDescription}&rdquo;</p>
                        )}
                        {user.instagramUrl && (
                           <a href={user.instagramUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest break-all">{user.instagramUrl}</a>
                        )}
                        <div className="flex items-center gap-2 pt-1">
                           <button
                              onClick={() => handleUpdateStatus(user.id, 'APPROVED')}
                              disabled={processing === user.id}
                              className="flex-1 h-10 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center gap-2 text-[12px] font-medium hover:bg-emerald-500/20 transition-all disabled:opacity-40 active:scale-95 border border-emerald-500/20"
                           >
                              <Check className="w-4 h-4" /> Approve
                           </button>
                           <button
                              onClick={() => handleUpdateStatus(user.id, 'REJECTED')}
                              disabled={processing === user.id}
                              className="flex-1 h-10 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center gap-2 text-[12px] font-medium hover:bg-rose-500/20 transition-all disabled:opacity-40 active:scale-95 border border-rose-500/20"
                           >
                              <X className="w-4 h-4" /> Reject
                           </button>
                        </div>
                     </div>
                  </motion.div>
               ))}
               {featuredUsers.filter((u: any) => u.status === 'PENDING').length === 0 && (
                  <div className="col-span-full py-12 border border-dashed border-foreground/5 rounded-[2rem] flex flex-col items-center justify-center text-foreground/30">
                     <ShieldCheck className="w-8 h-8 mb-3 opacity-20" />
                     <p className="text-[10px] font-black uppercase tracking-[0.3em] text-center">No photos waiting<br/><span className="opacity-50 font-medium">New submissions from customers appear here</span></p>
                  </div>
               )}
            </AnimatePresence>
         </div>
      </div>

      <div className="w-full h-[1px] bg-foreground/5 dark:bg-foreground/5 mb-16" />

      {/* Main Submission Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-20">
         <AnimatePresence>
            {featuredUsers.filter((u: any) => u.status !== 'PENDING').map((user) => (
              <motion.div
                 key={user.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="group relative bg-foreground/40 dark:bg-foreground/[0.01] border border-foreground/[0.06] rounded-[2rem] overflow-hidden shadow-lg shadow-black/5 hover:bg-foreground/[0.02] transition-all backdrop-blur-xl"
              >
                {/* Visual Canvas */}
                <div className="aspect-[4/5] relative overflow-hidden">
                   <img 
                    src={user.imageUrl} 
                    className="w-full h-full object-cover grayscale opacity-80 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-1000 scale-105 group-hover:scale-100" 
                    alt={user.name} 
                  />
                   <div className="absolute inset-x-0 top-0 p-6 flex justify-between items-start">
                      <div className="flex flex-col gap-2">
                          {user.status === 'APPROVED' && <StatusBadge type="success" label="Approved" />}
                          {user.status === 'PENDING' && <StatusBadge type="warning" label="Pending Approval" />}
                          {user.status === 'REJECTED' && <StatusBadge type="info" label="Rejected" />}
                          {user.isTopFeatured && <div className="px-2.5 py-1 bg-emerald-500 text-foreground rounded-full text-[8px] font-bold uppercase tracking-widest backdrop-blur-md shadow-lg shadow-emerald-500/20">TOP 20</div>}
                      </div>
                      <button 
                        onClick={() => handleEditClick(user)}
                        className="w-9 h-9 rounded-full bg-background/40 backdrop-blur-md border border-foreground/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all active:scale-90"
                      >
                         <MoreVertical className="w-4 h-4 text-foreground" />
                      </button>
                   </div>
                   
                    {/* Bottom Detail Scrim */}
                    <div className="absolute inset-x-0 bottom-0 p-5 bg-gradient-to-t from-black/90 via-black/40 to-transparent pt-16">
                      <div className="flex justify-between items-end">
                          <div className="space-y-0.5">
                             <h4 className="text-[14px] lg:text-[15px] font-semibold text-foreground tracking-tight leading-none font-inter">{user.name}</h4>
                             <p className="text-[11px] text-foreground/70 font-medium leading-none mt-1 font-inter">{user.email}</p>
                          </div>
                          <div className="text-[10px] font-medium text-foreground/40 font-inter">
                            {new Date(user.createdAt).toLocaleDateString()}
                         </div>
                      </div>
                   </div>
                </div>

                {/* Interaction Node */}
                 <div className="p-5 space-y-4">
                   {user.instagramUrl && (
                     <div className="px-3 py-1.5 bg-foreground/[0.03] rounded-full border border-foreground/[0.05] flex items-center gap-2 w-fit hover:bg-foreground/[0.08] transition-colors cursor-pointer group/link">
                       <Globe className="w-3 h-3 text-emerald-500 group-hover/link:animate-pulse" />
                       <a href={user.instagramUrl} target="_blank" rel="noopener noreferrer" className="text-[8px] font-bold text-foreground/70 dark:text-foreground/70 dark:text-foreground/70 dark:text-foreground/70 dark:text-foreground/50 uppercase tracking-widest">
                         {new URL(user.instagramUrl).pathname.split('/').filter(Boolean).pop() || 'INSTAGRAM'}
                       </a>
                     </div>
                   )}
                   <div className="p-4 bg-foreground/[0.02] rounded-2xl border border-foreground/[0.04] shadow-inner">
                      <p className="text-[9px] font-medium text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/40 dark:text-foreground/20 italic leading-snug lowercase">
                         "{user.styleDescription || 'Unspecified Transmission.'}"
                      </p>
                   </div>

                     <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                         <button 
                           onClick={() => handleUpdateStatus(user.id, 'APPROVED')}
                           disabled={user.status === 'APPROVED' || processing === user.id}
                           className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center hover:bg-emerald-500/20 transition-all disabled:opacity-20 active:scale-90 border border-emerald-500/20"
                         >
                            <Check className="w-4 h-4" />
                         </button>
                         <button 
                           onClick={() => handleUpdateStatus(user.id, 'REJECTED')}
                           disabled={user.status === 'REJECTED' || processing === user.id}
                           className="w-10 h-10 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center hover:bg-rose-500/20 transition-all disabled:opacity-20 active:scale-90 border border-rose-500/20"
                         >
                            <X className="w-4 h-4" />
                         </button>
                         <div 
                           onClick={() => handleToggleFeatured(user.id, user.isTopFeatured)}
                           className={`flex items-center gap-2 px-4 py-2.5 rounded-full border transition-all cursor-pointer active:scale-95 ${user.isTopFeatured ? 'bg-blue-500 text-foreground border-transparent shadow-lg shadow-blue-500/20' : 'bg-foreground/5 border-foreground/10 text-foreground/70 dark:text-foreground/70 dark:text-foreground/70 dark:text-foreground/70 dark:text-foreground/50 hover:text-foreground/80'}`}
                         >
                            <Sparkles className={`w-3.5 h-3.5 ${user.isTopFeatured ? 'animate-pulse' : ''}`} />
                            <span className="text-[12px] font-medium font-inter">Featured</span>
                         </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                         <button 
                           onClick={() => handleEditClick(user)}
                           className="px-4 py-2.5 rounded-full bg-foreground/10 hover:bg-foreground/20 text-foreground font-medium text-[12px] transition-all border border-foreground/10 active:scale-95 font-inter"
                         >
                            Edit
                         </button>
                         <button onClick={() => handleDeleteFeatured(user.id)} className="w-10 h-10 rounded-full bg-foreground/5 hover:bg-rose-500 text-foreground/50 dark:text-foreground/50 dark:text-foreground/50 dark:text-foreground/50 dark:text-foreground/30 hover:text-foreground flex items-center justify-center transition-all border border-foreground/10 active:scale-90">
                            <Trash2 className="w-4 h-4" />
                         </button>
                      </div>
                   </div>
                </div>
              </motion.div>
            ))}
         </AnimatePresence>
      </div>

      <div className="w-full h-[1px] bg-foreground/5 mb-16" />

      {/* Membership Rules */}
      <SettingsGroup title="Membership Guard">
        <SettingsRow 
          icon={ShieldCheck} 
          label="Order Requirement" 
          description="Minimum orders required to access community perks."
        >
          <InputField 
            value={settings?.communityMinOrders?.toString() || "1"} 
            onChange={(v: string) => handleSaveSettings({ communityMinOrders: parseInt(v) || 0 })} 
            placeholder="Quantity" 
          />
        </SettingsRow>
        <SettingsRow 
          icon={Users} 
          label="Age Restriction" 
          description="Enforce 18+ verification for legal compliance."
        >
          <div className="flex items-center gap-1.5 p-1 bg-foreground/[0.02] rounded-lg border border-foreground/[0.03]">
             <button 
               onClick={() => handleSaveSettings({ communityAgeRestricted: true })}
               className={`px-4 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${settings?.communityAgeRestricted ? 'bg-foreground text-background shadow-sm' : 'text-muted-foreground/20 hover:text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/40'}`}
             >
               Active
             </button>
             <button 
               onClick={() => handleSaveSettings({ communityAgeRestricted: false })}
               className={`px-4 py-1.5 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${!settings?.communityAgeRestricted ? 'bg-foreground text-background shadow-sm' : 'text-muted-foreground/20 hover:text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/40'}`}
             >
               Disabled
             </button>
          </div>
        </SettingsRow>
        <SettingsRow 
          icon={Smartphone} 
          label="WhatsApp Promotion" 
          description="Allow members to opt-in for broadcast updates."
          last
        >
          <div 
            onClick={() => handleSaveSettings({ communityWhatsAppEnabled: !settings?.communityWhatsAppEnabled })}
            className={`w-10 h-5 rounded-full p-1 flex items-center transition-all cursor-pointer ${settings?.communityWhatsAppEnabled ? 'bg-emerald-500/20 justify-end' : 'bg-foreground/10 justify-start'}`}
          >
             <div className={`w-3 h-3 rounded-full shadow-sm transition-all ${settings?.communityWhatsAppEnabled ? 'bg-emerald-500' : 'bg-foreground/20'}`} />
          </div>
        </SettingsRow>
      </SettingsGroup>

      {/* Community Updates / Events */}
       <SettingsGroup title="Announcements & Events">
        <div className="p-6 border-b border-foreground/[0.04] bg-foreground/[0.01]">
           <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1 space-y-3">
                 <input 
                   placeholder="Event Title..." 
                   value={newUpdate.title}
                   onChange={(e) => setNewUpdate({...newUpdate, title: e.target.value})}
                   className="w-full bg-foreground dark:bg-background/20 border border-foreground/[0.06] rounded-xl px-4 py-3 text-[11px] font-bold text-foreground placeholder:text-foreground/15 transition-all focus:border-foreground/20"
                 />
                 <textarea 
                   placeholder="Event Description..." 
                   value={newUpdate.description}
                   onChange={(e) => setNewUpdate({...newUpdate, description: e.target.value})}
                   className="w-full bg-foreground dark:bg-background/20 border border-foreground/[0.06] rounded-xl px-4 py-3 text-[10px] font-medium text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/40 min-h-[80px] placeholder:text-foreground/15 resize-none transition-all focus:border-foreground/20"
                 />
              </div>
              <div className="md:w-48 flex flex-col gap-3">
                 <div className="relative">
                    <select 
                      value={newUpdate.type}
                      onChange={(e) => setNewUpdate({...newUpdate, type: e.target.value})}
                      className="w-full bg-foreground dark:bg-background/20 border border-foreground/[0.06] rounded-xl px-4 py-3 text-[9px] font-bold uppercase tracking-[0.2em] appearance-none text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/40 focus:outline-none focus:border-foreground/20 cursor-pointer"
                    >
                       <option value="EVENT">Event</option>
                       <option value="ACTIVITY">Activity</option>
                       <option value="OFFER">Offer</option>
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                       <MoreVertical className="w-3 h-3 text-foreground/40 dark:text-foreground/40 dark:text-foreground/40 dark:text-foreground/40 dark:text-foreground/20 rotate-90" />
                    </div>
                 </div>
                 <button 
                   onClick={handleAddUpdate}
                   className="w-full py-3.5 bg-foreground text-background dark:bg-foreground dark:text-background rounded-xl text-[9px] font-bold uppercase tracking-[0.3em] active:scale-95 transition-all shadow-xl shadow-foreground/10"
                 >
                   Deploy Node
                 </button>
              </div>
           </div>
        </div>

        <AnimatePresence>
          {loading ? (
            <div className="p-16 text-center text-muted-foreground/10 animate-pulse uppercase text-[10px] font-bold tracking-[0.4em]">Syncing with Core...</div>
          ) : updates.map((update, idx) => (
              <motion.div 
                key={update.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={`px-6 py-5 flex items-center justify-between group hover:bg-foreground/[0.01] transition-all ${idx !== updates.length - 1 ? 'border-b border-foreground/[0.03]' : ''}`}
             >
                <div className="flex items-center gap-5">
                   <div className={`w-10 h-10 rounded-2xl flex items-center justify-center border border-foreground/[0.05] shadow-sm ${
                     update.type === 'EVENT' ? 'bg-blue-500/10 text-blue-500' :
                     update.type === 'OFFER' ? 'bg-emerald-500/10 text-emerald-500' :
                     'bg-foreground/[0.03] text-foreground/50 dark:text-foreground/50 dark:text-foreground/50 dark:text-foreground/50 dark:text-foreground/30'
                   }`}>
                     {update.type === 'EVENT' ? <Calendar className="w-4 h-4" /> :
                      update.type === 'OFFER' ? <Zap className="w-4 h-4" /> :
                      <Users className="w-4 h-4" />}
                   </div>
                   <div className="flex flex-col">
                      <span className="text-[13px] font-bold text-foreground uppercase tracking-tight leading-none">{update.title}</span>
                      <span className="text-[8.5px] font-medium text-foreground/50 dark:text-foreground/30 dark:text-foreground/10 leading-none mt-2 uppercase tracking-[0.1em] truncate max-w-[400px]">{update.description}</span>
                   </div>
                </div>
               <button 
                 onClick={() => handleDeleteUpdate(update.id)}
                 className="w-9 h-9 rounded-xl hover:bg-rose-500/10 text-foreground/30 dark:text-foreground/30 dark:text-foreground/30 dark:text-foreground/30 dark:text-foreground/10 hover:text-rose-500 transition-all opacity-0 group-hover:opacity-100 flex items-center justify-center border border-transparent hover:border-rose-500/20"
               >
                 <Trash2 className="w-4 h-4" />
               </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </SettingsGroup>

      {/* Discussion Substrate */}
      <SettingsGroup title="Discussion Substrate">
        <SettingsRow 
           icon={MessageSquare} 
           label="Fashion Chat" 
           description="Enable real-time trend discussions for verified members."
           last
         >
           <div className="flex items-center gap-4">
              <div className="flex flex-col items-end opacity-20">
                 <span className="text-[8px] font-black uppercase tracking-[0.2em] text-emerald-500">Live Feedback</span>
                 <span className="text-[11px] font-black tracking-tight text-foreground lowercase">active hub</span>
              </div>
              <div className="w-10 h-5 rounded-full bg-emerald-500/20 p-1 flex items-center justify-end">
                 <div className="w-3 h-3 rounded-full bg-emerald-500" />
              </div>
           </div>
         </SettingsRow>
      </SettingsGroup>

      {/* Centered Premium Modal for Manual Submission */}
      <AnimatePresence>
        {showManualForm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-10">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowManualForm(false)}
              className="absolute inset-0 bg-background/80 backdrop-blur-2xl"
            />
             <motion.div 
               initial={{ scale: 0.95, opacity: 0, y: 10 }}
               animate={{ scale: 1, opacity: 1, y: 0 }}
               exit={{ scale: 0.95, opacity: 0, y: 10 }}
               transition={{ type: "spring", damping: 30, stiffness: 350 }}
                className="relative w-full max-w-[600px] glass rounded-[2rem] p-10 flex flex-col shadow-2xl border border-foreground/10 !bg-background/90"
             >
                <div className="flex justify-between items-start mb-10 border-b border-foreground/10 pb-6">
                   <div>
                       <h2 className="text-[28px] font-semibold text-foreground tracking-tight font-inter">{editingUser ? 'Edit Featured User' : 'Add Featured User'}</h2>
                       <p className="text-[14px] text-foreground/70 dark:text-foreground/70 dark:text-foreground/70 dark:text-foreground/70 dark:text-foreground/50 mt-1 font-inter">{editingUser ? 'Modify user details and appearance' : 'Create a new entry for the community board'}</p>
                   </div>
                   <button onClick={() => { setShowManualForm(false); setEditingUser(null); }} className="w-10 h-10 flex items-center justify-center hover:bg-foreground/10 rounded-full transition-all active:scale-90 border border-transparent hover:border-foreground/10">
                     <X className="w-5 h-5 text-foreground/80 dark:text-foreground/80 dark:text-foreground/80 dark:text-foreground/80 dark:text-foreground/60" />
                   </button>
                </div>

                 <div className="space-y-8 overflow-y-auto pr-2 flex-1 custom-scrollbar max-h-[60vh] font-inter">
                   <div className="space-y-4">
                      <p className="text-[13px] font-semibold text-foreground/80 px-1">User Details</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <input 
                           placeholder="Full Name" 
                           value={newFeatured.name}
                           onChange={(e) => setNewFeatured({...newFeatured, name: e.target.value})}
                           className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-xl px-5 py-3.5 text-[14px] text-foreground placeholder:text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/40 focus:border-blue-500 transition-all outline-none"
                        />
                        <input 
                           placeholder="Email Address" 
                           value={newFeatured.email}
                           onChange={(e) => setNewFeatured({...newFeatured, email: e.target.value})}
                           className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-xl px-5 py-3.5 text-[14px] text-foreground placeholder:text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/40 focus:border-blue-500 transition-all outline-none"
                        />
                      </div>
                   </div>

                   <div className="space-y-4">
                      <p className="text-[13px] font-semibold text-foreground/80 px-1">Media Selection</p>
                      <div className="space-y-4">
                        {/* Image Preview / Upload */}
                        <div className="relative group/upload h-48 rounded-[1.5rem] bg-foreground/[0.03] border border-dashed border-foreground/10 overflow-hidden flex flex-col items-center justify-center transition-all hover:bg-foreground/[0.05] hover:border-foreground/20">
                          {newFeatured.imageUrl ? (
                            <>
                              <img 
                                src={newFeatured.imageUrl} 
                                className="w-full h-full object-cover opacity-80" 
                                alt="Preview" 
                              />
                              <div className="absolute inset-0 bg-background/40 opacity-0 group-hover/upload:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                                <label className="cursor-pointer px-4 py-2 bg-foreground text-background rounded-full text-[12px] font-bold uppercase tracking-widest shadow-xl active:scale-95 transition-all">
                                  Change Image
                                  <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                                </label>
                              </div>
                            </>
                          ) : (
                            <label className="flex flex-col items-center gap-3 cursor-pointer group/inner">
                              <div className="w-12 h-12 rounded-full bg-foreground/5 flex items-center justify-center transition-transform group-hover/inner:scale-110">
                                {isUploading ? (
                                  <div className="w-5 h-5 rounded-full border-2 border-foreground/20 border-t-foreground animate-spin" />
                                ) : (
                                  <Upload className="w-5 h-5 text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/40" />
                                )}
                              </div>
                              <div className="text-center">
                                <p className="text-[11px] font-bold text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/40 uppercase tracking-widest">
                                  {isUploading ? 'Transferring Node...' : 'Upload Media'}
                                </p>
                                <p className="text-[9px] text-foreground/40 dark:text-foreground/40 dark:text-foreground/40 dark:text-foreground/40 dark:text-foreground/20 mt-1">High-Resolution Node Submission</p>
                              </div>
                              <input type="file" className="hidden" accept="image/*" onChange={handleFileUpload} />
                            </label>
                          )}
                        </div>

                        {/* Fallback URL input */}
                        <div className="space-y-2">
                          <p className="text-[10px] font-medium text-foreground/50 dark:text-foreground/50 dark:text-foreground/50 dark:text-foreground/50 dark:text-foreground/30 px-1 uppercase tracking-widest">External URL (Fallback)</p>
                          <input 
                            placeholder="https://example.com/image.jpg" 
                            value={newFeatured.imageUrl}
                            onChange={(e) => setNewFeatured({...newFeatured, imageUrl: e.target.value})}
                            className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-xl px-5 py-3.5 text-[12px] text-foreground/80 dark:text-foreground/80 dark:text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 placeholder:text-foreground/40 dark:text-foreground/40 dark:text-foreground/40 dark:text-foreground/40 dark:text-foreground/20 focus:border-blue-500/50 transition-all outline-none font-mono"
                          />
                        </div>
                      </div>
                      
                      <input 
                        placeholder="Instagram Profile URL (Optional)" 
                        value={newFeatured.instagramUrl}
                        onChange={(e) => setNewFeatured({...newFeatured, instagramUrl: e.target.value})}
                        className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-xl px-5 py-3.5 text-[13px] text-foreground placeholder:text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/40 focus:border-blue-500 transition-all outline-none"
                      />
                   </div>

                   <div className="space-y-4">
                      <p className="text-[13px] font-semibold text-foreground/80 px-1">Style Narrative</p>
                      <textarea 
                        placeholder="Describe the user's signature style..." 
                        value={newFeatured.styleDescription}
                        onChange={(e) => setNewFeatured({...newFeatured, styleDescription: e.target.value})}
                        className="w-full bg-foreground/[0.03] border border-foreground/5 rounded-2xl px-5 py-4 text-[14px] text-foreground min-h-[120px] placeholder:text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/40 focus:border-blue-500 transition-all outline-none resize-none"
                      />
                   </div>
                </div>
 
                <div className="pt-8 mt-6 border-t border-foreground/10 flex justify-end gap-3 font-inter">
                    <button 
                      onClick={() => { setShowManualForm(false); setEditingUser(null); }}
                      className="px-6 py-3 rounded-full bg-foreground/10 text-foreground text-[14px] font-medium hover:bg-foreground/20 transition-all"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={handleSaveFeatured}
                      disabled={processing === 'save-featured' || !newFeatured.name || !newFeatured.imageUrl}
                      className="px-8 py-3 rounded-full bg-blue-500 text-foreground text-[14px] font-semibold hover:bg-blue-600 transition-all shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:shadow-none"
                    >
                      {processing === 'save-featured' ? 'Saving...' : (editingUser ? 'Save Changes' : 'Add User')}
                    </button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
