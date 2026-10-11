// ──────────────────────────────────────────────────
// Zoho Mail Service — Email notifications via
// Zoho Mail REST API (OAuth 2.0)
// ──────────────────────────────────────────────────

const ZOHO_ACCOUNTS_URL = "https://accounts.zoho.in/oauth/v2/token";

// ─── Types ───────────────────────────────────────

export interface ZohoEmailPayload {
  fromAddress: string;
  toAddress: string;
  ccAddress?: string;
  subject: string;
  content: string;
  mailFormat?: "html" | "plaintext";
}

export interface EmailNotification {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  body: string;
  isHtml?: boolean;
}

// ─── Config ──────────────────────────────────────

function getZohoConfig() {
  return {
    clientId: process.env.ZOHO_MAIL_CLIENT_ID || "",
    clientSecret: process.env.ZOHO_MAIL_CLIENT_SECRET || "",
    refreshToken: process.env.ZOHO_MAIL_REFRESH_TOKEN || "",
    accountId: process.env.ZOHO_MAIL_ACCOUNT_ID || "",
    fromAddress: process.env.ZOHO_MAIL_FROM_ADDRESS || "admin@zicabella.com",
    adminEmails: (process.env.ZOHO_ADMIN_EMAILS || "admin@zicabella.com").split(",").map((e) => e.trim()),
    // Zoho API base — use .in for India, .com for US, .eu for EU
    apiBase: process.env.ZOHO_MAIL_API_BASE || "https://mail.zoho.in",
    authBase: process.env.ZOHO_MAIL_AUTH_BASE || "https://accounts.zoho.in",
  };
}

// ─── Token Cache (in-memory, refreshes on expiry) ─

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const config = getZohoConfig();

  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const params = new URLSearchParams({
    refresh_token: config.refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });

  const res = await fetch(`${config.authBase}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Zoho OAuth token refresh failed: ${res.status} — ${errorText}`);
  }

  const data = await res.json();

  if (!data.access_token) {
    throw new Error(`Zoho OAuth: No access_token in response — ${JSON.stringify(data)}`);
  }

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };

  return cachedToken.token;
}

// ─── Send Email via Zoho Mail API ────────────────

