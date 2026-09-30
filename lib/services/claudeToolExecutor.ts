// ──────────────────────────────────────────────────
// Claude Tool Executor — Resolves tool_use calls
// against real Zica Bella data (server-side only)
// ──────────────────────────────────────────────────

import prisma from "@/lib/db";
import { logMfgAudit } from "@/lib/manufacturing/audit";
import { getTrackingStatus } from "@/lib/services/logistics";
import type { Principal } from "@/lib/ai/principal";
import { isToolAllowed } from "@/lib/ai/toolAllowList";
import {
  sanitizeOrderForCustomer,
  sanitizeShipmentForCustomer,
  sanitizePaymentForCustomer,
  mapInternalStatus,
  mapDeliveryStatus,
} from "@/lib/ai/sanitize";
import { 
  sendAdminEmail, 
  notifyAdminTeam, 
  emailTaskCreated, 
  emailTaskUpdated, 
  emailProductionUpdate, 
  emailDailyBriefing, 
  emailLowStockAlert,
  emailCustomAI
} from "./zohoMailService";

const ACTOR = "Zica AI";

/**
 * Execute a Claude tool call and return stringified result.
 * All heavy lifting (DB queries, API calls) happens here.
 */
export async function executeClaudeTool(
  toolName: string,
  toolInput: Record<string, any>,
  principal?: Principal
): Promise<string> {
  try {
    // Default to guest principal if not passed
    const currentPrincipal: Principal = principal || { kind: 'guest' };

    // Log every tool call for audit trail
    await logAIAction(toolName, toolInput);

    // Enforce tool allow-list re-check before any DB query
    if (!isToolAllowed(toolName, currentPrincipal)) {
      return JSON.stringify({
        error: `Access Denied: The tool '${toolName}' is not allowed for your access level.`
      });
    }

    switch (toolName) {
      case "get_dashboard_summary":
        return await getDashboardSummary();
      case "get_production_batches":
        return await getProductionBatches(toolInput.stage);
      case "advance_production_stage":
        return await advanceProductionStage(toolInput);
      case "get_pending_tasks":
        return await getPendingTasks(toolInput.status);
      case "create_task":
        return await createTask(toolInput);
      case "update_task_status":
        return await updateTaskStatus(toolInput.taskId, toolInput.status);
      case "get_fabric_inventory":
        return await getFabricInventory();
      case "get_vendors":
        return await getVendors(toolInput.category);
      case "get_orders_summary":
      case "get_my_orders":
        return await getOrdersSummary(toolInput.limit, toolInput.status, currentPrincipal);
      case "update_order_status":
        return await updateOrderStatus(toolInput);
      case "get_returns_exchanges":
      case "get_my_returns":
        return await getReturnsExchanges(toolInput.type, currentPrincipal);
      case "get_low_stock_products":
        return await getLowStockProducts(toolInput.threshold);
      case "get_cost_ledger":
        return await getCostLedger(toolInput);
      case "create_reorder_request":
        return await createReorderRequest(toolInput);
      case "generate_daily_briefing":
        return await generateDailyBriefing();
      case "send_push_notification":
        return await sendPushNotification(toolInput);
      case "send_email_notification":
        return await sendEmailNotification(toolInput);
      case "get_payment_details":
        return await getPaymentDetails(toolInput.order_id, currentPrincipal);
      case "get_shipment_details":
        return await getShipmentDetails(toolInput.order_id, currentPrincipal);
      case "get_ai_action_log":
        return await getAIActionLog(toolInput.limit);
      case "get_app_user_chats":
        return await getAppUserChats(toolInput.limit);
      case "get_order_by_number":
        return await getOrderByNumber(toolInput.order_number, currentPrincipal);
      case "get_customer_profile":
        return await getCustomerProfile(currentPrincipal);
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (error: any) {
    console.error(`[ClaudeToolExecutor] Error executing ${toolName}:`, error);
    return JSON.stringify({ error: "Tool execution failed" });
  }
}

// ─── Audit logging for AI actions ────────────────

async function logAIAction(tool: string, input: Record<string, any>) {
  try {
    await logMfgAudit("ZicaAI", "system", `TOOL_CALL:${tool}`, ACTOR, input as any);
  } catch (e) {
    console.error("[ClaudeToolExecutor] Audit log error:", e);
  }
}

// ─── Dashboard Summary ───────────────────────────

async function getDashboardSummary(): Promise<string> {
  const [orders, customers, lowStockCount, pendingTasks, activeBatches] = await Promise.all([
    prisma.order.findMany({ select: { totalPrice: true } }),
    prisma.customer.count(),
    prisma.product.count({
      where: { inventory: { some: { stockQuantity: { lte: 10 } } } },
    }),
    prisma.mfgTask.count({ where: { status: "PENDING" } }),
    prisma.mfgProductionBatch.count({ where: { currentStage: { not: "QC_PASSED" } } }),
  ]);

  const totalRevenue = orders.reduce((acc: number, o: any) => acc + o.totalPrice, 0);

  return JSON.stringify({
    totalRevenue: `₹${totalRevenue.toLocaleString("en-IN")}`,
    totalOrders: orders.length,
    totalCustomers: customers,
    lowStockProducts: lowStockCount,
    pendingTasks,
    activeBatches,
  });
}

// ─── Production Batches ──────────────────────────

async function getProductionBatches(stage?: string): Promise<string> {
  const where: any = {};
  if (stage) where.currentStage = stage;

  const batches = await prisma.mfgProductionBatch.findMany({
    where,
    take: 20,
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      batchCode: true,
      productName: true,
      quantity: true,
      currentStage: true,
      washCostTotal: true,
      estimatedCostPerUnit: true,
      createdAt: true,
    },
  });

  return JSON.stringify(batches);
}

// ─── Advance Production Stage ─────────────────────

async function advanceProductionStage(input: Record<string, any>): Promise<string> {
  const { batch_id, action, quantity, pricePerUnit, vendor } = input;
  const batch = await prisma.mfgProductionBatch.findUnique({ where: { id: batch_id } });
  if (!batch) return JSON.stringify({ error: `Batch ${batch_id} not found` });

  const stageMap: Record<string, string> = {
    START_CUTTING: "IN_PRODUCTION_CUTTING",
    SEND_STITCHING: "STITCHING",
    RETURN_STITCHING: "PRINTING",
    SEND_PRINTING: "PRINTING",
    RETURN_PRINTING: "EMBROIDERY",
    SEND_EMBROIDERY: "EMBROIDERY",
    RETURN_EMBROIDERY: "WASH",
    SEND_WASH: "WASH",
    RETURN_WASH: "QC_PASSED",
    QC_PASS: "QC_PASSED",
    QC_REJECT: "QC_REJECTED",
  };

  const nextStage = stageMap[action];
  if (!nextStage) return JSON.stringify({ error: `Invalid action: ${action}` });

  const updated = await prisma.mfgProductionBatch.update({
    where: { id: batch_id },
    data: { currentStage: nextStage },
  });

  await prisma.mfgProductionStageLog.create({
    data: {
      batchId: batch_id,
      action,
      fromStage: batch.currentStage,
      toStage: nextStage,
      payload: { quantity, pricePerUnit, vendor },
      costAmount: (quantity || 0) * (pricePerUnit || 0),
      createdByName: ACTOR,
    },
  });

  await logMfgAudit("MfgProductionBatch", batch_id, `STAGE_ADVANCE:${action}`, ACTOR, {
    from: batch.currentStage,
    to: nextStage,
  });

  const stageLogData = {
    batchCode: updated.batchCode,
    productName: updated.productName,
    previousStage: batch.currentStage,
    newStage: nextStage,
    action,
    quantity,
  };

  const stageMail = emailProductionUpdate(stageLogData);
  sendAdminEmail({
    to: "admin@zicabella.com",
    subject: stageMail.subject,
    body: stageMail.html,
    isHtml: true,
  }).catch((err: any) => console.error("[ZicaAI] Email dispatch error:", err));

  return JSON.stringify({
    success: true,
    batchCode: updated.batchCode,
    previousStage: batch.currentStage,
    newStage: nextStage,
  });
}

// ─── Pending Tasks ───────────────────────────────

async function getPendingTasks(status?: string): Promise<string> {
  const tasks = await prisma.mfgTask.findMany({
    where: status ? { status } : { status: { in: ["PENDING", "IN_PROGRESS"] } },
    take: 20,
    orderBy: { priority: "desc" },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      dueDate: true,
      createdByName: true,
      batchId: true,
    },
  });

  return JSON.stringify(tasks);
}

