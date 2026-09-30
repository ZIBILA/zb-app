"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Store, Truck, CreditCard, Save, CheckCircle, AlertCircle, RefreshCw,
  Eye, EyeOff, Shield, Webhook, Key, Lock, Loader2, Fingerprint, Zap, Sparkles, ExternalLink
} from 'lucide-react';
import { motion } from 'framer-motion';

interface SettingsData {
  id: string;
  shopDomain: string;
  accessToken: string;
  delhiveryApiKey: string;
  razorpayKeyId: string;
  razorpayKeySecret: string;
  shiprocketEmail: string;
  shiprocketPassword: string;
  shiprocketToken: string;
  webhookSecret: string;
  whatsappPhoneId: string;
  whatsappToken: string;
  firebaseProjectId: string;
  firebaseClientEmail: string;
  firebasePrivateKey: string;
  sendgridApiKey: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioPhoneNumber: string;
  claudeApiKey: string;
  claudeWebhookSecret: string;
  [key: string]: any;
}

function SettingsGroup({ title, children, icon: Icon }: { title?: string; children: React.ReactNode; icon?: any }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 15 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
      className="space-y-5 relative z-10"
    >
      {title && (
        <div className="flex items-center gap-3 px-6">
           {Icon && <Icon className="w-4 h-4 text-foreground/40" />}
           <h3 className="text-[11px] font-bold uppercase tracking-[0.4em] text-foreground/40">{title}</h3>
        </div>
      )}
      <div className="glass-card rounded-[2.5rem] overflow-hidden">
        <div className="relative z-10">
           {children}
        </div>
      </div>
    </motion.div>
  );
}

function SettingsRow({
  label,
  children,
  icon: Icon,
  description
}: {
  label: string;
  children: React.ReactNode;
  icon?: any;
  description?: string;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between px-10 py-8 border-b border-foreground/5 last:border-0 gap-6 group/row hover:bg-foreground/[0.02] transition-all duration-700">
      <div className="flex items-center gap-8">
        {Icon && (
          <div className="w-14 h-14 rounded-[1.25rem] bg-foreground/5 flex items-center justify-center text-foreground/40 border border-foreground/5 group-hover/row:bg-foreground group-hover/row:text-background transition-all duration-700 shadow-2xl">
            <Icon className="w-6 h-6" strokeWidth={1.5} />
          </div>
        )}
        <div className="flex flex-col">
          <span className="text-[15px] font-bold text-foreground tracking-tight leading-none mb-2 uppercase">{label}</span>
          {description && <span className="text-[10px] text-foreground/40 font-bold uppercase tracking-[0.3em] leading-none">{description}</span>}
        </div>
      </div>
      <div className="flex-1 w-full md:max-w-md flex justify-end">
        {children}
      </div>
    </div>
  );
}