export async function sendZohoEmail(payload: ZohoEmailPayload): Promise<{ success: boolean; message: string; messageId?: string }> {
  const config = getZohoConfig();

  // Validate config
  if (!config.clientId || !config.refreshToken || !config.accountId) {
    console.warn("[ZohoMail] Missing configuration — email not sent:", payload.subject);
    return {
      success: false,
      message: "Zoho Mail not configured. Set ZOHO_MAIL_CLIENT_ID, ZOHO_MAIL_CLIENT_SECRET, ZOHO_MAIL_REFRESH_TOKEN, and ZOHO_MAIL_ACCOUNT_ID in .env.local.",
    };
  }

  try {
    const accessToken = await getAccessToken();

    const res = await fetch(`${config.apiBase}/api/accounts/${config.accountId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fromAddress: payload.fromAddress || config.fromAddress,
        toAddress: payload.toAddress,
        ccAddress: payload.ccAddress || "",
        subject: payload.subject,
        content: payload.content,
        mailFormat: payload.mailFormat || "html",
      }),
    });

    const result = await res.json();

    if (!res.ok || result.status?.code !== 200) {
      const { shouldLogThrottled } = await import('@/lib/log-throttle');
      const desc = result.status?.description || JSON.stringify(result).slice(0, 120);
      if (shouldLogThrottled(`zoho:send:${desc.slice(0, 40)}`, 120_000)) {
        console.warn("[ZohoMail] Send error:", desc);
      }
      return { success: false, message: `Zoho API error: ${result.status?.description || JSON.stringify(result)}` };
    }

    return {
      success: true,
      message: `Email sent to ${payload.toAddress}`,
      messageId: result.data?.messageId,
    };
  } catch (error: any) {
    const { shouldLogThrottled } = await import('@/lib/log-throttle');
    if (shouldLogThrottled('zoho:send:exception', 120_000)) {
      console.warn("[ZohoMail] Error:", error?.message || error);
    }
    return { success: false, message: error.message || "Failed to send email" };
  }
}

// ─── Convenience: send to admin team ─────────────

export async function sendAdminEmail(notification: EmailNotification) {
  const config = getZohoConfig();

  const toAddresses = Array.isArray(notification.to) ? notification.to : [notification.to];
  const ccAddresses = notification.cc
    ? (Array.isArray(notification.cc) ? notification.cc : [notification.cc])
    : [];

  return sendZohoEmail({
    fromAddress: config.fromAddress,
    toAddress: toAddresses.join(","),
    ccAddress: ccAddresses.join(","),
    subject: notification.subject,
    content: notification.isHtml !== false ? notification.body : `<pre style="font-family:sans-serif;">${notification.body}</pre>`,
    mailFormat: "html",
  });
}

// ─── Notify all admin users ──────────────────────

export async function notifyAdminTeam(subject: string, htmlBody: string) {
  const config = getZohoConfig();
  return sendAdminEmail({
    to: config.adminEmails,
    subject,
    body: htmlBody,
    isHtml: true,
  });
}

// ═══════════════════════════════════════════════════
// EMAIL TEMPLATES — Zica Bella branded HTML
// ═══════════════════════════════════════════════════

function wrapTemplate(title: string, content: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px;">
    <!-- Header -->
    <div style="text-align:center;padding:24px 0;border-bottom:1px solid rgba(255,255,255,0.06);">
      <h1 style="margin:0;font-size:14px;letter-spacing:8px;color:#fff;font-weight:700;">ZICA BELLA</h1>
      <p style="margin:6px 0 0;font-size:9px;letter-spacing:4px;color:rgba(255,255,255,0.25);font-weight:700;text-transform:uppercase;">Operations Intelligence</p>
    </div>
    <!-- Title -->
    <div style="padding:28px 0 20px;">
      <h2 style="margin:0;font-size:18px;font-weight:700;color:#fff;letter-spacing:-0.3px;">${title}</h2>
      <p style="margin:6px 0 0;font-size:10px;color:rgba(255,255,255,0.25);letter-spacing:2px;font-weight:700;text-transform:uppercase;">
        ${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST
      </p>
    </div>
    <!-- Content -->
    <div style="padding:20px 0;color:rgba(255,255,255,0.75);font-size:14px;line-height:1.7;">
      ${content}
    </div>
    <!-- Footer -->
    <div style="padding:24px 0;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
      <p style="margin:0;font-size:9px;color:rgba(255,255,255,0.15);letter-spacing:3px;font-weight:700;text-transform:uppercase;">
        Powered by Zica AI · Claude Sonnet 4
      </p>
      <p style="margin:8px 0 0;font-size:10px;color:rgba(255,255,255,0.1);">
        <a href="https://app.zicabella.com/dashboard" style="color:rgba(138,110,255,0.5);text-decoration:none;">Open Dashboard →</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Template: Task Created / Assigned ───────────

export function emailTaskCreated(task: {
  title: string;
  priority: string;
  dueDate?: string;
  description?: string;
  batchCode?: string;
  createdBy: string;
}): { subject: string; html: string } {
  const priorityColors: Record<string, string> = {
    HIGH: "#ff3b30",
    MEDIUM: "#ff9500",
    LOW: "#34c759",
  };
  const color = priorityColors[task.priority] || "#8a6eff";

  const content = `
    <div style="background:rgba(255,255,255,0.03);border-radius:12px;padding:20px;border:1px solid rgba(255,255,255,0.06);margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};"></span>
        <span style="font-size:10px;font-weight:700;letter-spacing:2px;color:${color};text-transform:uppercase;">${task.priority} Priority</span>
      </div>
      <h3 style="margin:0 0 8px;font-size:16px;font-weight:700;color:#fff;">${task.title}</h3>
      ${task.description ? `<p style="margin:0 0 12px;font-size:13px;color:rgba(255,255,255,0.5);">${task.description}</p>` : ""}
      <div style="font-size:11px;color:rgba(255,255,255,0.3);">
        ${task.dueDate ? `<p style="margin:4px 0;">📅 Due: <strong style="color:rgba(255,255,255,0.6);">${new Date(task.dueDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</strong></p>` : ""}
        ${task.batchCode ? `<p style="margin:4px 0;">🏭 Batch: <strong style="color:rgba(255,255,255,0.6);">${task.batchCode}</strong></p>` : ""}
        <p style="margin:4px 0;">👤 Created by: <strong style="color:rgba(138,110,255,0.7);">${task.createdBy}</strong></p>
      </div>
    </div>
    <a href="https://app.zicabella.com/dashboard/manufacturing/tasks" style="display:inline-block;padding:12px 24px;background:#fff;color:#000;border-radius:8px;font-size:11px;font-weight:700;text-decoration:none;letter-spacing:1px;text-transform:uppercase;">View Tasks →</a>
  `;

  return {
    subject: `[${task.priority}] New Task: ${task.title}`,
    html: wrapTemplate("New Task Assigned", content),
  };
}

// ─── Template: Task Status Updated ───────────────

export function emailTaskUpdated(task: {
  title: string;
  status: string;
  updatedBy: string;
}): { subject: string; html: string } {
  const statusEmoji: Record<string, string> = { COMPLETED: "✅", CANCELLED: "❌", PENDING: "⏳" };
  const emoji = statusEmoji[task.status] || "📝";

  const content = `
    <div style="background:rgba(255,255,255,0.03);border-radius:12px;padding:20px;border:1px solid rgba(255,255,255,0.06);margin-bottom:16px;">
      <p style="margin:0 0 8px;font-size:28px;">${emoji}</p>
      <h3 style="margin:0 0 8px;font-size:16px;font-weight:700;color:#fff;">${task.title}</h3>
      <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.5);">
        Status changed to <strong style="color:#fff;">${task.status}</strong> by <strong style="color:rgba(138,110,255,0.7);">${task.updatedBy}</strong>
      </p>
    </div>
    <a href="https://app.zicabella.com/dashboard/manufacturing/tasks" style="display:inline-block;padding:12px 24px;background:#fff;color:#000;border-radius:8px;font-size:11px;font-weight:700;text-decoration:none;letter-spacing:1px;text-transform:uppercase;">View Tasks →</a>
  `;

  return {
    subject: `${emoji} Task ${task.status}: ${task.title}`,
    html: wrapTemplate("Task Updated", content),
  };
}

// ─── Template: Production Stage Advanced ─────────

export function emailProductionUpdate(batch: {
  batchCode: string;
  productName: string;
  previousStage: string;
  newStage: string;
  action: string;
  quantity?: number;
}): { subject: string; html: string } {
  const content = `
    <div style="background:rgba(255,255,255,0.03);border-radius:12px;padding:20px;border:1px solid rgba(255,255,255,0.06);margin-bottom:16px;">
      <div style="margin-bottom:12px;">
        <span style="font-size:10px;font-weight:700;letter-spacing:2px;color:rgba(138,110,255,0.6);text-transform:uppercase;">Production Update</span>
      </div>
      <h3 style="margin:0 0 4px;font-size:16px;font-weight:700;color:#fff;">${batch.productName}</h3>
      <p style="margin:0 0 16px;font-size:11px;color:rgba(255,255,255,0.3);font-family:monospace;">${batch.batchCode}</p>
      <div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:16px;border:1px solid rgba(255,255,255,0.04);">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:12px;color:rgba(255,255,255,0.4);">${batch.previousStage}</span>
          <span style="font-size:16px;color:rgba(138,110,255,0.6);">→</span>
          <span style="font-size:12px;color:#fff;font-weight:700;">${batch.newStage}</span>
        </div>
        ${batch.quantity ? `<p style="margin:8px 0 0;font-size:11px;color:rgba(255,255,255,0.3);">Quantity: <strong style="color:rgba(255,255,255,0.6);">${batch.quantity} units</strong></p>` : ""}
      </div>
    </div>
    <a href="https://app.zicabella.com/dashboard/manufacturing/production" style="display:inline-block;padding:12px 24px;background:#fff;color:#000;border-radius:8px;font-size:11px;font-weight:700;text-decoration:none;letter-spacing:1px;text-transform:uppercase;">View Production →</a>
  `;

  return {
    subject: `🏭 ${batch.batchCode} → ${batch.newStage}`,
    html: wrapTemplate("Production Stage Update", content),
  };
}

// ─── Template: Daily Briefing ────────────────────

export function emailDailyBriefing(briefingText: string): { subject: string; html: string } {
  // Convert markdown-lite to HTML
  const htmlContent = briefingText
    .split("\n")
    .map((line) => {
      let l = line.replace(/\*\*(.*?)\*\*/g, '<strong style="color:#fff;">$1</strong>');
      if (l.trim().startsWith("- ") || l.trim().startsWith("• ")) {
        return `<div style="padding:2px 0 2px 16px;border-left:2px solid rgba(138,110,255,0.2);">• ${l.replace(/^[\s]*[-•]\s*/, "")}</div>`;
      }
      if (l.trim() === "") return "<br/>";
      return `<p style="margin:4px 0;">${l}</p>`;
    })
    .join("");

  const content = `
    <div style="background:rgba(255,255,255,0.03);border-radius:12px;padding:20px;border:1px solid rgba(255,255,255,0.06);margin-bottom:16px;">
      ${htmlContent}
    </div>
    <a href="https://app.zicabella.com/dashboard" style="display:inline-block;padding:12px 24px;background:#fff;color:#000;border-radius:8px;font-size:11px;font-weight:700;text-decoration:none;letter-spacing:1px;text-transform:uppercase;">Open Dashboard →</a>
  `;

  return {
    subject: `☀️ Zica Bella Daily Briefing — ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
    html: wrapTemplate("Daily Operations Briefing", content),
  };
}

