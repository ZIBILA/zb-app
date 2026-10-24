"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import DOMPurify from 'isomorphic-dompurify';
import { 
  MessageSquare, Search, Send, RefreshCcw, User, Phone, 
  Mail, ShieldAlert, Check, CheckCheck, Clock, AlertCircle, Image, 
  ChevronRight, ArrowLeftRight, ExternalLink, UserCheck, Sparkles,
  ShoppingBag, X, Paperclip, Loader2, UploadCloud, Info, Trash2,
  PanelRightClose, PanelRightOpen, Calendar, CheckCircle2, HelpCircle,
  AlertTriangle, Ban, Copy, CheckSquare, FileText, Film, Music, Download, Edit3, Save, UserPlus
} from "lucide-react";
import { toast } from "sonner";

interface Conversation {
  phoneNumber: string;
  lastMessage: {
    id: string;
    body: string;
    direction: "inbound" | "outbound";
    status: string;
    createdAt: string;
  };
  unreadCount: number;
  customerName: string | null;
  customerId: string | null;
  customerEmail: string | null;
  whatsappOptedOut: boolean | null;
  lastInboundCreatedAt: string | null;
  ordersCount?: number;
  totalSpent?: number;
}

interface Message {
  id: string;
  direction: "inbound" | "outbound";
  waMessageId: string | null;
  phoneNumber: string;
  body: string | null;
  mediaUrl?: string | null;
  mediaType?: string | null;
  status: string;
  createdAt: string;
  templateName?: string | null;
}

