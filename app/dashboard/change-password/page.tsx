"use client";

import React, { useState } from 'react';
import { 
  Lock, 
  Check, 
  AlertCircle, 
  Loader2, 
  ShieldCheck,
  Eye,
  EyeOff
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import PasskeyManager from '@/components/admin/PasskeyManager';

export default function ChangePasswordPage() {
  const { data: session, update } = useSession();
  const router = useRouter();
  const [formData, setFormData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [isSaving, setIsSaving] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (formData.newPassword !== formData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (formData.newPassword.length < 8) {
      toast.error('Password must be at least 8 characters long');
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch('/api/admin/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: formData.currentPassword,
          newPassword: formData.newPassword
        })
      });
      
      const data = await res.json();
      
      if (res.ok) {
        toast.success('Password updated successfully');
        // Update session to clear needsPasswordChange
        await update();
        router.push('/dashboard');
      } else {
        toast.error(data.error || 'Failed to update password');
      }
    } catch (error) {
      toast.error('An error occurred');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card max-w-md w-full p-10 rounded-[2.5rem] border border-foreground/10 shadow-2xl space-y-8"
      >
        <div className="text-center space-y-3">
          <div className="w-16 h-16 bg-blue-500/10 rounded-3xl flex items-center justify-center mx-auto mb-2 border border-blue-500/20">
            <ShieldCheck className="w-8 h-8 text-blue-500" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Update Password</h1>
          <p className="text-foreground/50 text-sm">
            For security reasons, you must change your password before continuing.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground/60 ml-1">Current Password</label>
              <div className="relative">
                <input 
                  required
                  type={showPasswords ? "text" : "password"} 
                  value={formData.currentPassword}
                  onChange={(e) => setFormData({...formData, currentPassword: e.target.value})}
                  className="w-full bg-foreground/5 border border-foreground/5 rounded-2xl px-5 py-4 text-sm focus:bg-foreground/10 focus:border-foreground/20 transition-all outline-none"
                  placeholder="Enter current password"
                />
                <button 
                  type="button"
                  onClick={() => setShowPasswords(!showPasswords)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-foreground/20 hover:text-foreground/60"
                >
                  {showPasswords ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground/60 ml-1">New Password</label>
              <input 
                required
                type={showPasswords ? "text" : "password"} 
                value={formData.newPassword}
                onChange={(e) => setFormData({...formData, newPassword: e.target.value})}
                className="w-full bg-foreground/5 border border-foreground/5 rounded-2xl px-5 py-4 text-sm focus:bg-foreground/10 focus:border-foreground/20 transition-all outline-none"
                placeholder="Minimum 8 characters"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground/60 ml-1">Confirm New Password</label>
              <input 
                required
                type={showPasswords ? "text" : "password"} 
                value={formData.confirmPassword}
                onChange={(e) => setFormData({...formData, confirmPassword: e.target.value})}
                className="w-full bg-foreground/5 border border-foreground/5 rounded-2xl px-5 py-4 text-sm focus:bg-foreground/10 focus:border-foreground/20 transition-all outline-none"
                placeholder="Repeat new password"
              />
            </div>
          </div>

          <div className="pt-2">
            <button 
              type="submit"
              disabled={isSaving}
              className="w-full py-4 bg-foreground text-background rounded-2xl font-bold shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Lock className="w-4 h-4" />}
              Secure Account
            </button>
          </div>
        </form>

        <div className="flex items-start gap-3 p-4 bg-amber-500/5 rounded-2xl border border-amber-500/10">
          <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-amber-500/80 leading-relaxed font-medium">
            Strong passwords use a combination of letters, numbers, and symbols. 
            Do not reuse passwords from other platforms.
          </p>
        </div>
      </motion.div>

      <div className="mt-8">
        <PasskeyManager />
      </div>

      <style jsx global>{`
        .glass-card {
          background: rgba(255, 255, 255, 0.01);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
        }
        .dark .glass-card {
          background: rgba(0, 0, 0, 0.2);
        }
      `}</style>
    </div>
  );
}