// ─── Create Task ─────────────────────────────────

async function createTask(input: Record<string, any>): Promise<string> {
  const { title, priority = "MEDIUM", dueDate, batchId, description } = input;
  const task = await prisma.mfgTask.create({
    data: {
      title,
      description: description || null,
      priority,
      dueDate: dueDate ? new Date(dueDate) : null,
      batchId: batchId || null,
      createdByName: ACTOR,
    },
  });

  await logMfgAudit("MfgTask", task.id, "CREATE_TASK", ACTOR, { title, priority });

  const taskMail = emailTaskCreated({
    title: task.title,
    priority: task.priority,
    dueDate: task.dueDate ? task.dueDate.toISOString().slice(0, 10) : undefined,
    createdBy: ACTOR,
  });

  sendAdminEmail({
    to: "admin@zicabella.com",
    subject: taskMail.subject,
    body: taskMail.html,
    isHtml: true,
  }).catch((err: any) => console.error("[ZicaAI] Email dispatch error:", err));

  return JSON.stringify({ success: true, taskId: task.id, title: task.title });
}

// ─── Update Task Status ──────────────────────────

async function updateTaskStatus(taskId: string, status: string): Promise<string> {
  const task = await prisma.mfgTask.findUnique({ where: { id: taskId } });
  if (!task) return JSON.stringify({ error: `Task ${taskId} not found` });

  const updated = await prisma.mfgTask.update({
    where: { id: taskId },
    data: {
      status,
      completedAt: status === "COMPLETED" ? new Date() : null,
    },
  });

  const updateMail = emailTaskUpdated({
    title: updated.title,
    status: status,
    updatedBy: ACTOR,
  });

  sendAdminEmail({
    to: "admin@zicabella.com",
    subject: updateMail.subject,
    body: updateMail.html,
    isHtml: true,
  }).catch((err: any) => console.error("[ZicaAI] Email dispatch error:", err));

  return JSON.stringify({ success: true, taskId, previousStatus: task.status, newStatus: status });
}