export default function WhatsAppChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "unread" | "care" | "optout">("all");
  
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [showMediaInput, setShowMediaInput] = useState(false);
  const [uploadType, setUploadType] = useState<string>("image");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [failedMediaIds, setFailedMediaIds] = useState<Record<string, boolean>>({});

  // Side Drawer for contact details & editing
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [editCustomerName, setEditCustomerName] = useState("");
  const [editCustomerEmail, setEditCustomerEmail] = useState("");
  const [editCustomerPhone, setEditCustomerPhone] = useState("");
  const [savingContact, setSavingContact] = useState(false);

  // Templates Selection State
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templatesList, setTemplatesList] = useState<any[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [templateVariables, setTemplateVariables] = useState<string[]>([]);

  // Catalog / Product Selection State
  const [showCatalogModal, setShowCatalogModal] = useState(false);
  const [productsList, setProductsList] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [aiAutoReply, setAiAutoReply] = useState<boolean>(true);
  const [globalWhatsappAiEnabled, setGlobalWhatsappAiEnabled] = useState<boolean>(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const forceScrollRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch global WhatsApp AI setting
  useEffect(() => {
    async function fetchGlobalAiSetting() {
      try {
        const res = await fetch('/api/admin/ai/settings');
        const data = await res.json();
        if (res.ok && typeof data.zicaAiWhatsappEnabled === 'boolean') {
          setGlobalWhatsappAiEnabled(data.zicaAiWhatsappEnabled);
        }
      } catch (err) {
        console.error('Failed to fetch global AI settings:', err);
      }
    }
    fetchGlobalAiSetting();
  }, []);

  const handleToggleGlobalWhatsappAi = async () => {
    const nextVal = !globalWhatsappAiEnabled;
    setGlobalWhatsappAiEnabled(nextVal);
    try {
      const res = await fetch('/api/admin/ai/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zicaAiWhatsappEnabled: nextVal })
      });
      if (res.ok) {
        toast.success(nextVal ? "Global WhatsApp Zica AI Auto-Reply ENABLED!" : "Global WhatsApp Zica AI Auto-Reply DISABLED!");
      } else {
        setGlobalWhatsappAiEnabled(!nextVal);
      }
    } catch (err) {
      setGlobalWhatsappAiEnabled(!nextVal);
    }
  };

  // Fetch WABA chat settings (AI Auto-Reply toggle) on active conversation change
  useEffect(() => {
    if (!activePhone) return;
    async function fetchChatSettings() {
      try {
        const res = await fetch(`/api/whatsapp/chat/settings?phone=${encodeURIComponent(activePhone!)}`);
        const data = await res.json();
        if (res.ok && typeof data.aiAutoReply === 'boolean') {
          setAiAutoReply(data.aiAutoReply);
        }
      } catch (err) {
        console.error("Error loading chat settings:", err);
      }
    }
    fetchChatSettings();
  }, [activePhone]);

  const handleToggleAiAutoReply = async () => {
    if (!activePhone) return;
    const nextVal = !aiAutoReply;
    setAiAutoReply(nextVal);
    try {
      const res = await fetch("/api/whatsapp/chat/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: activePhone,
          aiAutoReply: nextVal
        })
      });
      if (res.ok) {
        toast.success(nextVal ? "Zica AI Auto-Reply turned ON for this chat!" : "Zica AI Auto-Reply turned OFF for this chat.");
      } else {
        setAiAutoReply(!nextVal);
        toast.error("Failed to update AI settings.");
      }
    } catch (err) {
      setAiAutoReply(!nextVal);
      toast.error("Network error updating AI settings.");
    }
  };

  // Fetch approved WABA templates on mount to map them for bubble rendering
  useEffect(() => {
    async function loadTemplatesOnMount() {
      try {
        const res = await fetch("/api/whatsapp/templates");
        const data = await res.json();
        if (res.ok && data.templates) {
          setTemplatesList(data.templates.filter((t: any) => t.status === "APPROVED"));
        }
      } catch (err) {
        console.error("Error pre-loading templates list:", err);
      }
    }
    loadTemplatesOnMount();
  }, []);

  // Fetch on-demand identity details when an active conversation is selected
  useEffect(() => {
    if (!activePhone) return;
    async function fetchIdentity() {
      try {
        const res = await fetch(`/api/whatsapp/chat/identity?phone=${encodeURIComponent(activePhone!)}`);
        if (res.ok) {
          const data = await res.json();
          setConversations(prev => prev.map(c => {
            if (c.phoneNumber === activePhone) {
              return {
                ...c,
                customerName: data.customerName || c.customerName,
                customerId: data.customerId || c.customerId,
                customerEmail: data.customerEmail || c.customerEmail,
                whatsappOptedOut: typeof data.whatsappOptedOut === 'boolean' ? data.whatsappOptedOut : c.whatsappOptedOut,
                ordersCount: data.ordersCount ?? c.ordersCount,
                totalSpent: data.totalSpent ?? c.totalSpent,
              };
            }
            return c;
          }));
        }
      } catch (err) {
        console.error("Error fetching conversation identity details:", err);
      }
    }
    fetchIdentity();
  }, [activePhone]);

  const activeConv = conversations.find(c => c.phoneNumber === activePhone);

  // Sync edit form state with current active conversation details
  useEffect(() => {
    if (activeConv) {
      setEditCustomerName(activeConv.customerName || "");
      setEditCustomerEmail(activeConv.customerEmail || "");
      setEditCustomerPhone(activeConv.phoneNumber || activePhone || "");
    } else if (activePhone) {
      setEditCustomerPhone(activePhone);
    }
    setIsEditingContact(false);
  }, [activePhone, activeConv?.customerName, activeConv?.customerEmail, activeConv?.customerId]);

  // Save or create customer contact profile
  const handleSaveContact = async () => {
    if (!activePhone) return;
    setSavingContact(true);
    const toastId = toast.loading("Saving customer contact details...");
    try {
      const payload = {
        name: editCustomerName.trim(),
        email: editCustomerEmail.trim() || null,
        phone: editCustomerPhone.trim() || activePhone,
        whatsappOptedOut: activeConv?.whatsappOptedOut ?? false
      };

      let res;
      if (activeConv?.customerId) {
        res = await fetch(`/api/admin/customers/${activeConv.customerId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch(`/api/admin/customers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      }

      const data = await res.json();
      if (res.ok && (data.success || data.customer)) {
        const updatedCust = data.customer;
        toast.success("Contact details saved successfully!", { id: toastId });
        setConversations(prev => prev.map(c => {
          if (c.phoneNumber === activePhone) {
            return {
              ...c,
              customerName: updatedCust.name || editCustomerName || c.customerName,
              customerEmail: updatedCust.email || editCustomerEmail || c.customerEmail,
              customerId: updatedCust.id || c.customerId
            };
          }
          return c;
        }));
        setIsEditingContact(false);
      } else {
        toast.error(data.error || "Failed to save customer details.", { id: toastId });
      }
    } catch (err: any) {
      toast.error("Network error saving customer contact.", { id: toastId });
    } finally {
      setSavingContact(false);
    }
  };

  const conversationsFetchInFlight = useRef(false);
  const messagesFetchInFlight = useRef(false);

  // Poll conversations every 30 seconds (paused when tab is in background, with in-flight guard)
  useEffect(() => {
    async function fetchConversations() {
      if (document.visibilityState !== 'visible') return;
      if (conversationsFetchInFlight.current) return;

      conversationsFetchInFlight.current = true;
      try {
        const res = await fetch("/api/whatsapp/chat/conversations");
        const data = await res.json();
        if (res.ok && data.conversations) {
          setConversations(data.conversations);
        }
      } catch (err) {
        console.error("Error loading chat conversations:", err);
      } finally {
        conversationsFetchInFlight.current = false;
        setLoadingConversations(false);
      }
    }
    fetchConversations();

    const interval = setInterval(fetchConversations, 30000);
    return () => clearInterval(interval);
  }, [refreshTrigger]);

  // Fetch messages when active conversation changes or poll every 4 seconds with since param (paused when hidden, with in-flight guard)
  useEffect(() => {
    if (!activePhone) return;

    const phoneForThisEffect = activePhone;
    const lastMsgRef = { current: "" };
    const abort = new AbortController();
    let active = true;

    async function fetchInitialMessages() {
      setLoadingMessages(true);
      try {
        const res = await fetch(
          `/api/whatsapp/chat/messages?phone=${encodeURIComponent(phoneForThisEffect)}`,
          { signal: abort.signal }
        );
        const data = await res.json();
        if (!active) return;
        if (res.ok && Array.isArray(data.messages)) {
          setMessages(data.messages);
          if (data.messages.length > 0) {
            lastMsgRef.current = data.messages[data.messages.length - 1].createdAt;
          }
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error("Error loading messages thread:", err);
      } finally {
        if (active) setLoadingMessages(false);
      }
    }

    async function pollDeltaMessages() {
      if (document.visibilityState !== 'visible') return;
      if (messagesFetchInFlight.current) return;

      messagesFetchInFlight.current = true;
      try {
        const sinceParam = lastMsgRef.current ? `&since=${encodeURIComponent(lastMsgRef.current)}` : '';
        const res = await fetch(
          `/api/whatsapp/chat/messages?phone=${encodeURIComponent(phoneForThisEffect)}${sinceParam}`,
          { signal: abort.signal }
        );
        const data = await res.json();
        if (!active) return;
        if (res.ok && Array.isArray(data.messages) && data.messages.length > 0) {
          setMessages(prev => {
            const existingIds = new Set(prev.map(m => m.id));
            const newMsgs = data.messages.filter((m: Message) => !existingIds.has(m.id));
            if (newMsgs.length === 0) return prev;
            return [...prev, ...newMsgs];
          });
          lastMsgRef.current = data.messages[data.messages.length - 1].createdAt;
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error("Error polling delta messages:", err);
      } finally {
        messagesFetchInFlight.current = false;
      }
    }

    fetchInitialMessages();

    const interval = setInterval(pollDeltaMessages, 4000);
    return () => {
      active = false;
      abort.abort();
      clearInterval(interval);
    };
  }, [activePhone]);

  // Scroll to bottom only on conversation open / send / when already near bottom.
  // Live polls must not yank the thread while an agent is reading older messages.
  useEffect(() => {
    forceScrollRef.current = true;
    isNearBottomRef.current = true;
  }, [activePhone]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    const scroll = (smooth: boolean) => {
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: smooth ? "smooth" : "auto" });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
      }
      isNearBottomRef.current = true;
    };

    if (forceScrollRef.current) {
      forceScrollRef.current = false;
      scroll(false);
      return;
    }
    if (isNearBottomRef.current) {
      scroll(true);
    }
  }, [messages]);

  // Calculate if the 24-hour service window is active for a timestamp
  const calculateIsServiceWindowActive = (lastInboundStr: string | null, lastMsg: any) => {
    let lastInboundTime = 0;
    if (lastInboundStr) {
      lastInboundTime = new Date(lastInboundStr).getTime();
    } else if (lastMsg && lastMsg.direction === "inbound") {
      lastInboundTime = new Date(lastMsg.createdAt).getTime();
    } else {
      // Fallback: check messages array
      const lastInboundInThread = [...messages]
        .reverse()
        .find(m => m.direction === "inbound");
      if (!lastInboundInThread) return false;
      lastInboundTime = new Date(lastInboundInThread.createdAt).getTime();
    }
    
    const now = new Date().getTime();
    const hoursElapsed = (now - lastInboundTime) / (1000 * 60 * 60);
    return hoursElapsed <= 24;
  };

  const isServiceWindowActive = () => {
    if (!activeConv) return false;
    return calculateIsServiceWindowActive(activeConv.lastInboundCreatedAt, activeConv.lastMessage);
  };

  const serviceWindowHoursRemaining = () => {
    let lastInboundTime = 0;
    if (activeConv?.lastInboundCreatedAt) {
      lastInboundTime = new Date(activeConv.lastInboundCreatedAt).getTime();
    } else {
      const lastInbound = [...messages]
        .reverse()
        .find(m => m.direction === "inbound");
      if (!lastInbound) return 0;
      lastInboundTime = new Date(lastInbound.createdAt).getTime();
    }
    
    const now = new Date().getTime();
    const hoursRemaining = 24 - (now - lastInboundTime) / (1000 * 60 * 60);
    return Math.max(0, parseFloat(hoursRemaining.toFixed(1)));
  };

  // Helper to determine if a message is the first of a consecutive block from the same sender
  const isFirstInGroup = (currentIdx: number, currentMsg: Message, messagesList: Message[]) => {
    if (currentIdx === 0) return true;
    const prevMsg = messagesList[currentIdx - 1];
    
    if (prevMsg.direction !== currentMsg.direction) return true;
    
    const currentMsgDate = new Date(currentMsg.createdAt).toDateString();
    const prevMsgDate = new Date(prevMsg.createdAt).toDateString();
    return currentMsgDate !== prevMsgDate;
  };

  // Toggle user Opt In/Out status via updated admin customer PUT route
  const handleToggleOptOut = async () => {
    if (!activeConv || !activeConv.customerId) {
      toast.error("CRM customer sync details missing. Cannot toggle consent status.");
      return;
    }
    
    const nextStatus = !activeConv.whatsappOptedOut;
    const toastId = toast.loading(nextStatus ? "Marking customer as OPTED OUT..." : "Marking customer as OPTED IN...");
    
    try {
      const res = await fetch(`/api/admin/customers/${activeConv.customerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: activeConv.customerName || "Customer",
          email: activeConv.customerEmail,
          phone: activeConv.phoneNumber,
          whatsappOptedOut: nextStatus
        })
      });
      const data = await res.json();
      
      if (res.ok && data.success) {
        toast.success(nextStatus ? "Opted out successfully!" : "Consent Opt-In registered!", { id: toastId });
        setConversations(prev => prev.map(c => 
          c.phoneNumber === activePhone ? { ...c, whatsappOptedOut: nextStatus } : c
        ));
      } else {
        toast.error(data.error || "Failed to update customer database profile.", { id: toastId });
      }
    } catch (err) {
      toast.error("Network error saving customer consent status.", { id: toastId });
    }
  };

  // Copy Phone / Contact Info to Clipboard
  const handleCopyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard!`);
  };

  // Handle direct image / media file upload
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const toastId = toast.loading("Uploading attachment...");
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/whatsapp/chat/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.url) {
        setMediaUrl(data.url);
        setUploadType(data.mediaType || "image");
        setShowMediaInput(true);
        toast.success("Attachment uploaded successfully! Write an optional caption message below.", { id: toastId });
      } else {
        toast.error(data.error || "Upload failed.", { id: toastId });
      }
    } catch (err) {
      toast.error("Network error during file upload.", { id: toastId });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Open Templates List
  const handleOpenTemplates = async () => {
    setShowTemplateModal(true);
    setLoadingTemplates(true);
    try {
      const res = await fetch("/api/whatsapp/templates");
      const data = await res.json();
      if (res.ok) {
        setTemplatesList(data.templates?.filter((t: any) => t.status === "APPROVED") || []);
      } else {
        toast.error("Failed to load templates.");
      }
    } catch (err) {
      toast.error("Error connecting to templates database.");
    } finally {
      setLoadingTemplates(false);
    }
  };

  // Select specific template to configure variables
  const handleSelectTemplate = (template: any) => {
    setSelectedTemplate(template);
    const bodyText = template.components?.find((c: any) => c.type === "BODY")?.text || "";
    const matches = bodyText.match(/\{\{(\d+)\}\}/g) || [];
    
    // Auto-fill common fields
    const defaults = new Array(matches.length).fill("");
    if (defaults.length > 0) {
      defaults[0] = activeConv?.customerName || "Customer";
    }
    if (defaults.length > 1) {
      defaults[1] = "app.zicabella.com";
    }
    setTemplateVariables(defaults);
  };

  // Trigger Send Template API call
  const handleSendTemplate = async () => {
    if (!activePhone || !selectedTemplate) return;

    setSending(true);
    const toastId = toast.loading("Dispatching WhatsApp template campaign...");
    try {
      const parameters = templateVariables.map(val => ({
        type: "text",
        text: val.trim() || "Value"
      }));

      const components: any[] = [];
      if (parameters.length > 0) {
        components.push({
          type: "body",
          parameters
        });
      }

      // Check if image header is required
      const headerComp = selectedTemplate.components?.find((c: any) => c.type === "HEADER");
      if (headerComp?.format === "IMAGE") {
        components.push({
          type: "header",
          parameters: [{
            type: "image",
            image: {
              link: "https://images.unsplash.com/photo-1556821840-3a63f95609a7?q=80&w=400"
            }
          }]
        });
      }

      const res = await fetch("/api/whatsapp/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: activePhone,
          templateName: selectedTemplate.name,
          components,
          text: selectedTemplate.components?.find((c: any) => c.type === "BODY")?.text
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        forceScrollRef.current = true;
        setMessages(prev => [...prev, data.message]);
        setShowTemplateModal(false);
        setSelectedTemplate(null);
        setRefreshTrigger(p => p + 1);
        toast.success("Template sent successfully!", { id: toastId });
      } else {
        toast.error(data.error || "Failed to send template message.", { id: toastId });
      }
    } catch (err) {
      toast.error("Network error sending template.", { id: toastId });
    } finally {
      setSending(false);
    }
  };

  // Open Shopify Products Catalog List
  const handleOpenCatalog = async () => {
    setShowCatalogModal(true);
    setLoadingProducts(true);
    try {
      const res = await fetch("/api/shopify/products?pageSize=40");
      const data = await res.json();
      if (res.ok && data.products) {
        setProductsList(data.products);
      } else {
        toast.error("Failed to load shopify products catalog.");
      }
    } catch (err) {
      toast.error("Error connection to Shopify Products API.");
    } finally {
      setLoadingProducts(false);
    }
  };

  // Send selected Shopify product directly to chat
  const handleSendProduct = async (product: any) => {
    if (!activePhone) return;

    setSending(true);
    const toastId = toast.loading("Sending catalog product details...");
    
    const productPrice = product.variants?.[0]?.price || "N/A";
    const productUrl = `https://app.zicabella.com/products/${product.handle || product.id}`;
    
    const messageBody = `*Check out this product from Zica Bella!* \n\n*${product.title}*\nPrice: ${productPrice} INR\n\nShop online now:\n${productUrl}`;
    const firstImage = product.image?.src || (product.images?.[0]?.src) || null;

    try {
      const res = await fetch("/api/whatsapp/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: activePhone,
          text: messageBody,
          mediaUrl: firstImage,
          mediaType: firstImage ? "image" : undefined
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        forceScrollRef.current = true;
        setMessages(prev => [...prev, data.message]);
        setShowCatalogModal(false);
        setRefreshTrigger(p => p + 1);
        toast.success("Catalog product sent!", { id: toastId });
      } else {
        toast.error(data.error || "Failed to send product.", { id: toastId });
      }
    } catch (err) {
      toast.error("Network error sending catalog message.", { id: toastId });
    } finally {
      setSending(false);
    }
  };

  // Handle standard message form dispatch
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activePhone || (!messageText.trim() && !mediaUrl.trim())) return;

    setSending(true);
    const textToSend = messageText;
    const urlToSend = mediaUrl;
    
    setMessageText("");
    setMediaUrl("");
    setShowMediaInput(false);

    try {
      const res = await fetch("/api/whatsapp/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: activePhone,
          text: textToSend || undefined,
          mediaUrl: urlToSend || undefined,
          mediaType: urlToSend ? uploadType : undefined
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        forceScrollRef.current = true;
        setMessages(prev => [...prev, data.message]);
        setRefreshTrigger(p => p + 1);
      } else {
        toast.error(data.error || "Failed to send message.");
        setMessageText(textToSend); // Restore
        setMediaUrl(urlToSend);
        if (urlToSend) setShowMediaInput(true);
      }
    } catch (err: any) {
      toast.error("Network error sending message.");
      setMessageText(textToSend); // Restore
      setMediaUrl(urlToSend);
      if (urlToSend) setShowMediaInput(true);
    } finally {
      setSending(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "read":
        return <CheckCheck className="w-4 h-4 text-sky-400" />;
      case "delivered":
        return <CheckCheck className="w-4 h-4 text-zinc-400" />;
      case "sent":
        return <Check className="w-4 h-4 text-zinc-400" />;
      case "failed":
        return <AlertCircle className="w-4 h-4 text-rose-500" />;
      default:
        return <Clock className="w-4 h-4 text-zinc-500 animate-pulse" />;
    }
  };

  // Parse custom WhatsApp styles (*bold*, _italics_, ~strike~, inline `code`, and URL links)
  const formatMessageText = (text: string | null) => {
    if (!text) return "";
    
    // Safety: escape HTML tags first
    let safeText = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
      
    // Apply formats
    safeText = safeText.replace(/\*([^*]+)\*/g, "<strong>$1</strong>");
    safeText = safeText.replace(/_([^_]+)_/g, "<em>$1</em>");
    safeText = safeText.replace(/~([^~]+)~/g, "<del>$1</del>");
    safeText = safeText.replace(/`([^`]+)`/g, '<code class="bg-[#1f2c34]/55 border border-white/5 px-1 py-0.5 rounded font-mono text-[11px] text-emerald-400">$1</code>');
    
    // Regular expression for urls
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    safeText = safeText.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-sky-400 hover:underline break-all inline-flex items-center gap-0.5">$1 <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg></a>');

    return <span dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(safeText) }} className="whitespace-pre-wrap leading-relaxed break-words block font-sans" />;
  };

  // Render a catalog product display card inside message list
  const renderCatalogBubble = (m: Message) => {
    const bodyText = m.body || "";
    const lines = bodyText.split("\n");
    
    let title = "Zica Bella Product";
    let price = "N/A";
    let url = "https://app.zicabella.com";
    
    const titleLine = lines.find(l => l.startsWith("*") && l.endsWith("*") && !l.includes("Check out"));
    if (titleLine) {
      title = titleLine.replace(/\*/g, "").trim();
    }
    
    const priceLine = lines.find(l => l.includes("Price:"));
    if (priceLine) {
      price = priceLine.replace("Price:", "").replace("INR", "").trim() + " INR";
    }

    const urlLine = lines.find(l => l.startsWith("http") || l.includes("shopify.com") || l.includes("zicabella"));
    if (urlLine) {
      url = urlLine.trim();
    }

    return (
      <div className="space-y-2.5 max-w-[280px] rounded-xl overflow-hidden bg-zinc-900 border border-white/10 p-1 flex flex-col">
        {m.mediaUrl ? (
          <div className="w-full h-36 bg-zinc-850 rounded-lg overflow-hidden relative">
            <img src={m.mediaUrl} alt={title} className="w-full h-full object-cover" />
            <div className="absolute top-2 right-2 bg-emerald-500/90 text-white text-[9px] font-bold px-2 py-0.5 rounded-full shadow-sm flex items-center gap-1">
              <ShoppingBag className="w-2.5 h-2.5" />
              <span>Catalog</span>
            </div>
          </div>
        ) : (
          <div className="w-full h-36 bg-zinc-800 rounded-lg flex items-center justify-center text-xs text-zinc-500">
            No product photo
          </div>
        )}
        
        <div className="px-2 py-0.5 space-y-1">
          <h4 className="font-bold text-[13px] text-zinc-100 truncate leading-snug">{title}</h4>
          <span className="text-[11px] font-mono text-emerald-400 font-bold block">{price}</span>
        </div>

        <a 
          href={url} 
          target="_blank" 
          rel="noopener noreferrer"
          className="w-full text-center py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1 mt-auto shadow-md"
        >
          <span>Shop Online</span>
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    );
  };

  // Render a template block inside message list
  const renderTemplateBubble = (m: Message, activeConv: Conversation) => {
    let templateName = m.templateName || null;
    let rawBodyText = m.body || "";

    if (m.body?.startsWith("[Template:")) {
      const match = m.body.match(/^\[Template:\s*([^\]]+)\](.*)$/s);
      if (match) {
        templateName = match[1].trim();
        rawBodyText = match[2].trim();
      }
    } else if (m.body?.startsWith("Template:")) {
      const parts = m.body.split("|");
      const namePart = parts[0].replace("Template:", "").trim();
      if (namePart) templateName = namePart;
      rawBodyText = parts.slice(1).join("|").trim() || m.body;
    }

    const matchedTemplate = templatesList.find(t => t.name === templateName);
    
    // Fallback variable replacement
    let resolvedText = rawBodyText || (matchedTemplate?.components?.find((c: any) => c.type === "BODY")?.text || "");
    const customerName = activeConv?.customerName || "Customer";
    
    resolvedText = resolvedText
      .replace(/\{\{1\}\}/g, customerName)
      .replace(/\{\{2\}\}/g, "app.zicabella.com")
      .replace(/\{\{3\}\}/g, "Zica Bella")
      .replace(/\{\{4\}\}/g, "10%");

    const headerComp = matchedTemplate?.components?.find((c: any) => c.type === "HEADER");
    const footerComp = matchedTemplate?.components?.find((c: any) => c.type === "FOOTER");
    const buttonsComp = matchedTemplate?.components?.find((c: any) => c.type === "BUTTONS")?.buttons || [];

    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1 text-[9px] text-violet-400 font-mono font-bold tracking-wider uppercase opacity-85 border-b border-white/5 pb-1 mb-1.5">
          <Sparkles className="w-3 h-3" />
          <span>Approved Meta Template: {templateName || "WABA"}</span>
        </div>

        {headerComp?.format === "IMAGE" && (
          <div className="w-full h-32 bg-zinc-900 rounded-lg overflow-hidden border border-white/5 mb-2 relative">
            <img 
              src={m.mediaUrl || "https://images.unsplash.com/photo-1556821840-3a63f95609a7?q=80&w=400"} 
              alt="Template Header Graphic" 
              className="w-full h-full object-cover" 
            />
          </div>
        )}

        {headerComp?.format === "TEXT" && (
          <strong className="text-[13px] block font-bold text-white border-b border-white/5 pb-1.5 mb-1">
            {headerComp.text}
          </strong>
        )}

        {/* Formatted body content */}
        {formatMessageText(resolvedText)}

        {footerComp?.text && (
          <p className="text-[10px] text-zinc-400 font-sans italic pt-1 border-t border-white/5 mt-1.5">
            {footerComp.text}
          </p>
        )}

        {buttonsComp.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-2.5 border-t border-white/5 mt-2.5">
            {buttonsComp.map((btn: any, idx: number) => {
              const hrefVal = btn.type === "URL" ? btn.url?.replace("{{1}}", "") : "#";
              return (
                <a
                  key={idx}
                  href={hrefVal}
                  target={btn.type === "URL" ? "_blank" : undefined}
                  rel="noopener noreferrer"
                  className="bg-[#202c33]/70 hover:bg-[#202c33] active:bg-[#202c33]/90 text-emerald-400 font-semibold text-center py-2 rounded-lg text-[11px] border border-white/10 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span>{btn.text}</span>
                  {btn.type === "URL" && <ExternalLink className="w-3 h-3 text-emerald-400" />}
                  {btn.type === "PHONE_NUMBER" && <Phone className="w-3 h-3 text-emerald-400" />}
                </a>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // Render main message bubble containing text, files, catalog or templates
  const renderMessageContent = (m: Message, idx: number) => {
    const isInbound = m.direction === "inbound";
    const rawUrl = m.mediaUrl || "";
    let mType = (m.mediaType || "").toLowerCase();

    // Deduce media URL if contained in body or rawUrl or waMessageId
    let mediaUrlToUse = rawUrl;
    if (!mediaUrlToUse && m.body) {
      if (m.body.startsWith("http") && (m.body.includes("/uploads/") || m.body.includes("supabase") || m.body.includes("facebook") || m.body.includes("whatsapp"))) {
        mediaUrlToUse = m.body.split(/\s+/)[0];
      } else if (m.body.startsWith("[Media:")) {
        const parts = m.body.split(" ");
        if (parts.length > 2 && parts[2].startsWith("http")) {
          mediaUrlToUse = parts[2];
        }
      }
    }

    if (mediaUrlToUse.includes("/uploads/whatsapp/")) {
      const filename = mediaUrlToUse.split("/uploads/whatsapp/").pop();
      if (filename) mediaUrlToUse = `/api/whatsapp/chat/media?file=${filename}`;
    }

    if (!mediaUrlToUse && m.waMessageId) {
      mediaUrlToUse = `/api/whatsapp/chat/media?mediaId=${m.waMessageId}`;
    }

    if (!mType && mediaUrlToUse) {
      if (/\.(jpeg|jpg|gif|png|webp)/i.test(mediaUrlToUse)) mType = "image";
      else if (/\.(mp4|mov|avi|webm|3gp)/i.test(mediaUrlToUse)) mType = "video";
      else if (/\.(mp3|ogg|wav|m4a|aac)/i.test(mediaUrlToUse)) mType = "audio";
      else if (/\.(pdf|doc|docx|txt|csv|xls|xlsx|zip)/i.test(mediaUrlToUse)) mType = "document";
    }

    if (!mType && m.body) {
      if (m.body.startsWith("[Media: image]")) mType = "image";
      else if (m.body.startsWith("[Media: video]")) mType = "video";
      else if (m.body.startsWith("[Media: audio]") || m.body.startsWith("[Media: voice]")) mType = "audio";
      else if (m.body.startsWith("[Media: document]") || m.body.startsWith("[File:")) mType = "document";
      else if (m.body.startsWith("[Media: sticker]")) mType = "sticker";
    }

    const isCatalog = m.body?.includes("Check out this product from Zica Bella!") || (m.body?.includes("Price:") && m.body?.includes("Shop online now:"));
    const isTemplate = !!m.templateName || (!!m.body && (m.body.startsWith("Template:") || m.body.startsWith("[Template:")));

    const showTail = isFirstInGroup(idx, m, messages);
    
    // Bubble shapes: round all corners unless it is the first message in consecutive stack
    const bubbleStyle = isInbound
      ? `bg-[#202c33] text-zinc-100 rounded-2xl border border-white/5 ${showTail ? "rounded-tl-none" : ""}`
      : `bg-[#005c4b] text-zinc-100 rounded-2xl ${showTail ? "rounded-tr-none" : ""}`;

    return (
      <div key={m.id} className={`flex ${isInbound ? "justify-start" : "justify-end"} mb-1`}>
        <div className="relative max-w-[70%]">
          {/* Left/Inbound tail */}
          {isInbound && showTail && (
            <div className="absolute top-0 -left-[8px] w-2.5 h-3 overflow-hidden">
              <svg viewBox="0 0 8 12" className="w-full h-full text-[#202c33] fill-current">
                <path d="M8,0 C5,0 0,0 0,0 L0,12 Z" />
              </svg>
            </div>
          )}

          {/* Right/Outbound tail */}
          {!isInbound && showTail && (
            <div className="absolute top-0 -right-[8px] w-2.5 h-3 overflow-hidden">
              <svg viewBox="0 0 8 12" className="w-full h-full text-[#005c4b] fill-current">
                <path d="M0,0 C3,0 8,0 8,0 L8,12 Z" />
              </svg>
            </div>
          )}

          <div className={`${bubbleStyle} px-4 py-2.5 shadow-sm text-[13px] space-y-1.5`}>
            {isCatalog ? (
              renderCatalogBubble(m)
            ) : isTemplate ? (
              renderTemplateBubble(m, activeConv!)
            ) : failedMediaIds[m.id] ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2.5 p-3 bg-zinc-900/90 border border-white/10 rounded-xl max-w-xs text-zinc-400">
                  <div className="p-2 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-lg shrink-0">
                    <AlertCircle className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-semibold text-zinc-300 block truncate">
                      Media no longer available
                    </span>
                    <span className="text-[10px] text-zinc-500 block truncate">
                      Expired or deleted from storage
                    </span>
                  </div>
                </div>
                {m.body && !m.body.startsWith("[Media:") && !m.body.startsWith("http") && (
                  formatMessageText(m.body)
                )}
              </div>
            ) : (mType === "image" || !mType) && mediaUrlToUse ? (
              <div className="space-y-2">
                <img 
                  src={mediaUrlToUse} 
                  alt="Chat Attachment" 
                  className="max-w-xs max-h-60 rounded-lg object-cover cursor-pointer hover:opacity-90 transition-opacity border border-white/10" 
                  onClick={() => window.open(mediaUrlToUse, "_blank")}
                  onError={(e) => {
                    const target = e.currentTarget;
                    if (m.waMessageId && !target.dataset.triedFallback) {
                      target.dataset.triedFallback = "true";
                      target.src = `/api/whatsapp/chat/media?mediaId=${m.waMessageId}`;
                    } else {
                      setFailedMediaIds(prev => ({ ...prev, [m.id]: true }));
                    }
                  }}
                />
                {m.body && !m.body.startsWith("[Media:") && !m.body.startsWith("http") && (
                  formatMessageText(m.body)
                )}
              </div>
            ) : mType === "video" && mediaUrlToUse ? (
              <div className="space-y-2">
                <video 
                  src={mediaUrlToUse} 
                  controls 
                  className="max-w-xs max-h-60 rounded-lg border border-white/10"
                  onError={(e) => {
                    const target = e.currentTarget;
                    if (m.waMessageId && !target.dataset.triedFallback) {
                      target.dataset.triedFallback = "true";
                      target.src = `/api/whatsapp/chat/media?mediaId=${m.waMessageId}`;
                    } else {
                      setFailedMediaIds(prev => ({ ...prev, [m.id]: true }));
                    }
                  }}
                />
                {m.body && !m.body.startsWith("[Media:") && !m.body.startsWith("http") && (
                  formatMessageText(m.body)
                )}
              </div>
            ) : (mType === "audio" || mType === "voice") && mediaUrlToUse ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 pt-1">
                  <Music className="w-4 h-4 text-emerald-400 shrink-0" />
                  <audio 
                    src={mediaUrlToUse} 
                    controls 
                    className="max-w-xs h-9 text-xs" 
                    onError={(e) => {
                      const target = e.currentTarget;
                      if (m.waMessageId && !target.dataset.triedFallback) {
                        target.dataset.triedFallback = "true";
                        target.src = `/api/whatsapp/chat/media?mediaId=${m.waMessageId}`;
                      } else {
                        setFailedMediaIds(prev => ({ ...prev, [m.id]: true }));
                      }
                    }}
                  />
                </div>
                {m.body && !m.body.startsWith("[Media:") && !m.body.startsWith("http") && (
                  formatMessageText(m.body)
                )}
              </div>
            ) : mType === "sticker" && mediaUrlToUse ? (
              <img 
                src={mediaUrlToUse} 
                alt="Sticker" 
                className="w-32 h-32 object-contain" 
                onError={(e) => {
                  const target = e.currentTarget;
                  if (m.waMessageId && !target.dataset.triedFallback) {
                    target.dataset.triedFallback = "true";
                    target.src = `/api/whatsapp/chat/media?mediaId=${m.waMessageId}`;
                  } else {
                    setFailedMediaIds(prev => ({ ...prev, [m.id]: true }));
                  }
                }}
              />
            ) : mType === "document" || mediaUrlToUse ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3 bg-zinc-900/80 border border-white/10 p-3 rounded-xl max-w-xs">
                  <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-semibold text-zinc-100 block truncate">
                      {m.body && !m.body.startsWith("[Media:") ? m.body : "Attachment Document"}
                    </span>
                    {mediaUrlToUse && (
                      <a 
                        href={mediaUrlToUse} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-[10px] text-emerald-400 hover:underline flex items-center gap-1 mt-1 font-bold"
                      >
                        <Download className="w-3 h-3" />
                        <span>Download / View File</span>
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              formatMessageText(m.body)
            )}
            
            {/* Timestamp & double ticks & delete action */}
            <div className="flex items-center justify-end gap-1.5 text-[9px] opacity-70 font-mono mt-1 select-none">
              <span>
                {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              {!isInbound && getStatusIcon(m.status)}
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/whatsapp/chat/media-manager?id=${m.id}`, { method: "DELETE" });
                    if (res.ok) {
                      setMessages(prev => prev.filter(item => item.id !== m.id));
                      toast.success("Message deleted");
                    }
                  } catch (e) {
                    toast.error("Failed to delete message");
                  }
                }}
                className="opacity-40 hover:opacity-100 p-0.5 text-zinc-400 hover:text-rose-400 transition-opacity ml-1"
                title="Delete Message"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Return list of conversations filtered by active tab search query
  const getFilteredConversations = () => {
    const query = searchQuery.toLowerCase();
    
    return conversations.filter(c => {
      const nameMatch = c.customerName?.toLowerCase().includes(query) || false;
      const phoneMatch = c.phoneNumber.includes(query);
      if (!nameMatch && !phoneMatch) return false;

      if (activeTab === "unread") {
        return c.unreadCount > 0;
      }
      if (activeTab === "care") {
        return calculateIsServiceWindowActive(c.lastInboundCreatedAt, c.lastMessage);
      }
      if (activeTab === "optout") {
        return c.whatsappOptedOut === true;
      }
      return true;
    });
  };

  const filteredConversations = getFilteredConversations();

  const filteredProducts = productsList.filter(p => 
    p.title.toLowerCase().includes(productSearch.toLowerCase())
  );

  // Generate dynamic initials-based user avatar with nice gradient background
  const renderAvatar = (name: string | null, phone: string, sizeClass = "w-10 h-10 text-xs") => {
    const text = name ? name.trim() : "";
    let initials = "C";
    if (text) {
      const parts = text.split(/\s+/);
      if (parts.length > 1) {
        initials = (parts[0][0] + parts[1][0]).toUpperCase();
      } else {
        initials = parts[0][0].toUpperCase();
      }
    } else if (phone) {
      initials = phone.slice(-2);
    }

    // Hash name to select a color gradient
    const gradients = [
      "from-teal-600 to-emerald-500",
      "from-blue-600 to-indigo-500",
      "from-purple-600 to-pink-500",
      "from-rose-600 to-orange-500",
      "from-cyan-600 to-sky-500"
    ];
    const index = (name || phone).split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % gradients.length;
    const grad = gradients[index];

    return (
      <div className={`${sizeClass} rounded-full bg-gradient-to-tr ${grad} text-white font-bold flex items-center justify-center shrink-0 shadow-inner select-none relative`}>
        {initials}
      </div>
    );
  };

  // Group messages by Date Dividers
  let lastRenderedDate = "";

  return (
    <div className="flex flex-col h-[calc(100vh-170px)] overflow-hidden space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">WhatsApp Live Chat Support</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage incoming inquiries, reply to customer threads, and send pre-approved template marketing campaigns.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button 
            onClick={handleToggleGlobalWhatsappAi}
            className={`px-4 py-2.5 rounded-xl border text-xs font-bold transition-all flex items-center gap-2 shadow-sm ${
              globalWhatsappAiEnabled
                ? "bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20"
                : "bg-foreground/5 border-foreground/10 text-zinc-400 hover:text-zinc-200"
            }`}
            title="Toggle shop-wide WhatsApp Zica AI Auto-Reply"
          >
            <Sparkles className={`w-4 h-4 ${globalWhatsappAiEnabled ? "text-purple-400 animate-pulse" : "text-zinc-500"}`} />
            <span>Zica AI Auto-Reply: {globalWhatsappAiEnabled ? "ENABLED (ON)" : "DISABLED (OFF)"}</span>
          </button>

          <button 
            onClick={() => setRefreshTrigger(p => p + 1)}
            className="p-2.5 bg-foreground/5 hover:bg-foreground/10 text-foreground border border-foreground/10 rounded-xl transition-all"
            title="Refresh Conversations"
          >
            <RefreshCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Panel grid container */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 flex-1 min-h-0 rounded-2xl overflow-hidden border border-white/10 bg-zinc-950/20 backdrop-blur-md">
        
        {/* Left Side: Conversations List */}
        <div className="lg:col-span-4 border-r border-white/10 flex flex-col h-full bg-zinc-900/40 overflow-hidden">
          {/* Search bar & Global AI Switch */}
          <div className="p-4 space-y-3 shrink-0 border-b border-white/5">
            <div className="flex items-center justify-between gap-2 pb-1">
              <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                <Sparkles className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
                <span>Zica AI Auto-Reply</span>
              </div>
              <button
                onClick={handleToggleGlobalWhatsappAi}
                className={`px-2.5 py-1 rounded-lg border text-[10px] font-bold transition-all flex items-center gap-1 ${
                  globalWhatsappAiEnabled
                    ? "bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20"
                    : "bg-white/5 border-white/10 text-zinc-400 hover:text-zinc-200"
                }`}
                title="Toggle shop-wide WhatsApp Zica AI Auto-Reply"
              >
                <span>Global: {globalWhatsappAiEnabled ? "ON" : "OFF"}</span>
              </button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-800/45 border border-white/5 rounded-xl pl-9 pr-4 py-2 outline-none focus:border-emerald-500/50 text-xs text-zinc-100"
              />
            </div>

            {/* Filter Tabs */}
            <div className="flex gap-1.5 overflow-x-auto shrink-0 pb-1 custom-scrollbar scrollbar-none">
              {[
                { id: "all", label: "All", icon: MessageSquare },
                { id: "unread", label: "Unread", icon: Mail },
                { id: "care", label: "Care Window", icon: Clock },
                { id: "optout", label: "Opted Out", icon: Ban }
              ].map(tab => {
                const Icon = tab.icon;
                const isSelected = activeTab === tab.id;
                
                // Count unread helper
                const unreadSum = tab.id === "unread" 
                  ? conversations.filter(c => c.unreadCount > 0).length 
                  : 0;

                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all whitespace-nowrap ${
                      isSelected 
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                        : "bg-transparent text-zinc-400 border-transparent hover:text-zinc-200 hover:bg-white/5"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{tab.label}</span>
                    {unreadSum > 0 && (
                      <span className="ml-1 bg-emerald-500 text-zinc-950 font-bold text-[9px] px-1 py-0.2 rounded-full leading-none">
                        {unreadSum}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* List items */}
          <div className="flex-1 overflow-y-auto divide-y divide-white/5 custom-scrollbar bg-zinc-900/10">
            {loadingConversations ? (
              <div className="p-8 text-center text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-500" />
                <span className="text-xs">Loading conversations...</span>
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-xs">
                No active conversations found.
              </div>
            ) : (
              filteredConversations.map(c => {
                const isActive = activePhone === c.phoneNumber;
                const isCareActive = calculateIsServiceWindowActive(c.lastInboundCreatedAt, c.lastMessage);
                
                return (
                  <button
                    key={c.phoneNumber}
                    onClick={() => setActivePhone(c.phoneNumber)}
                    className={`w-full p-4 text-left flex items-start justify-between gap-3 border-l-2 transition-all ${
                      isActive 
                        ? "bg-white/[0.06] border-emerald-500" 
                        : "hover:bg-white/[0.02] border-transparent"
                    }`}
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      {/* Avatar initials */}
                      <div className="relative shrink-0">
                        {renderAvatar(c.customerName, c.phoneNumber)}
                        {/* Care Window Status indicator dot */}
                        {isCareActive && (
                          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-zinc-950 rounded-full" title="Active Care Window" />
                        )}
                      </div>
                      
                      <div className="min-w-0">
                        <span className="font-semibold text-[13px] text-zinc-200 block truncate">
                          {c.customerName || `Guest (+${c.phoneNumber})`}
                        </span>
                        
                        <p className="text-[11px] text-zinc-400 truncate mt-0.5 font-sans leading-normal">
                          {c.lastMessage.direction === "outbound" && "You: "}
                          {c.lastMessage.body}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0 select-none">
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {new Date(c.lastMessage.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {c.unreadCount > 0 ? (
                        <span className="bg-emerald-500 text-zinc-950 font-extrabold text-[10px] px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                          {c.unreadCount}
                        </span>
                      ) : (
                        c.lastMessage.direction === "outbound" && getStatusIcon(c.lastMessage.status)
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Center Side: Chat Message Thread */}
        <div className={`${activePhone && showContactInfo ? "lg:col-span-5" : "lg:col-span-8"} flex flex-col h-full bg-zinc-900/10 overflow-hidden border-r border-white/5`}>
          {activePhone ? (
            <>
              {/* Thread Header */}
              <div className="p-4 border-b border-white/10 bg-zinc-900/40 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-3">
                  {renderAvatar(activeConv?.customerName || null, activePhone)}
                  <div>
                    <h3 className="font-bold text-[14px] text-zinc-200">
                      {activeConv?.customerName || `Guest (+${activePhone})`}
                    </h3>
                    <span className="text-xs text-zinc-400 font-mono">+{activePhone}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleToggleAiAutoReply}
                    className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold flex items-center gap-1.5 transition-all ${
                      aiAutoReply
                        ? "bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20"
                        : "bg-white/5 border-white/10 text-zinc-400 hover:text-zinc-200"
                    }`}
                    title={aiAutoReply ? "Turn OFF AI Auto-Reply for this chat" : "Turn ON AI Auto-Reply for this chat"}
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${aiAutoReply ? "text-purple-400 animate-pulse" : "text-zinc-500"}`} />
                    <span>Zica AI Auto-Reply: {aiAutoReply ? "ON" : "OFF"}</span>
                  </button>

                  <button
                    onClick={() => setShowContactInfo(prev => !prev)}
                    className={`p-2 rounded-lg border transition-all ${
                      showContactInfo 
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" 
                        : "bg-white/5 border-transparent text-zinc-400 hover:text-zinc-200"
                    }`}
                    title={showContactInfo ? "Hide Customer Details" : "Show Customer Details"}
                  >
                    {showContactInfo ? (
                      <PanelRightClose className="w-4 h-4" />
                    ) : (
                      <PanelRightOpen className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* 24h Customer Service Window Alert */}
              <div className={`px-4 py-2 border-b text-[11px] flex items-center justify-between gap-3 shrink-0 select-none ${
                isServiceWindowActive() 
                  ? "bg-emerald-500/5 border-emerald-500/10 text-emerald-400" 
                  : "bg-amber-500/5 border-amber-500/10 text-amber-400"
              }`}>
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5" />
                  <span>
                    {isServiceWindowActive() 
                      ? `24-Hour Care Window: Active (Replying free-text supported. ${serviceWindowHoursRemaining()} hours left)` 
                      : "24-Hour Care Window: Expired (Replying requires pre-approved Meta Template campaign dispatch)"}
                  </span>
                </div>
                {!isServiceWindowActive() && (
                  <button 
                    onClick={handleOpenTemplates}
                    className="underline text-[10px] font-bold hover:text-amber-300 flex items-center gap-1 shrink-0 transition-colors"
                  >
                    <span>Use Template</span>
                    <Sparkles className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>

              {/* Chat Thread Messages */}
              <div 
                ref={messagesContainerRef}
                onScroll={() => {
                  const el = messagesContainerRef.current;
                  if (!el) return;
                  isNearBottomRef.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 120;
                }}
                className="flex-1 overflow-y-auto p-6 space-y-2.5 custom-scrollbar"
                style={{
                  backgroundColor: "#0b141a",
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cg fill='%2322313b' fill-opacity='0.15'%3E%3Cpath d='M14 16h4v4h-4zm0 24h4v4h-4zm24-12h4v4h-4zm24 12h4v4h-4zM14 64h4v4h-4zm24 0h4v4h-4zm24 0h4v4h-4zM62 16h4v4h-4zm36 0h4v4h-4zm36 0h4v4h-4zM14 96h4v4h-4zm24 0h4v4h-4zm24 0h4v4h-4zm24 0h4v4h-4zm24 0h4v4h-4zM14 128h4v4h-4zm24-12h4v4h-4zm24 12h4v4h-4zm24-12h4v4h-4zm24 12h4v4h-4z'/%3E%3C/g%3E%3C/svg%3E")`,
                  backgroundRepeat: "repeat"
                }}
              >
                {loadingMessages ? (
                  <div className="h-full flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-center text-muted-foreground text-xs p-8 bg-zinc-950/30 rounded-xl">
                    No conversation history found. Start chat by sending a WhatsApp message.
                  </div>
                ) : (() => {
                  lastRenderedDate = ""; // Reset
                  return messages.map((m, idx) => {
                    const msgDate = new Date(m.createdAt).toDateString();
                    let showDateDivider = false;
                    if (msgDate !== lastRenderedDate) {
                      showDateDivider = true;
                      lastRenderedDate = msgDate;
                    }
                    
                    const getDividerText = (dateStr: string) => {
                      const today = new Date().toDateString();
                      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString();
                      if (dateStr === today) return "Today";
                      if (dateStr === yesterday) return "Yesterday";
                      return new Date(dateStr).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "long",
                        year: "numeric"
                      });
                    };

                    return (
                      <React.Fragment key={m.id}>
                        {showDateDivider && (
                          <div className="flex justify-center my-4 select-none">
                            <span className="bg-[#182229] border border-white/5 text-zinc-400 text-[10px] px-3 py-1 rounded-lg uppercase tracking-wider font-semibold shadow-sm font-sans">
                              {getDividerText(msgDate)}
                            </span>
                          </div>
                        )}
                        {renderMessageContent(m, idx)}
                      </React.Fragment>
                    );
                  });
                })()}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Footer */}
              <div className="p-4 border-t border-white/10 bg-zinc-900/40 shrink-0 flex flex-col gap-2">
                {/* Media Attachment Preview (if any) */}
                {mediaUrl && (
                  <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/20 p-2 rounded-xl text-xs gap-3 animate-pulse">
                    <div className="flex items-center gap-2 truncate">
                      <img src={mediaUrl} alt="Preview thumb" className="w-10 h-10 object-cover rounded-lg border border-white/10 shrink-0" />
                      <span className="text-[10px] text-emerald-400 font-mono truncate">{mediaUrl}</span>
                    </div>
                    <button 
                      onClick={() => setMediaUrl("")} 
                      className="p-1.5 text-rose-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-all"
                      title="Remove attachment"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <form onSubmit={handleSendMessage} className="space-y-3">
                  <div className="flex items-center gap-2">
                    {/* Catalog dispatch selector */}
                    <button
                      type="button"
                      onClick={handleOpenCatalog}
                      className="p-2.5 rounded-xl border bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200 transition-all shrink-0"
                      title="Send Shopify Product Showcase"
                    >
                      <ShoppingBag className="w-4 h-4 text-emerald-400" />
                    </button>

                    {/* Meta Templates Selector */}
                    <button
                      type="button"
                      onClick={handleOpenTemplates}
                      className="p-2.5 rounded-xl border bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200 transition-all shrink-0"
                      title="Send Meta Templates Campaign"
                    >
                      <Sparkles className="w-4 h-4 text-violet-400" />
                    </button>

                    {/* Image Attachment File Trigger */}
                    <button
                      type="button"
                      onClick={() => setShowMediaInput(p => !p)}
                      className={`p-2.5 rounded-xl border transition-all shrink-0 ${
                        showMediaInput 
                          ? "bg-emerald-500/20 border-emerald-500/20 text-emerald-400" 
                          : "bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                      }`}
                      title="Attach Image File or Link"
                    >
                      <Image className="w-4 h-4" />
                    </button>

                    <input 
                      type="file" 
                      ref={fileInputRef} 
                      onChange={handleImageUpload} 
                      accept="image/*" 
                      className="hidden" 
                    />
                    
                    <input
                      type="text"
                      placeholder={
                        activeConv?.whatsappOptedOut 
                          ? "Customer has opted out of WhatsApp updates." 
                          : isServiceWindowActive() 
                          ? "Type message..." 
                          : "Care window expired. Use meta templates."
                      }
                      disabled={sending || activeConv?.whatsappOptedOut === true}
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      className="flex-1 bg-zinc-800/45 border border-white/5 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500/50 text-xs text-zinc-100 placeholder-zinc-500 disabled:opacity-45"
                    />

                    <button
                      type="submit"
                      disabled={sending || (!messageText.trim() && !mediaUrl.trim()) || activeConv?.whatsappOptedOut === true}
                      className="bg-emerald-500 text-zinc-950 p-2.5 rounded-xl hover:bg-emerald-600 transition-all disabled:opacity-50 shrink-0 shadow-md font-bold"
                    >
                      {sending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                    </button>
                  </div>

                  {showMediaInput && (
                    <motion.div 
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex flex-col sm:flex-row gap-2 bg-white/[0.01] border border-white/10 p-3 rounded-xl"
                    >
                      <input
                        type="url"
                        placeholder="Paste image link URL here (publicly accessible)..."
                        value={mediaUrl}
                        onChange={(e) => setMediaUrl(e.target.value)}
                        className="flex-1 bg-zinc-850 border border-white/5 rounded-xl px-4 py-1.5 outline-none focus:border-emerald-500/50 text-xs text-zinc-200"
                      />
                      <div className="flex items-center gap-2 justify-end">
                        <span className="text-[10px] text-zinc-500 font-mono uppercase">or</span>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploading}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-850 hover:bg-zinc-800 rounded-lg text-xs font-semibold text-zinc-300 border border-white/5 transition-colors"
                        >
                          {uploading ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <UploadCloud className="w-3.5 h-3.5 text-emerald-400" />
                          )}
                          <span>Upload File</span>
                        </button>
                      </div>
                    </motion.div>
                  )}
                </form>
              </div>
            </>
          ) : (
            <div className="h-full flex flex-col justify-center items-center text-center p-8 text-muted-foreground bg-zinc-950/20">
              <MessageSquare className="w-12 h-12 text-zinc-800 mb-3 animate-bounce" />
              <h3 className="font-semibold text-zinc-300 mb-1 text-sm">No Thread Selected</h3>
              <p className="text-xs max-w-xs text-zinc-500">
                Choose a customer conversation thread from the left menu to view communication history and reply in real-time.
              </p>
            </div>
          )}
        </div>

        {/* Right Side: Collapsible Customer Contact Info Drawer */}
        {activePhone && showContactInfo && (
          <div className="lg:col-span-3 flex flex-col h-full bg-zinc-900/65 overflow-y-auto border-l border-white/5 divide-y divide-white/5 custom-scrollbar">
            {/* Drawer Header */}
            <div className="p-4 flex items-center justify-between bg-zinc-900/40">
              <h3 className="font-bold text-xs uppercase tracking-wider text-zinc-400">Contact Details</h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setIsEditingContact(p => !p)}
                  className={`p-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1 transition-all ${
                    isEditingContact 
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                      : "bg-white/5 border-transparent text-zinc-400 hover:text-zinc-200"
                  }`}
                  title="Edit Customer Profile"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span className="text-[10px]">{isEditingContact ? "Cancel" : "Edit"}</span>
                </button>
                <button 
                  onClick={() => setShowContactInfo(false)}
                  className="p-1 hover:bg-white/5 rounded-lg text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Profile Hero card or Edit Contact form */}
            {isEditingContact ? (
              <div className="p-4 space-y-3 bg-zinc-900/80">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-400 uppercase tracking-widest font-mono font-bold">Edit Customer Contact</span>
                  {!activeConv?.customerId && (
                    <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-mono font-bold">New Contact</span>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-zinc-400 font-mono">Full Name</label>
                  <input
                    type="text"
                    value={editCustomerName}
                    onChange={e => setEditCustomerName(e.target.value)}
                    placeholder="Enter customer name..."
                    className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500/50"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-zinc-400 font-mono">Email Address</label>
                  <input
                    type="email"
                    value={editCustomerEmail}
                    onChange={e => setEditCustomerEmail(e.target.value)}
                    placeholder="Enter email address..."
                    className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500/50"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] text-zinc-400 font-mono">Phone Number</label>
                  <input
                    type="text"
                    value={editCustomerPhone}
                    onChange={e => setEditCustomerPhone(e.target.value)}
                    placeholder="Enter phone number..."
                    className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-emerald-500/50"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => setIsEditingContact(false)}
                    className="flex-1 py-1.5 bg-zinc-800 hover:bg-zinc-750 text-zinc-400 font-semibold rounded-lg text-xs transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveContact}
                    disabled={savingContact}
                    className="flex-1 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-bold rounded-lg text-xs flex items-center justify-center gap-1 transition-colors shadow-md disabled:opacity-50"
                  >
                    {savingContact ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    <span>Save Contact</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-6 flex flex-col items-center text-center space-y-3">
                {renderAvatar(activeConv?.customerName || null, activePhone, "w-20 h-20 text-xl font-extrabold")}
                <div>
                  <h4 className="font-bold text-[14px] text-zinc-100 flex items-center justify-center gap-1">
                    <span>{activeConv?.customerName || "Guest"}</span>
                    {activeConv?.whatsappOptedOut && (
                      <span title="Consent Opted Out"><Ban className="w-3.5 h-3.5 text-rose-500" /></span>
                    )}
                  </h4>
                  <p className="text-xs text-zinc-400 mt-0.5">+{activePhone}</p>
                </div>
              </div>
            )}

            {/* Consent status section */}
            <div className="p-4 space-y-2.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-mono font-bold block">WhatsApp Consent</span>
              {activeConv?.whatsappOptedOut ? (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/25 flex flex-col gap-2">
                  <div className="flex gap-2 text-rose-400 text-xs">
                    <Ban className="w-4 h-4 shrink-0 mt-0.5" />
                    <p className="leading-snug font-sans">Customer has **Opted Out** of WhatsApp communication. Templates & automated schedules are blocked.</p>
                  </div>
                  <button
                    onClick={handleToggleOptOut}
                    className="w-full text-center py-1.5 bg-zinc-800 hover:bg-zinc-750 text-emerald-400 font-bold rounded-lg text-[10px] border border-white/5 transition-colors"
                  >
                    Register Manual Opt-In
                  </button>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex flex-col gap-2">
                  <div className="flex gap-2 text-emerald-400 text-xs">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    <p className="leading-snug font-sans">Customer is **Opted In** to WhatsApp updates and promotional dispatches.</p>
                  </div>
                  <button
                    onClick={handleToggleOptOut}
                    className="w-full text-center py-1.5 bg-zinc-800 hover:bg-zinc-750 text-rose-400 font-bold rounded-lg text-[10px] border border-white/5 transition-colors"
                  >
                    Opt-Out Customer
                  </button>
                </div>
              )}
            </div>

            {/* Quick stats / info */}
            <div className="p-4 space-y-3.5">
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-mono font-bold block">Meta & CRM Details</span>
              
              <div className="space-y-2 text-xs">
                {activeConv?.customerEmail && (
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-800/40 border border-white/5 gap-2">
                    <div className="flex items-center gap-2 truncate text-zinc-300">
                      <Mail className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                      <span className="truncate">{activeConv.customerEmail}</span>
                    </div>
                    <button 
                      onClick={() => handleCopyToClipboard(activeConv.customerEmail!, "Email")}
                      className="p-1 hover:bg-white/5 rounded text-zinc-400 hover:text-zinc-200"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                )}

                <div className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-800/40 border border-white/5 gap-2">
                  <div className="flex items-center gap-2 text-zinc-300">
                    <Phone className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                    <span>+{activePhone}</span>
                  </div>
                  <button 
                    onClick={() => handleCopyToClipboard(activePhone, "Phone Number")}
                    className="p-1 hover:bg-white/5 rounded text-zinc-400 hover:text-zinc-200"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>

                {/* 24 Care Window details */}
                <div className="p-2.5 rounded-lg bg-zinc-800/40 border border-white/5 flex items-start gap-2">
                  <Clock className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-zinc-500 font-mono font-bold block">Care Care Window</span>
                    <span className={`text-[11px] font-semibold block ${isServiceWindowActive() ? "text-emerald-400" : "text-amber-500"}`}>
                      {isServiceWindowActive() ? "Open & Active" : "Expired"}
                    </span>
                    <span className="text-[10px] text-zinc-400 block font-sans">
                      {isServiceWindowActive() 
                        ? `${serviceWindowHoursRemaining()} hours left to reply for free.`
                        : "Requires Meta template messages to restart conversation."
                      }
                    </span>
                  </div>
                </div>

                {/* Activity Stats */}
                <div className="p-2.5 rounded-lg bg-zinc-800/40 border border-white/5 flex items-start gap-2">
                  <Calendar className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <span className="text-[10px] text-zinc-500 font-mono font-bold block">Session Log History</span>
                    <span className="text-[11px] text-zinc-300 font-semibold block">{messages.length} messages loaded</span>
                    {activeConv?.lastInboundCreatedAt && (
                      <span className="text-[10px] text-zinc-400 block font-sans">
                        Last Inbound: {new Date(activeConv.lastInboundCreatedAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Order Activity */}
                {((activeConv?.ordersCount || 0) > 0 || (activeConv?.totalSpent || 0) > 0) && (
                  <div className="p-2.5 rounded-lg bg-zinc-800/40 border border-white/5 flex items-start gap-2">
                    <ShoppingBag className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <span className="text-[10px] text-zinc-500 font-mono font-bold block">Order Activity</span>
                      <span className="text-[11px] text-zinc-200 font-semibold block">
                        {activeConv?.ordersCount || 0} Order{(activeConv?.ordersCount || 0) !== 1 ? 's' : ''} placed
                      </span>
                      <span className="text-[10px] text-emerald-400 block font-mono font-bold">
                        ₹{(activeConv?.totalSpent || 0).toLocaleString('en-IN')} Total Spent
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Links / CRM integration */}
            {activeConv?.customerId && (
              <div className="p-4 space-y-2">
                <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-mono font-bold block">CRM Integrations</span>
                <a 
                  href={`/dashboard/customers/${activeConv.customerId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2 bg-emerald-500 hover:bg-emerald-600 text-zinc-950 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1 text-center shadow-md cursor-pointer"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>Open CRM Customer Profile</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>
        )}

      </div>

      {/* ──────────────── MODALS ──────────────── */}
      
      {/* 1. Meta Template Select Modal */}
      <AnimatePresence>
        {showTemplateModal && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }} 
              className="bg-[#182229] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden max-h-[85vh]"
            >
              <div className="flex justify-between items-center p-4 border-b border-white/10 bg-white/[0.02]">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-violet-400" />
                  <h3 className="font-bold text-sm text-zinc-200">Send WhatsApp Template Campaign</h3>
                </div>
                <button onClick={() => { setShowTemplateModal(false); setSelectedTemplate(null); }} className="p-1 hover:bg-white/5 rounded-lg text-zinc-400 hover:text-zinc-200"><X className="w-4 h-4" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {selectedTemplate ? (
                  // Configure Variables View
                  <div className="space-y-4">
                    <button 
                      onClick={() => setSelectedTemplate(null)}
                      className="text-xs text-emerald-400 hover:underline flex items-center gap-1 font-semibold"
                    >
                      ← Back to templates catalog
                    </button>

                    <div className="p-3 bg-zinc-900 border border-white/5 rounded-xl space-y-2">
                      <div className="flex justify-between text-[10px] text-zinc-400">
                        <span className="font-bold font-mono">TEMPLATE: {selectedTemplate.name}</span>
                        <span className="bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full font-mono uppercase font-bold text-[9px]">{selectedTemplate.category}</span>
                      </div>
                      <div className="bg-[#202c33]/70 p-3 rounded-lg text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed border border-white/5">
                        {selectedTemplate.components?.find((c: any) => c.type === "BODY")?.text}
                      </div>
                    </div>

                    {templateVariables.length > 0 ? (
                      <div className="space-y-3">
                        <span className="text-[11px] font-bold text-zinc-300 block">Configure Template Variables</span>
                        {templateVariables.map((val, idx) => (
                          <div key={idx} className="space-y-1">
                            <label className="text-[10px] font-mono text-zinc-400 uppercase font-semibold">Variable {idx + 1}</label>
                            <input
                              type="text"
                              value={val}
                              onChange={(e) => {
                                const copy = [...templateVariables];
                                copy[idx] = e.target.value;
                                setTemplateVariables(copy);
                              }}
                              className="w-full bg-zinc-900 border border-white/5 rounded-xl px-3 py-2 outline-none text-xs text-zinc-100 focus:border-emerald-500/50"
                              placeholder={`Enter value for {{${idx + 1}}}`}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 p-3 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl text-xs">
                        <Info className="w-4 h-4" />
                        <span>No parameters required. Template will be sent exactly as approved.</span>
                      </div>
                    )}
                  </div>
                ) : (
                  // Templates Search / Grid View
                  <div className="space-y-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                      <input
                        type="text"
                        placeholder="Search Meta templates library..."
                        onChange={(e) => {
                          const query = e.target.value.toLowerCase();
                          // Filter templatesList state inline via local component filtering
                        }}
                        className="w-full bg-zinc-900 border border-white/5 rounded-xl pl-9 pr-4 py-2 outline-none focus:border-emerald-500/50 text-xs text-zinc-100"
                      />
                    </div>

                    {loadingTemplates ? (
                      <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin text-emerald-500 mx-auto" /></div>
                    ) : templatesList.length === 0 ? (
                      <div className="p-8 text-center text-xs text-zinc-500">No approved templates found in database. Sync with Meta first.</div>
                    ) : (
                      <div className="space-y-2 max-h-[40vh] overflow-y-auto custom-scrollbar">
                        {templatesList.map((t: any) => (
                          <button
                            key={t.name}
                            onClick={() => handleSelectTemplate(t)}
                            className="w-full text-left p-3 border border-white/5 hover:border-emerald-500/20 hover:bg-white/[0.02] rounded-xl transition-all flex justify-between items-center gap-3 group"
                          >
                            <div className="min-w-0">
                              <span className="font-semibold text-xs text-zinc-200 block truncate group-hover:text-emerald-400">{t.name}</span>
                              <p className="text-[10px] text-zinc-400 truncate mt-0.5">
                                {t.components?.find((c: any) => c.type === "BODY")?.text}
                              </p>
                            </div>
                            <ChevronRight className="w-4 h-4 text-zinc-500 shrink-0 group-hover:text-emerald-400" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {selectedTemplate && (
                <div className="p-4 border-t border-white/10 bg-white/[0.01] flex justify-end gap-2 shrink-0">
                  <button 
                    onClick={() => setSelectedTemplate(null)} 
                    className="px-4 py-2 hover:bg-white/5 border border-transparent rounded-xl text-xs font-semibold text-zinc-400"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleSendTemplate}
                    disabled={sending}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-zinc-950 font-bold rounded-xl text-xs flex items-center gap-2"
                  >
                    {sending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Send Template</span>
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 2. Catalog / Products Selector Modal */}
      <AnimatePresence>
        {showCatalogModal && (
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }} 
              animate={{ opacity: 1, scale: 1 }} 
              exit={{ opacity: 0, scale: 0.95 }} 
              className="bg-[#182229] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden max-h-[85vh]"
            >
              <div className="flex justify-between items-center p-4 border-b border-white/10 bg-white/[0.02]">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-emerald-500" />
                  <h3 className="font-bold text-sm text-zinc-200">Send Shopify Catalog Product Card</h3>
                </div>
                <button onClick={() => setShowCatalogModal(false)} className="p-1 hover:bg-white/5 rounded-lg text-zinc-400 hover:text-zinc-200"><X className="w-4 h-4" /></button>
              </div>

              {/* Search bar */}
              <div className="p-4 border-b border-white/10 shrink-0">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    type="text"
                    placeholder="Search Shopify inventory catalog..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="w-full bg-zinc-900 border border-white/5 rounded-xl pl-9 pr-4 py-2 outline-none focus:border-emerald-500/50 text-xs text-zinc-100"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {loadingProducts ? (
                  <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin text-emerald-500 mx-auto" /></div>
                ) : filteredProducts.length === 0 ? (
                  <div className="p-8 text-center text-xs text-zinc-500">No products found.</div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 max-h-[45vh] overflow-y-auto custom-scrollbar">
                    {filteredProducts.map((p: any) => {
                      const firstImg = p.image?.src || (p.images?.[0]?.src) || null;
                      const price = p.variants?.[0]?.price || "N/A";
                      return (
                        <div
                          key={p.id}
                          onClick={() => handleSendProduct(p)}
                          className="border border-white/5 hover:border-emerald-500/25 hover:bg-white/[0.02] p-3 rounded-xl cursor-pointer transition-all flex flex-col justify-between gap-3 text-left group"
                        >
                          <div className="space-y-2">
                            {firstImg ? (
                              <img src={firstImg} alt={p.title} className="w-full h-24 object-cover rounded-lg border border-white/10 group-hover:scale-[1.02] transition-transform duration-300" />
                            ) : (
                              <div className="w-full h-24 bg-zinc-800 rounded-lg flex items-center justify-center text-[10px] text-zinc-500 border border-white/5">No Photo</div>
                            )}
                            <span className="font-semibold text-xs text-zinc-200 block truncate leading-tight mt-1 group-hover:text-emerald-400">{p.title}</span>
                          </div>
                          <div className="flex justify-between items-center mt-1 pt-1 border-t border-white/5">
                            <span className="text-[10px] font-mono text-emerald-400 font-bold">{price} INR</span>
                            <span className="text-[9px] text-emerald-400 font-semibold group-hover:underline">Send →</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
}
