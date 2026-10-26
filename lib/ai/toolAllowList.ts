/**
 * lib/ai/toolAllowList.ts
 * Per-principal tool allow-lists, enforced in TWO places:
 * 1. When building the tools array sent to Claude
 * 2. Re-checked inside executeClaudeTool before any DB query
 */

import type { Principal } from './principal';

// ---------------------------------------------------------------------------
// Tool names by scope
// ---------------------------------------------------------------------------

/** Admin-only tools — full internal operations */
const ADMIN_TOOLS = new Set([
  'get_dashboard_summary',
  'generate_daily_briefing',
  'get_production_batches',
  'advance_production_stage',
  'get_pending_tasks',
  'create_task',
  'update_task_status',
  'get_fabric_inventory',
  'get_low_stock_products',
  'create_reorder_request',
  'get_orders_summary',
  'update_order_status',
  'get_returns_exchanges',
  'get_vendors',
  'get_cost_ledger',
  'send_push_notification',
  'send_email_notification',
  'get_payment_details',
  'get_shipment_details',
  'get_ai_action_log',
  'get_app_user_chats',
  'get_order_by_number',
  'get_customer_profile',
  'update_order_address',
  'update_order_phone',
  'update_order_size',
  'get_order_tracking',
]);

/** Customer tools — scoped to own data only */
const CUSTOMER_TOOLS = new Set([
  'get_my_orders',
  'get_orders_summary',
  'get_order_by_number',
  'get_shipment_details',
  'get_payment_details',
  'get_my_returns',
  'get_returns_exchanges',
  'get_customer_profile',
  'update_order_address',
  'update_order_phone',
  'update_order_size',
  'get_order_tracking',
]);

/** Guest tools — order self-serve when they can prove the order (email/phone match) */
const GUEST_TOOLS = new Set([
  'get_order_by_number',
  'get_shipment_details',
  'get_order_tracking',
  'update_order_address',
  'update_order_phone',
  'update_order_size',
]);

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Get the set of allowed tool names for a given principal.
 */
export function getAllowedToolNames(principal: Principal): Set<string> {
  switch (principal.kind) {
    case 'admin':
      return ADMIN_TOOLS;
    case 'customer':
      return CUSTOMER_TOOLS;
    case 'guest':
      return GUEST_TOOLS;
  }
}

/**
 * Filter a tools array to only include tools allowed for the given principal.
 * Used when building the Claude API request.
 */
export function filterToolsForPrincipal<T extends { name: string }>(
  tools: T[],
  principal: Principal
): T[] {
  const allowed = getAllowedToolNames(principal);
  return tools.filter((t): t is T => allowed.has(t.name));
}

/**
 * Check if a specific tool is allowed for the given principal.
 * Used inside executeClaudeTool as a re-check before DB access.
 */
export function isToolAllowed(toolName: string, principal: Principal): boolean {
  return getAllowedToolNames(principal).has(toolName);
}