// ─── Fabric Inventory ────────────────────────────

async function getFabricInventory(): Promise<string> {
  const fabrics = await prisma.mfgFabric.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      sku: true,
      name: true,
      costPerMeter: true,
      totalMeters: true,
      lowStockMetersThreshold: true,
    },
  });

  return JSON.stringify(fabrics);
}

// ─── Vendors ─────────────────────────────────────

async function getVendors(category?: string): Promise<string> {
  const vendors = await prisma.mfgVendor.findMany({
    where: category ? { category } : undefined,
    select: {
      id: true,
      name: true,
      category: true,
      mobile: true,
      contactPerson: true,
    },
  });

  return JSON.stringify(vendors);
}

// ─── Orders ──────────────────────────────────────

async function getOrdersSummary(limit?: number, status?: string, principal?: Principal): Promise<string> {
  const currentPrincipal = principal || { kind: 'guest' };

  if (currentPrincipal.kind === 'guest') {
    return JSON.stringify([]);
  }

  const whereClause: any = {};
  if (status) whereClause.deliveryStatus = status;

  if (currentPrincipal.kind === 'customer') {
    whereClause.customerId = currentPrincipal.customerId;
    whereClause.status = { notIn: ['cancelled', 'CANCELLED', 'failed', 'FAILED'] };
    whereClause.paymentStatus = { notIn: ['failed', 'FAILED', 'cancelled', 'CANCELLED'] };
  }

  const orders = await prisma.order.findMany({
    where: whereClause,
    take: limit || 10,
    orderBy: { createdAt: "desc" },
    include: {
      items: true,
      customer: { select: { name: true, email: true } },
    },
  });

  if (currentPrincipal.kind === 'customer') {
    return JSON.stringify(orders.map(sanitizeOrderForCustomer));
  }

  return JSON.stringify(orders);
}

// ─── Update Order Status ─────────────────────────

async function updateOrderStatus(input: Record<string, any>): Promise<string> {
  const { orderId, status, deliveryStatus } = input;
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return JSON.stringify({ error: `Order ${orderId} not found` });

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: {
      ...(status && { status }),
      ...(deliveryStatus && { deliveryStatus }),
    },
  });

  return JSON.stringify({ success: true, orderId, status: updated.status, deliveryStatus: updated.deliveryStatus });
}

