import fs from "fs";
import path from "path";

const SETTINGS_FILE = path.join(process.cwd(), "lib", "ai-settings.json");

export interface AISettings {
  enabledTools: string[];
  allowedPages: string[];
  restrictToOwnData?: boolean;
}

export interface TrainingRule {
  id: string;
  prompt: string;
  createdAt: string;
}

export interface ZicaAISettings {
  admin: AISettings;
  user: AISettings;
  trainingRules?: TrainingRule[];
}

const DEFAULT_RULES: TrainingRule[] = [
  {
    id: "rule_default_1",
    prompt: "When the user asks to track their order, only show confirmed, pending approval, delivered, and returns or exchange orders. Do not show cancelled or payment failed orders.",
    createdAt: "2026-05-17T00:00:00.000Z"
  },
  {
    id: "rule_default_2",
    prompt: "Under no circumstances should regular app users access dashboard metrics, manufacturing cost ledger, internal sales, other users' chats, or admin-only data.",
    createdAt: "2026-05-17T00:00:00.000Z"
  },
  {
    id: "rule_default_3",
    prompt: "All order tracking and payment searches must strictly be filtered to the authenticated customer's own data to protect user privacy.",
    createdAt: "2026-05-17T00:00:00.000Z"
  },
  {
    id: "rule_default_4",
    prompt: "If a user asks about payment status, only show payment status as paid, pending, or failed based strictly on their own data.",
    createdAt: "2026-05-17T00:00:00.000Z"
  }
];

export function getAISettings(): ZicaAISettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, "utf-8");
      const parsed = JSON.parse(data);
      if (!parsed.trainingRules || parsed.trainingRules.length === 0) {
        parsed.trainingRules = [...DEFAULT_RULES];
        saveAISettings(parsed);
      }
      return parsed;
    }
  } catch (err) {
    console.error("[ai-settings] Failed to read settings:", err);
  }
  
  // Return fallback default values
  return {
    admin: {
      enabledTools: [
        "get_dashboard_summary", "generate_daily_briefing", "get_production_batches",
        "advance_production_stage", "get_pending_tasks", "create_task", "update_task_status",
        "get_fabric_inventory", "get_low_stock_products", "create_reorder_request",
        "get_orders_summary", "update_order_status", "get_returns_exchanges", "get_vendors",
        "get_cost_ledger", "send_push_notification", "send_email_notification",
        "get_payment_details", "get_shipment_details", "get_ai_action_log", "get_app_user_chats",
        "update_order_address", "update_order_phone", "update_order_size", "get_order_tracking"
      ],
      allowedPages: ["dashboard", "manufacturing", "inventory", "orders", "customers", "marketing", "settings", "webhooks"]
    },
    user: {
      enabledTools: ["get_shipment_details", "get_payment_details", "get_orders_summary", "update_order_address", "update_order_phone", "update_order_size", "get_order_tracking"],
      allowedPages: ["shop", "collections", "cart", "orders", "profile", "support"],
      restrictToOwnData: true
    },
    trainingRules: [...DEFAULT_RULES]
  };
}

export function saveAISettings(settings: ZicaAISettings): boolean {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
    return true;
  } catch (err) {
    console.error("[ai-settings] Failed to write settings:", err);
    return false;
  }
}
