"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { 
  Users, MessageSquare, Shield, ShieldAlert, Search, 
  Settings, UserPlus, MoreVertical, Ban, Trash2, ExternalLink
} from "lucide-react";
import { format } from "date-fns";

const ChatGrowthChart = dynamic(
  () => import("@/components/admin/charts/ChatGrowthChart"),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse rounded-xl bg-foreground/[0.03]" />,
  }
);

type ChatUser = {
  id: string;
  name: string;
  email: string;
  phone: string;
  image: string;
  messageCount: number;
  orderCount: number;
  lastActive: string;
  joinedAt: string;
};

export default function ChatManagementPage() {
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [chatAccessMode, setChatAccessMode] = useState<"open" | "orders_only">("open");
  const [savingSettings, setSavingSettings] = useState(false);

  const [analytics, setAnalytics] = useState<{ growth: any[] }>({ growth: [] });

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/admin/community/chat-users");
      const data = await res.json();
      if (data.users) setUsers(data.users);
      if (data.analytics) setAnalytics(data.analytics);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = () => {
    const headers = ["Name", "Email", "Phone", "Messages", "Orders", "Last Active", "Joined At"];
    const rows = filteredUsers.map(u => [
      u.name,
      u.email,
      u.phone,
      u.messageCount,
      u.orderCount,
      u.lastActive,
      u.joinedAt
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," 
      + headers.join(",") + "\n"
      + rows.map(r => r.join(",")).join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `community_data_${format(new Date(), "yyyy-MM-dd")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/admin/chat-settings");
      const data = await res.json();
      if (data.chatAccessMode) setChatAccessMode(data.chatAccessMode);
    } catch (err) {
      console.error(err);
    }
  };

  const updateSettings = async (mode: "open" | "orders_only") => {
    setSavingSettings(true);
    try {
      const res = await fetch("/api/admin/chat-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatAccessMode: mode })
      });
      if (res.ok) setChatAccessMode(mode);
    } catch (err) {
      console.error(err);
    } finally {
      setSavingSettings(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchSettings();
  }, []);

  const filteredUsers = users.filter(user => 
    user.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.phone?.includes(searchTerm)
  );

  const topContributors = [...users]
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Community & Chat</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage your community members, chat settings, and access levels.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-muted p-1 rounded-xl flex">
            <button
              onClick={() => updateSettings("open")}
              disabled={savingSettings}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                chatAccessMode === "open"
                  ? "bg-white dark:bg-black shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Open Access
            </button>
            <button
              onClick={() => updateSettings("orders_only")}
              disabled={savingSettings}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                chatAccessMode === "orders_only"
                  ? "bg-white dark:bg-black shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Orders Only
            </button>
          </div>
          {savingSettings && <div className="w-4 h-4 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />}
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <div className="glass-card p-5 rounded-2xl border border-border/50">
          <div className="flex items-center gap-3 text-muted-foreground mb-2">
            <Users className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-widest">Total Members</span>
          </div>
          <p className="text-3xl font-bold">{users.length}</p>
        </div>
        <div className="glass-card p-5 rounded-2xl border border-border/50">
          <div className="flex items-center gap-3 text-muted-foreground mb-2">
            <MessageSquare className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-widest">Messages</span>
          </div>
          <p className="text-3xl font-bold">
            {users.reduce((acc, u) => acc + u.messageCount, 0)}
          </p>
        </div>
        <div className="glass-card p-5 rounded-2xl border border-border/50">
          <div className="flex items-center gap-3 text-muted-foreground mb-2">
            <Shield className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-widest">Access Mode</span>
          </div>
          <p className="text-[10px] font-black uppercase tracking-tighter inline-flex px-2 py-1 bg-foreground text-background rounded-md mt-2">
            {chatAccessMode === 'open' ? 'EVERYONE ALLOWED' : 'MEMBERS WITH ORDERS'}
          </p>
        </div>
        <div className="glass-card p-5 rounded-2xl border border-border/50">
          <div className="flex items-center gap-3 text-muted-foreground mb-2">
            <UserPlus className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-widest">Active Today</span>
          </div>
          <p className="text-3xl font-bold">
            {users.filter(u => new Date(u.lastActive).toDateString() === new Date().toDateString()).length}
          </p>
        </div>
      </div>

      {/* Analytics dashboard */}
      <div className="grid lg:grid-cols-3 gap-6">
         {/* User Growth Chart */}
         <div className="lg:col-span-2 glass-card p-6 rounded-2xl border border-border/50">
           <h3 className="text-xs font-bold uppercase tracking-[0.2em] mb-6 text-muted-foreground">30-Day Growth</h3>
           <div className="h-64 w-full">
             {analytics.growth.length > 0 ? (
               <ChatGrowthChart data={analytics.growth} />
             ) : (
               <div className="h-full flex items-center justify-center text-[10px] font-bold text-muted-foreground uppercase tracking-widest italic">
                 Insufficient data for growth chart
               </div>
             )}
           </div>
         </div>

         {/* Top Contributors */}
         <div className="glass-card p-6 rounded-2xl border border-border/50">
           <h3 className="text-xs font-bold uppercase tracking-[0.2em] mb-6 text-muted-foreground">Top Contributors</h3>
           <div className="space-y-4">
             {topContributors.map((user, idx) => (
                <div key={user.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black text-muted-foreground/30 w-4">#{idx+1}</span>
                    <div className="w-8 h-8 rounded-full bg-muted overflow-hidden">
                      <img 
                        src={user.image || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.name}`} 
                        alt={user.name} 
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <span className="text-[11px] font-bold truncate max-w-[100px]">{user.name}</span>
                  </div>
                  <span className="text-[10px] font-black bg-muted px-2 py-0.5 rounded-full">{user.messageCount} msg</span>
                </div>
             ))}
           </div>
         </div>
      </div>

      {/* Main Content */}
      <div className="glass-card rounded-2xl border border-border/50 overflow-hidden">
        <div className="p-4 border-b border-border/50 flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search members..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-background border border-input rounded-xl text-sm outline-none focus:ring-2 focus:ring-ring transition-all"
            />
          </div>
          <button 
            onClick={exportToCSV}
            className="flex items-center gap-2 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors px-3 py-2"
          >
            <Settings className="w-4 h-4" />
            Export Data
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground font-bold text-[10px] uppercase tracking-widest">
              <tr>
                <th className="px-6 py-4">User</th>
                <th className="px-6 py-4">Stats</th>
                <th className="px-6 py-4">Last Active</th>
                <th className="px-6 py-4">Joined</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-6 h-6 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />
                      <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Loading Community...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground italic">
                    No community members found.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-muted/30 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-muted overflow-hidden border border-border flex-shrink-0">
                          {user.image ? (
                            <img src={user.image} alt={user.name} className="w-full h-full object-cover" />
                          ) : (
                            <img 
                              src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user.name}`} 
                              alt={user.name} 
                              className="w-full h-full"
                            />
                          )}
                        </div>
                        <div>
                          <p className="font-bold text-foreground text-sm flex items-center gap-2">
                            {user.name}
                            {user.orderCount > 0 && (
                              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">{user.email || user.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex gap-4">
                        <div>
                          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-tighter">Messages</p>
                          <p className="font-bold">{user.messageCount}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-tighter">Orders</p>
                          <p className="font-bold">{user.orderCount}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs font-medium text-foreground/70">
                      {format(new Date(user.lastActive), "MMM d, h:mm a")}
                    </td>
                    <td className="px-6 py-4 text-xs font-medium text-muted-foreground">
                      {format(new Date(user.joinedAt), "MMM d, yyyy")}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground transition-all">
                          <Ban className="w-4 h-4" />
                        </button>
                        <button className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground transition-all">
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <button className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground transition-all">
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