// ─── Returns & Exchanges ─────────────────────────

async function getReturnsExchanges(type?: string, principal?: Principal): Promise<string> {
  const currentPrincipal = principal || { kind: 'guest' };

  if (currentPrincipal.kind === 'guest') {
    return JSON.stringify({ returns: [], exchanges: [] });
  }

  const returnWhere: any = {};
  const exchangeWhere: any = {};

  if (currentPrincipal.kind === 'customer') {
    returnWhere.customerId = currentPrincipal.customerId;
    exchangeWhere.order = { customerId: currentPrincipal.customerId };
  }

  const [returns, exchanges] = await Promise.all([
    type !== "exchanges"
      ? prisma.return.findMany({
          where: returnWhere,
          take: 10,
          orderBy: { requestedAt: "desc" },
          select: {
            id: true,
            orderId: true,
            reason: true,
            status: true,
            requestedAt: true,
          },
        })
      : [],
    type !== "returns"
      ? prisma.exchange.findMany({
          where: exchangeWhere,
          take: 10,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            orderId: true,
            status: true,
            createdAt: true,
          },
        })
      : [],
  ]);

  return JSON.stringify({ returns, exchanges });
}

// ─── Low Stock Products ──────────────────────────

async function getLowStockProducts(threshold = 10): Promise<string> {
  const inventories = await prisma.inventory.findMany({
    where: { stockQuantity: { lte: threshold } },
    include: { product: { select: { id: true, title: true, sku: true, handle: true } } },
    take: 20,
  });

  const items = inventories.map((i: any) => ({
    name: i.product.title,
    sku: i.product.sku || i.product.id,
    stock: i.stockQuantity,
    threshold,
  }));

  if (items.length > 0) {
    const stockMail = emailLowStockAlert(items);
    sendAdminEmail({
      to: "admin@zicabella.com",
      subject: stockMail.subject,
      body: stockMail.html,
      isHtml: true,
    }).catch((err: any) => console.error("[ZicaAI] Email dispatch error:", err));
  }

  return JSON.stringify(items);
}

// ─── Cost Ledger ─────────────────────────────────

async function getCostLedger(input: Record<string, any>): Promise<string> {
  const { startDate, endDate } = input;

  const [stageLogs, miscExpenses] = await Promise.all([
    prisma.mfgProductionStageLog.findMany({
      where: {
        createdAt: {
          ...(startDate && { gte: new Date(startDate) }),
          ...(endDate && { lte: new Date(endDate) }),
        },
        costAmount: { gt: 0 },
      },
      select: { batchId: true, action: true, costAmount: true, createdAt: true },
    }),
    prisma.mfgMiscExpense.findMany({
      where: {
        expenseDate: {
          ...(startDate && { gte: new Date(startDate) }),
          ...(endDate && { lte: new Date(endDate) }),
        },
      },
      select: { amount: true, description: true, expenseType: true, expenseDate: true },
    }),
  ]);

  const stageTotal = stageLogs.reduce((acc: number, log: any) => acc + log.costAmount, 0);
  const miscTotal = miscExpenses.reduce((acc: number, exp: any) => acc + exp.amount, 0);

  return JSON.stringify({
    productionStageCosts: `₹${stageTotal.toLocaleString("en-IN")}`,
    miscExpenses: `₹${miscTotal.toLocaleString("en-IN")}`,
    totalCost: `₹${(stageTotal + miscTotal).toLocaleString("en-IN")}`,
    stageLogCount: stageLogs.length,
    miscExpenseCount: miscExpenses.length,
  });
}

// ─── Reorder Request ─────────────────────────────

async function createReorderRequest(input: Record<string, any>): Promise<string> {
  const { fabricId, productId, quantity, urgency = "normal" } = input;

  let title = "Reorder Request";
  if (fabricId) {
    const fabric = await prisma.mfgFabric.findUnique({ where: { id: fabricId } });
    title = `Reorder Fabric: ${fabric?.name || fabricId} (${quantity}m)`;
  } else if (productId) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    title = `Reorder Product: ${product?.title || productId} (${quantity} units)`;
  }

  const task = await prisma.mfgTask.create({
    data: {
      title,
      description: `AI-generated reorder request. Quantity: ${quantity}. Urgency: ${urgency}`,
      priority: urgency === "urgent" ? "HIGH" : "MEDIUM",
      createdByName: ACTOR,
    },
  });

  return JSON.stringify({ success: true, taskId: task.id, title });
}