function InputField({
  value,
  onChange,
  placeholder,
  secret = false
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secret?: boolean;
}) {
  const [show, setShow] = useState(!secret);
  return (
    <div className="relative flex items-center w-full">
      <input
        type={show ? 'text' : 'password'}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-foreground/5 px-6 py-4 rounded-2xl border border-foreground/5 focus:border-foreground/20 text-right text-[13px] font-bold text-foreground placeholder:text-foreground/20 outline-none transition-all pr-14 shadow-inner font-mono tracking-tight"
      />
      {secret && (
        <button 
          onClick={() => setShow(!show)}
          className="absolute right-4 p-1.5 rounded-lg text-foreground/40 hover:text-foreground transition-colors"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      )}
    </div>
  );
}

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<Partial<SettingsData>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [claudeTestStatus, setClaudeTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [claudeTestMsg, setClaudeTestMsg] = useState('');

  useEffect(() => {
    fetch('/api/admin/settings')
      .then(r => r.json())
      .then(data => {
        setSettings(data);
        setLoading(false);
      });
  }, []);

  const handleSave = async () => {
    if (saving) return; 
    setSaving(true);
    setSaveStatus('idle');

    const adminKeys: (keyof SettingsData)[] = [
        'shopDomain', 'accessToken', 'delhiveryApiKey',
        'razorpayKeyId', 'razorpayKeySecret',
        'shiprocketEmail', 'shiprocketPassword', 'shiprocketToken', 'webhookSecret',
        'whatsappPhoneId', 'whatsappToken', 'firebaseProjectId', 'firebaseClientEmail',
        'firebasePrivateKey', 'sendgridApiKey', 'twilioAccountSid', 'twilioAuthToken', 'twilioPhoneNumber',
        'ringCarouselItems', 'claudeApiKey', 'claudeWebhookSecret', 'openaiApiKey', 'openaiWebhookSecret'
    ];

    const partialUpdate: any = { shopId: settings.id };
    adminKeys.forEach(key => {
        if (settings[key] !== undefined) partialUpdate[key] = settings[key];
    });

    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partialUpdate),
      });
      if (!res.ok) throw new Error('Update failed');
      setSaveStatus('success');
    } catch (err: any) {
      setSaveStatus('error');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveStatus('idle'), 4000);
    }
  };

  const set = (key: keyof SettingsData) => (value: any) => setSettings(prev => ({ ...prev, [key]: value }));

  if (loading) return (
     <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
      <Loader2 className="w-5 h-5 text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/40 animate-spin" />
      <span className="text-[10px] font-medium uppercase tracking-widest text-foreground/80 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/80 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/60 dark:text-foreground/40">Loading Settings...</span>
    </div>
  );

   return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="max-w-4xl mx-auto space-y-10 pb-20 relative z-10"
    >
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-10 px-4 pt-10 mb-16 relative z-10">
        <div className="space-y-4">
          <h1 className="text-5xl font-bold text-foreground uppercase tracking-tighter leading-none">
            Infrastructure
          </h1>
          <p className="text-[11px] text-foreground/50 font-bold uppercase tracking-[0.4em] max-w-xl">
            Secure configuration and API key management.
          </p>
        </div>
        
        <button
          onClick={handleSave}
          disabled={saving}
          className={`flex items-center justify-center gap-3 px-8 py-3 rounded-2xl text-[10px] font-bold tracking-[0.3em] uppercase transition-all shadow-xl active:scale-95 ${
            saveStatus === 'success' ? 'bg-emerald-500 text-white shadow-emerald-500/20' : 'bg-foreground text-background shadow-foreground/20 hover:opacity-90'
          } disabled:opacity-50`}
        >
          {saving ? (
            <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={2.5} />
          ) : saveStatus === 'success' ? (
            <CheckCircle className="w-4 h-4" strokeWidth={2.5} />
          ) : (
             <Save className="w-4 h-4" strokeWidth={2.5} />
          )}
          {saving ? 'Synchronizing...' : saveStatus === 'success' ? 'Settings Saved' : saveStatus === 'error' ? 'Save Failed' : 'Commit Config'}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-8">
        
        {/* Shopify Group */}
        <SettingsGroup title="Shopify Integration" icon={Store}>
           <SettingsRow label="Store Domain" icon={Store} description="Primary endpoint (.myshopify.com)">
              <InputField value={settings.shopDomain!} onChange={set('shopDomain')} placeholder="store-name.myshopify.com" />
           </SettingsRow>
           <SettingsRow label="Admin Access Token" icon={Lock} description="Shp_ access key">
              <InputField value={settings.accessToken!} onChange={set('accessToken')} secret />
           </SettingsRow>
        </SettingsGroup>

        {/* Payments Group */}
        <SettingsGroup title="Payment Gateways" icon={CreditCard}>
           <SettingsRow label="Razorpay ID" icon={Key} description="Public merchant key">
              <InputField value={settings.razorpayKeyId!} onChange={set('razorpayKeyId')} />
           </SettingsRow>
           <SettingsRow label="Razorpay Secret" icon={Fingerprint} description="Private merchant secret">
              <InputField value={settings.razorpayKeySecret!} onChange={set('razorpayKeySecret')} secret />
           </SettingsRow>
           <div className="px-10 py-6 border-t border-foreground/5">
              <Link href="/dashboard/payments/razorpay" className="text-[10px] font-bold uppercase tracking-[0.25em] text-foreground/50 hover:text-foreground transition-colors">
                 → Razorpay status, webhooks, and mobile app notes
              </Link>
           </div>
        </SettingsGroup>

        {/* Logistics Group */}
        <SettingsGroup title="Logistics Services" icon={Truck}>
           <SettingsRow label="Delhivery API Key" icon={Zap} description="Primary logistics API">
              <InputField value={settings.delhiveryApiKey!} onChange={set('delhiveryApiKey')} secret />
           </SettingsRow>
           <SettingsRow label="Shiprocket Email" icon={Zap} description="Login Email">
              <InputField value={settings.shiprocketEmail!} onChange={set('shiprocketEmail')} />
           </SettingsRow>
           <SettingsRow label="Shiprocket Password" icon={Zap} description="Login Password">
              <InputField value={settings.shiprocketPassword!} onChange={set('shiprocketPassword')} secret />
           </SettingsRow>
           <SettingsRow label="Shiprocket Auth" icon={Zap} description="Cloud synchronization token">
              <InputField value={settings.shiprocketToken!} onChange={set('shiprocketToken')} secret />
           </SettingsRow>
        </SettingsGroup>

        {/* Security Hooks */}
        <SettingsGroup title="Webhooks & Events" icon={Webhook}>
           <SettingsRow label="Webhook Secret" icon={Webhook} description="HMAC SHA256 validation">
              <InputField value={settings.webhookSecret!} onChange={set('webhookSecret')} secret />
           </SettingsRow>
        </SettingsGroup>

        {/* Marketing & Communications */}
        <SettingsGroup title="Marketing & Notifications" icon={Zap}>
           <SettingsRow label="Meta WhatsApp ID" icon={Key} description="WhatsApp Business Phone Number ID">
              <InputField value={settings.whatsappPhoneId!} onChange={set('whatsappPhoneId')} />
           </SettingsRow>
           <SettingsRow label="Meta WhatsApp Token" icon={Lock} description="Permanent Access Token">
              <InputField value={settings.whatsappToken!} onChange={set('whatsappToken')} secret />
           </SettingsRow>
           <SettingsRow label="Firebase Project ID" icon={Key} description="Firebase Push Notifications">
              <InputField value={settings.firebaseProjectId!} onChange={set('firebaseProjectId')} />
           </SettingsRow>
           <SettingsRow label="Firebase Service Email" icon={Lock} description="Firebase Admin Service Account">
              <InputField value={settings.firebaseClientEmail!} onChange={set('firebaseClientEmail')} />
           </SettingsRow>
           <SettingsRow label="Firebase Private Key" icon={Lock} description="Service Account Private Key">
              <InputField value={settings.firebasePrivateKey!} onChange={set('firebasePrivateKey')} secret />
           </SettingsRow>
           <SettingsRow label="SendGrid API Key" icon={Lock} description="Email Delivery System">
              <InputField value={settings.sendgridApiKey!} onChange={set('sendgridApiKey')} secret />
           </SettingsRow>
           <SettingsRow label="Twilio Account SID" icon={Key} description="SMS Delivery System">
              <InputField value={settings.twilioAccountSid!} onChange={set('twilioAccountSid')} />
           </SettingsRow>
           <SettingsRow label="Twilio Auth Token" icon={Lock} description="SMS Delivery Secret">
              <InputField value={settings.twilioAuthToken!} onChange={set('twilioAuthToken')} secret />
           </SettingsRow>
           <SettingsRow label="Twilio Phone Number" icon={Lock} description="Sender Phone Number">
              <InputField value={settings.twilioPhoneNumber!} onChange={set('twilioPhoneNumber')} />
           </SettingsRow>
        </SettingsGroup>

        {/* Homepage Presentation */}
        <SettingsGroup title="Homepage Presentation" icon={Eye}>
           <SettingsRow label="Accessory Collection" icon={Store} description="Shopify collection handle for the homepage carousel (default: accessories)">
              <InputField value={settings.ringCarouselItems === "[]" ? "" : settings.ringCarouselItems || ""} onChange={set('ringCarouselItems')} placeholder="accessories" />
           </SettingsRow>
        </SettingsGroup>

        {/* Zica AI · Claude */}
        <SettingsGroup title="Zica AI · Claude Integration" icon={Sparkles}>
           <SettingsRow label="Claude API Key" icon={Key} description="Anthropic API key (sk-ant-api...)">
              <InputField value={settings.claudeApiKey!} onChange={set('claudeApiKey')} placeholder="sk-ant-api03-..." secret />
           </SettingsRow>
           <SettingsRow label="Webhook Signing Secret" icon={Lock} description="Used to verify Claude Platform webhooks">
              <InputField value={settings.claudeWebhookSecret!} onChange={set('claudeWebhookSecret')} placeholder="whsec_..." secret />
           </SettingsRow>
           <div className="px-10 py-6 border-t border-foreground/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={async () => {
                    const key = settings.claudeApiKey;
                    if (!key) { setClaudeTestMsg('Enter an API key first.'); setClaudeTestStatus('error'); return; }
                    setClaudeTestStatus('testing');
                    setClaudeTestMsg('');
                    try {
                      const res = await fetch('/api/admin/claude/health', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ overrideKey: key })
                      });
                      const data = await res.json();
                      if (data.status === 'ok') {
                        setClaudeTestStatus('ok');
                        setClaudeTestMsg(`Connected · Model: ${data.model}`);
                      } else {
                        setClaudeTestStatus('error');
                        setClaudeTestMsg(data.message || 'Connection failed');
                      }
                    } catch {
                      setClaudeTestStatus('error');
                      setClaudeTestMsg('Network error — could not reach health endpoint.');
                    }
                  }}
                  disabled={claudeTestStatus === 'testing'}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[9px] font-bold uppercase tracking-[0.2em] transition-all active:scale-95 ${
                    claudeTestStatus === 'ok'
                      ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                      : claudeTestStatus === 'error'
                      ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                      : 'bg-foreground/5 text-foreground/60 border border-foreground/10 hover:bg-foreground/10'
                  }`}
                >
                  {claudeTestStatus === 'testing' ? <RefreshCw className="w-3 h-3 animate-spin" /> : 
                   claudeTestStatus === 'ok' ? <CheckCircle className="w-3 h-3" /> : 
                   claudeTestStatus === 'error' ? <AlertCircle className="w-3 h-3" /> : 
                   <Zap className="w-3 h-3" />}
                  {claudeTestStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                </button>
                {claudeTestMsg && (
                  <span className={`text-[9px] font-bold uppercase tracking-wider ${
                    claudeTestStatus === 'ok' ? 'text-emerald-500' : 'text-rose-400'
                  }`}>{claudeTestMsg}</span>
                )}
              </div>
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-foreground/40 hover:text-foreground/70 transition-colors"
              >
                Get API Key <ExternalLink className="w-3 h-3" />
              </a>
           </div>
        </SettingsGroup>

        {/* Zica AI · OpenAI (Mobile App Features) */}
        <SettingsGroup title="Zica AI · OpenAI Integration" icon={Sparkles}>
           <SettingsRow label="OpenAI API Key" icon={Key} description="OpenAI API key (sk-proj-...)">
              <InputField value={settings.openaiApiKey!} onChange={set('openaiApiKey')} placeholder="sk-proj-..." secret />
           </SettingsRow>
           <SettingsRow label="Webhook Signing Secret" icon={Lock} description="Used to verify OpenAI API webhooks">
              <InputField value={settings.openaiWebhookSecret!} onChange={set('openaiWebhookSecret')} placeholder="whsec_..." secret />
           </SettingsRow>
           <div className="px-10 py-6 border-t border-foreground/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                 <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-500">
                    Connected to User Chat & Voice Services
                 </span>
              </div>
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer"
                 className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-foreground/40 hover:text-foreground/70 transition-colors"
              >
                 Get OpenAI Key <ExternalLink className="w-3 h-3" />
              </a>
           </div>
        </SettingsGroup>

      </div>

      <div className="text-center pt-10">
         <div className="inline-flex items-center gap-3 px-6 py-2.5 border border-foreground/[0.08] rounded-full bg-foreground/[0.02] shadow-xl backdrop-blur-md">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse-slow" />
            <span className="text-[10px] font-bold uppercase tracking-[0.4em] text-foreground/50">System Configuration Locked</span>
         </div>
      </div>
    </motion.div>
  );
}