// ─── Template: Low Stock Alert ───────────────────

export function emailLowStockAlert(items: { name: string; sku: string; stock: number; threshold: number }[]): { subject: string; html: string } {
  const rows = items
    .map(
      (item) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:13px;color:#fff;font-weight:600;">${item.name}</td>
        <td style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:11px;color:rgba(255,255,255,0.4);font-family:monospace;">${item.sku}</td>
        <td style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:13px;color:#ff3b30;font-weight:700;text-align:right;">${item.stock}</td>
        <td style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:11px;color:rgba(255,255,255,0.3);text-align:right;">${item.threshold}</td>
      </tr>`
    )
    .join("");

  const content = `
    <p style="margin:0 0 16px;font-size:13px;color:rgba(255,255,255,0.5);">
      <strong style="color:#ff3b30;">${items.length} item${items.length > 1 ? "s" : ""}</strong> ${items.length > 1 ? "are" : "is"} below the reorder threshold. Immediate action recommended.
    </p>
    <div style="border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);margin-bottom:16px;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:rgba(255,255,255,0.03);">
            <th style="padding:10px 12px;text-align:left;font-size:9px;color:rgba(255,255,255,0.25);letter-spacing:2px;font-weight:700;text-transform:uppercase;">Product</th>
            <th style="padding:10px 12px;text-align:left;font-size:9px;color:rgba(255,255,255,0.25);letter-spacing:2px;font-weight:700;text-transform:uppercase;">SKU</th>
            <th style="padding:10px 12px;text-align:right;font-size:9px;color:rgba(255,255,255,0.25);letter-spacing:2px;font-weight:700;text-transform:uppercase;">Stock</th>
            <th style="padding:10px 12px;text-align:right;font-size:9px;color:rgba(255,255,255,0.25);letter-spacing:2px;font-weight:700;text-transform:uppercase;">Threshold</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <a href="https://app.zicabella.com/dashboard/manufacturing/fabric" style="display:inline-block;padding:12px 24px;background:#fff;color:#000;border-radius:8px;font-size:11px;font-weight:700;text-decoration:none;letter-spacing:1px;text-transform:uppercase;">View Inventory →</a>
  `;

  return {
    subject: `🔴 Low Stock Alert: ${items.length} item${items.length > 1 ? "s" : ""} below threshold`,
    html: wrapTemplate("Low Stock Alert", content),
  };
}

// ─── Template: Custom AI message ─────────────────

export function emailCustomAI(params: {
  subject: string;
  message: string;
  actionUrl?: string;
  actionLabel?: string;
}): { subject: string; html: string } {
  const htmlMessage = params.message
    .split("\n")
    .map((line) => {
      let l = line.replace(/\*\*(.*?)\*\*/g, '<strong style="color:#fff;">$1</strong>');
      if (l.trim().startsWith("- ")) return `<div style="padding:2px 0 2px 16px;border-left:2px solid rgba(138,110,255,0.2);">• ${l.replace(/^[\s]*-\s*/, "")}</div>`;
      if (l.trim() === "") return "<br/>";
      return `<p style="margin:4px 0;">${l}</p>`;
    })
    .join("");

  const content = `
    <div style="background:rgba(255,255,255,0.03);border-radius:12px;padding:20px;border:1px solid rgba(255,255,255,0.06);margin-bottom:16px;">
      ${htmlMessage}
    </div>
    ${
      params.actionUrl
        ? `<a href="${params.actionUrl}" style="display:inline-block;padding:12px 24px;background:#fff;color:#000;border-radius:8px;font-size:11px;font-weight:700;text-decoration:none;letter-spacing:1px;text-transform:uppercase;">${params.actionLabel || "Open Dashboard →"}</a>`
        : ""
    }
  `;

  return {
    subject: params.subject,
    html: wrapTemplate("Zica AI Update", content),
  };
}