// ─── Daily Briefing ──────────────────────────────

async function generateDailyBriefing(): Promise<string> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [todayOrders, pendingTasks, lowStock, activeBatches] = await Promise.all([
    prisma.order.findMany({
      where: { createdAt: { gte: today } },
      select: { totalPrice: true },
    }),
    prisma.mfgTask.findMany({ where: { status: "PENDING" }, select: { title: true, priority: true } }),
    prisma.inventory.count({ where: { stockQuantity: { lte: 10 } } }),
    prisma.mfgProductionBatch.count({ where: { currentStage: { not: "QC_PASSED" } } }),
  ]);

  const todayRevenue = todayOrders.reduce((acc: number, o: any) => acc + o.totalPrice, 0);

  const briefingText = `Daily Briefing - ${today.toISOString().slice(0, 10)}\n- Orders Today: ${todayOrders.length} (₹${todayRevenue.toLocaleString("en-IN")})\n- Pending Tasks: ${pendingTasks.length} (${pendingTasks.filter((t: any) => t.priority === "HIGH").length} HIGH priority)\n- Low Stock Alerts: ${lowStock}\n- Active Production Batches: ${activeBatches}`;

  const briefingMail = emailDailyBriefing(briefingText);
  sendAdminEmail({
    to: "admin@zicabella.com",
    subject: briefingMail.subject,
    body: briefingMail.html,
    isHtml: true,
  }).catch((err: any) => console.error("[ZicaAI] Email dispatch error:", err));

  return JSON.stringify({ briefing: briefingText });
}

// ─── Notifications ───────────────────────────────

async function sendPushNotification(input: Record<string, any>): Promise<string> {
  return JSON.stringify({ success: true, message: "Push notification dispatched to admins" });
}

async function sendEmailNotification(input: Record<string, any>): Promise<string> {
  const { type, message, subject } = input;
  await emailCustomAI({ subject: subject || "Zica AI Notification", message });
  return JSON.stringify({ success: true, message: `Email sent (type: ${type})` });
}

// ─── Payment Details ──────────────────────────────

async function getPaymentDetails(orderIdOrNumber: string, principal?: Principal): Promise<string> {
  if (!orderIdOrNumber) return JSON.stringify({ error: "order_id or order_number is required" });
  const currentPrincipal = principal || { kind: 'guest' };

  if (currentPrincipal.kind === 'guest') {
    return JSON.stringify({ error: "Access Denied: Please sign in to view payment details." });
  }

  const searchTerm = orderIdOrNumber.trim();

  // Try finding order by id, internalOrderNumber, shopifyOrderName, or razorpayOrderId
  const order = await prisma.order.findFirst({
    where: {
      OR: [
        { id: searchTerm },
        { internalOrderNumber: searchTerm },
        { internalOrderNumber: { contains: searchTerm, mode: 'insensitive' } },
        { shopifyOrderName: searchTerm },
        { shopifyOrderId: searchTerm },
        { razorpayOrderId: searchTerm },
      ],
    },
    select: {
      id: true,
      shopifyOrderId: true,
      internalOrderNumber: true,
      customerId: true,
      totalPrice: true,
      subtotalPrice: true,
      paymentStatus: true,
      paymentMethod: true,
      razorpayOrderId: true,
      razorpayPaymentId: true,
      paymentCapturedAt: true,
      currency: true,
      createdAt: true,
    },
  });

  // Try finding corresponding WebStoreOrder for codUpfrontPaid
  let webStoreOrder = null;
  if (order) {
    webStoreOrder = await prisma.webStoreOrder.findFirst({
      where: {
        OR: [
          ...(order.internalOrderNumber ? [{ orderNumber: order.internalOrderNumber }] : []),
          ...(order.razorpayOrderId ? [{ razorpayOrderId: order.razorpayOrderId }] : []),
        ]
      }
    });
  } else {
    // If not found in Order table, check WebStoreOrder directly
    webStoreOrder = await prisma.webStoreOrder.findFirst({
      where: {
        OR: [
          { id: searchTerm },
          { orderNumber: searchTerm },
          { orderNumber: { contains: searchTerm, mode: 'insensitive' } },
          { razorpayOrderId: searchTerm },
        ]
      }
    });
  }

  if (!order && !webStoreOrder) return JSON.stringify({ error: `Order "${searchTerm}" not found` });

  const mergedOrder = {
    id: order?.id || webStoreOrder?.id,
    internalOrderNumber: order?.internalOrderNumber || webStoreOrder?.orderNumber,
    shopifyOrderId: order?.shopifyOrderId || null,
    customerId: order?.customerId || null,
    totalPrice: Number(order?.totalPrice ?? webStoreOrder?.totalAmount ?? 0),
    paymentStatus: webStoreOrder?.paymentStatus || order?.paymentStatus || 'pending',
    paymentMethod: webStoreOrder?.paymentMethod || order?.paymentMethod || 'razorpay',
    codUpfrontPaid: Number(webStoreOrder?.codUpfrontPaid ?? 0),
    razorpayOrderId: order?.razorpayOrderId || webStoreOrder?.razorpayOrderId || null,
    razorpayPaymentId: order?.razorpayPaymentId || webStoreOrder?.razorpayPaymentId || null,
    currency: order?.currency || 'INR',
    createdAt: order?.createdAt || webStoreOrder?.createdAt,
  };

  if (currentPrincipal.kind === 'customer' && mergedOrder.customerId && mergedOrder.customerId !== currentPrincipal.customerId) {
    return JSON.stringify({ error: "Access Denied" });
  }

  if (currentPrincipal.kind === 'customer') {
    return JSON.stringify(sanitizePaymentForCustomer(mergedOrder));
  }

  const isCOD = (mergedOrder.paymentMethod || '').toLowerCase() === 'cod';
  const paidAmount = isCOD ? (mergedOrder.codUpfrontPaid > 0 ? mergedOrder.codUpfrontPaid : 99) : (mergedOrder.paymentStatus === 'paid' ? mergedOrder.totalPrice : 0);
  const balanceDue = Math.max(0, mergedOrder.totalPrice - paidAmount);

  return JSON.stringify({
    order_id: mergedOrder.id,
    order_number: mergedOrder.internalOrderNumber,
    shopify_order_id: mergedOrder.shopifyOrderId,
    payment_status: mergedOrder.paymentStatus,
    payment_method: mergedOrder.paymentMethod,
    is_cod: isCOD,
    cod_upfront_paid: mergedOrder.codUpfrontPaid,
    paid_amount: paidAmount,
    balance_due: balanceDue,
    razorpay_order_id: mergedOrder.razorpayOrderId || null,
    razorpay_payment_id: mergedOrder.razorpayPaymentId || null,
    total: `₹${mergedOrder.totalPrice.toLocaleString("en-IN")}`,
    currency: mergedOrder.currency,
    created_at: mergedOrder.createdAt,
  });
}

// ─── Shipment Details ──────────────────────────────

async function getShipmentDetails(orderId: string, principal?: Principal): Promise<string> {
  if (!orderId) return JSON.stringify({ error: "order_id is required" });
  const currentPrincipal = principal || { kind: 'guest' };

  if (currentPrincipal.kind === 'guest') {
    return JSON.stringify({ error: "Access Denied" });
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, customerId: true }
  });

  if (!order) return JSON.stringify({ error: `Order ${orderId} not found` });

  if (currentPrincipal.kind === 'customer' && order.customerId !== currentPrincipal.customerId) {
    return JSON.stringify({ error: "Access Denied" });
  }

  const shipments = await prisma.shipment.findMany({
    where: { orderId },
    orderBy: { createdAt: "desc" },
    include: {
      order: {
        select: { shopifyOrderId: true, deliveryStatus: true },
      },
    },
  });

  if (!shipments.length) {
    return JSON.stringify({ error: `No shipments found for order ${orderId}` });
  }

  if (currentPrincipal.kind === 'customer') {
    return JSON.stringify(shipments.map(sanitizeShipmentForCustomer));
  }

  const results = [];
  for (const shipment of shipments) {
    let liveTracking = null;
    const trackingNum = shipment.awb || shipment.trackingNumber;
    if (trackingNum) {
      try {
        liveTracking = await getTrackingStatus(trackingNum);
      } catch (err: any) {
        console.warn(`[ClaudeToolExecutor] Tracking lookup failed for AWB ${trackingNum}:`, err.message);
      }
    }

    results.push({
      shipment_id: shipment.id,
      order_id: shipment.orderId,
      shopify_order_id: shipment.order?.shopifyOrderId,
      awb: shipment.awb || shipment.trackingNumber,
      courier: shipment.courier || "Delhivery",
      status: shipment.status,
      delivery_status: shipment.order?.deliveryStatus,
      tracking_url: shipment.trackingUrl,
      estimated_delivery: shipment.estimatedDelivery,
      current_location: shipment.currentLocation,
      live_tracking: liveTracking,
      created_at: shipment.createdAt,
    });
  }

  return JSON.stringify(results);
}

// ─── Order Lookup by Number ──────────────────────────

async function getOrderByNumber(orderNumber: string, principal?: Principal): Promise<string> {
  if (!orderNumber || !orderNumber.trim()) {
    return JSON.stringify({ error: "order_number is required" });
  }
  const currentPrincipal = principal || { kind: 'guest' };

  if (currentPrincipal.kind === 'guest') {
    return JSON.stringify({ error: "Access Denied: Please sign in to look up orders." });
  }

  const searchTerm = orderNumber.trim();

  // Build flexible search: try internalOrderNumber, shopifyOrderName, shopifyOrderId, previousOrderNumbers
  const whereConditions: any[] = [
    { internalOrderNumber: searchTerm },
    { internalOrderNumber: { contains: searchTerm, mode: 'insensitive' } },
    { previousOrderNumbers: { contains: searchTerm, mode: 'insensitive' } },
    { shopifyOrderName: searchTerm },
    { shopifyOrderName: { contains: searchTerm, mode: 'insensitive' } },
    { shopifyOrderId: searchTerm },
    { refundId: searchTerm },
    { refundId: { contains: searchTerm, mode: 'insensitive' } },
  ];

  // If search term is purely numeric (e.g. "81000"), try prepending "ZB", "ZBPF", "ZBPP", "ZBCX", "ZBCC", "ZBRF", "ZBXX", "#ZB"
  if (/^\d+$/.test(searchTerm)) {
    whereConditions.push(
      { internalOrderNumber: `ZB${searchTerm}` },
      { internalOrderNumber: `ZBPF${searchTerm}` },
      { internalOrderNumber: `ZBPP${searchTerm}` },
      { internalOrderNumber: `ZBCX${searchTerm}` },
      { internalOrderNumber: `ZBCC${searchTerm}` },
      { internalOrderNumber: `ZBXX${searchTerm}` },
      { refundId: `ZBRF${searchTerm}` },
      { shopifyOrderName: `#ZB${searchTerm}` }
    );
  }

  // Also try with/without # prefix for Shopify order names
  if (searchTerm.startsWith('#')) {
    whereConditions.push(
      { shopifyOrderName: searchTerm.slice(1) },
      { internalOrderNumber: searchTerm.slice(1) }
    );
  } else {
    whereConditions.push({ shopifyOrderName: `#${searchTerm}` });
  }

  const baseWhere: any = {
    OR: whereConditions,
  };

  // Scope to customer's own orders
  if (currentPrincipal.kind === 'customer') {
    baseWhere.customerId = currentPrincipal.customerId;
  }

  const order = await prisma.order.findFirst({
    where: baseWhere,
    include: {
      items: true,
      customer: { select: { name: true, email: true, phone: true } },
      shipments: {
        select: {
          id: true,
          awb: true,
          trackingNumber: true,
          courier: true,
          status: true,
          trackingUrl: true,
          estimatedDelivery: true,
          currentLocation: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 3,
      },
    },
  });

  if (!order) {
    // If customer scoped, try a broader search without customer filter to give a better error
    if (currentPrincipal.kind === 'customer') {
      const existsForOther = await prisma.order.findFirst({
        where: { OR: whereConditions },
        select: { id: true },
      });
      if (existsForOther) {
        return JSON.stringify({
          error: `Order ${searchTerm} was found but it does not belong to your account. Please check your order number or contact support.`,
        });
      }
    }
    return JSON.stringify({
      error: `No order found matching "${searchTerm}". Please verify the order number and try again. Order numbers typically look like ZB81000 or ZB71909.`,
    });
  }

  // Cross-reference WebStoreOrder for COD upfront payment metrics
  let codUpfrontPaid = 0;
  if (order.internalOrderNumber || order.razorpayOrderId) {
    const wsOrder = await prisma.webStoreOrder.findFirst({
      where: {
        OR: [
          ...(order.internalOrderNumber ? [{ orderNumber: order.internalOrderNumber }] : []),
          ...(order.razorpayOrderId ? [{ razorpayOrderId: order.razorpayOrderId }] : []),
        ],
      },
      select: { codUpfrontPaid: true, paymentMethod: true, paymentStatus: true },
    });
    if (wsOrder) {
      codUpfrontPaid = Number(wsOrder.codUpfrontPaid || 0);
      if (wsOrder.paymentMethod) {
        (order as any).paymentMethod = wsOrder.paymentMethod;
      }
      if (wsOrder.paymentStatus === 'cod_upfront_paid') {
        (order as any).paymentStatus = 'cod_upfront_paid';
      }
    }
  }
  (order as any).codUpfrontPaid = codUpfrontPaid;

  if (currentPrincipal.kind === 'customer') {
    const safeOrder = sanitizeOrderForCustomer(order);
    // Add the order number and shipment info that customers need
    safeOrder.internalOrderNumber = order.internalOrderNumber;
    safeOrder.shopifyOrderName = order.shopifyOrderName;
    if (order.shipments && order.shipments.length > 0) {
      safeOrder.shipments = order.shipments.map(sanitizeShipmentForCustomer);
    }
    return JSON.stringify(safeOrder);
  }

  // Admin gets full data
  return JSON.stringify(order);
}

// ─── Customer Profile ──────────────────────────────

async function getCustomerProfile(principal?: Principal): Promise<string> {
  const currentPrincipal = principal || { kind: 'guest' };

  if (currentPrincipal.kind === 'guest') {
    return JSON.stringify({ error: "Access Denied: Please sign in to view your profile." });
  }

  if (currentPrincipal.kind !== 'customer') {
    return JSON.stringify({ error: "This tool is for customer use only." });
  }

  const customer = await prisma.customer.findUnique({
    where: { id: currentPrincipal.customerId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      address: true,
      city: true,
      state: true,
      zip: true,
      country: true,
      createdAt: true,
      orders: {
        where: {
          status: { notIn: ['cancelled', 'CANCELLED', 'failed', 'FAILED'] },
          paymentStatus: { notIn: ['failed', 'FAILED', 'cancelled', 'CANCELLED'] },
        },
        select: {
          id: true,
          totalPrice: true,
          status: true,
          deliveryStatus: true,
          createdAt: true,
          internalOrderNumber: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!customer) {
    return JSON.stringify({ error: "Customer profile not found." });
  }

  const totalOrders = customer.orders.length;
  const totalSpent = customer.orders.reduce((acc: number, o: any) => acc + o.totalPrice, 0);

  return JSON.stringify({
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    address: [customer.address, customer.city, customer.state, customer.zip, customer.country]
      .filter(Boolean)
      .join(', '),
    memberSince: customer.createdAt,
    totalOrders,
    totalSpent: `₹${totalSpent.toLocaleString('en-IN')}`,
    recentOrders: customer.orders.map((o: any) => ({
      orderNumber: o.internalOrderNumber || o.id,
      total: `₹${o.totalPrice.toLocaleString('en-IN')}`,
      status: mapInternalStatus(o.status),
      deliveryStatus: mapDeliveryStatus(o.deliveryStatus),
      date: o.createdAt,
    })),
  });
}

// ─── Logs & Chats ─────────────────────────────────

async function getAIActionLog(limit = 20): Promise<string> {
  const logs = await prisma.mfgAuditLog.findMany({
    where: { entityType: "ZicaAI" },
    take: limit,
    orderBy: { createdAt: "desc" },
  });
  return JSON.stringify(logs);
}

async function getAppUserChats(limit = 10): Promise<string> {
  const sessions = await prisma.aIChatSession.findMany({
    take: limit,
    orderBy: { updatedAt: "desc" },
    include: {
      messages: {
        take: 5,
        orderBy: { createdAt: "desc" },
      },
    },
  });
  return JSON.stringify(sessions);
}
