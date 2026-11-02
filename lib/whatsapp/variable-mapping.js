/**
 * What each {{variable}} of a template body receives, for a given automation event.
 *
 * ONE function used by the sender (lib/whatsapp/templates.js) and by the dashboard preview, so the preview can
 * never show something different from what a customer receives. Pure: no database, no network.
 *
 * Named variables ({{order_id}}, {{amount}}, {{customer_name}}...) are matched by name; numbered ones ({{1}}, {{2}}...)
 * follow the fixed order of the event (see the `switch`). For store credit, the prepaid confirmation and the expiry
 * reminder the number of variables decides the layout.
 *
 * @param {string} eventType e.g. 'order_confirmed', 'store_credit_earned'
 * @param {string} text the template BODY text
 * @param {Record<string, any>} data the event data (customerName, orderId, totalAmount, ...)
 * @returns {Array<{ name: string, isNumeric: boolean, value: string }>} one entry per variable, in order of appearance
 */
export function resolveBodyVariables(eventType, text, data) {
  text = text || '';
  data = data || {};
  const varMatches = Array.from(text.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g));
  const expectedBodyVarsCount = varMatches.length;
  const out = [];
  if (expectedBodyVarsCount === 0) return out;

  const orderNum = data.orderId || data.internalOrderNumber || data.shopifyOrderName || data.name || 'Order';
  const custName = data.customerName || data.name || 'Customer';
  const totalAmt = data.totalAmount ? `₹${data.totalAmount}` : data.total ? `₹${data.total}` : data.cartTotal ? `₹${data.cartTotal}` : 'Zica Bella';
  const itemsCount = data.itemCount || data.itemsCount ? String(data.itemCount || data.itemsCount) : '1';
  const statusStr = data.status || 'Confirmed';
  const dateStr = data.expiryDate || data.deliveryDate || data.deliveredDate || data.pickupDate || data.saleEndDate || 'Scheduled';
  const trackNum = data.trackingNumber || data.awbNumber || 'Assigned';
  const linkUrl = data.checkoutUrl || data.orderStatusUrl || data.trackingUrl || data.shopUrl || 'Zica Bella';

  const amountForNamed = (name) => {
    const plain = String(data.totalAmount || '').replace('₹', '').trim();
    if (!plain) return totalAmt;
    return new RegExp(`₹\\s*\\{\\{${name}\\}\\}`).test(text) ? plain : `₹${plain}`;
  };
  let defaultSeq = [];
  switch (eventType) {
    case 'order_confirmed':
    case 'order_delivered':
    case 'cod_confirmation':
      defaultSeq = [custName, orderNum, totalAmt, itemsCount, dateStr];
      break;
    case 'order_shipped':
    case 'order_tracking':
      defaultSeq = [custName, orderNum, trackNum, linkUrl, dateStr];
      break;
    case 'order_status':
      defaultSeq = [custName, orderNum, statusStr, data.extraInfo || linkUrl];
      break;
    case 'out_for_delivery':
      defaultSeq = [orderNum, custName, trackNum, dateStr];
      break;
    case 'return_confirmed':
      defaultSeq = [custName, orderNum, data.refundAmount || totalAmt];
      break;
    case 'return_pickup_scheduled':
    case 'exchange_pickup_scheduled':
      defaultSeq = [custName, orderNum, dateStr, trackNum];
      break;
    case 'exchange_confirmed':
      defaultSeq = [custName, orderNum, data.newItemName || 'Replacement Item'];
      break;
    case 'exchange_shipped':
      defaultSeq = [custName, orderNum, trackNum, linkUrl];
      break;
    case 'return_received':
    case 'exchange_delivered':
    case 'order_cancelled':
      defaultSeq = [custName, orderNum];
      break;
    case 'refund_initiated':
      defaultSeq = [custName, orderNum, totalAmt];
      break;
    case 'store_credit_expiring': {
      // By variable count: 1 = amount, 2 = amount + expiry date, 3 = name + amount + expiry date.
      const plain = String(data.totalAmount || '').replace('₹', '').trim();
      const amountFor = (n) => (new RegExp(`₹\\s*\\{\\{${n}\\}\\}`).test(text) ? plain : (plain ? `₹${plain}` : totalAmt));
      // Two variables are either (name, amount) or (amount, expiry date): a greeting right before {{1}}
      // ("Hi {{1}},") means the name comes first.
      const greetsFirst = /\b(hi|hello|hey|dear)\b[\s,:\-]*$/i.test(text.slice(0, Math.max(0, text.indexOf('{{1}}'))));
      if (expectedBodyVarsCount === 1) defaultSeq = [amountFor(1)];
      else if (expectedBodyVarsCount === 2) defaultSeq = greetsFirst ? [custName, amountFor(2)] : [amountFor(1), dateStr];
      else defaultSeq = [custName, amountFor(2), dateStr];
      break;
    }
    case 'order_confirmed_prepaid': {
      // Prepaid order confirmation that names the store credit earned. By variable count:
      // 1 = credit, 2 = order + credit, 3 = name + order + credit (named variables are matched by name).
      const plain = String(data.totalAmount || '').replace('₹', '').trim();
      const amountFor = (n) => (new RegExp(`₹\\s*\\{\\{${n}\\}\\}`).test(text) ? plain : (plain ? `₹${plain}` : totalAmt));
      if (expectedBodyVarsCount === 1) defaultSeq = [amountFor(1)];
      else if (expectedBodyVarsCount === 2) defaultSeq = [orderNum, amountFor(2)];
      else defaultSeq = [custName, orderNum, amountFor(3)];
      break;
    }
    case 'store_credit_earned':
    case 'store_coins_earned': {
      // The amount is a plain number when the template text already prints the ₹ in front of it
      // ("₹ {{1}}"), otherwise it carries its own ₹. By variable count: 1 = amount, 2 = name + amount,
      // 3 = name + amount + order.
      const plain = String(data.totalAmount || '').replace('₹', '').trim();
      const amountFor = (n) => (new RegExp(`₹\\s*\\{\\{${n}\\}\\}`).test(text) ? plain : (plain ? `₹${plain}` : totalAmt));
      if (expectedBodyVarsCount === 1) defaultSeq = [amountFor(1)];
      else if (expectedBodyVarsCount === 2) defaultSeq = [custName, amountFor(2)];
      else defaultSeq = [custName, amountFor(2), orderNum];
      break;
    }
    case 'abandoned_cart':
      defaultSeq = [custName, data.productName || linkUrl, linkUrl, totalAmt];
      break;
    case 'cart_followup':
    case 'cart_final':
      defaultSeq = [custName, data.discountCode || 'ZICA10', linkUrl];
      break;
    case 'new_collection':
      defaultSeq = [custName, data.collectionName || 'New Collection', data.tagline || 'Shop Now'];
      break;
    case 'sale_alert':
      defaultSeq = [custName, String(data.discountPercent || '10'), dateStr];
      break;
    case 'restock_alert':
      defaultSeq = [custName, data.productName || 'Favorite Item', data.size || 'All Sizes'];
      break;
    case 'welcome':
    case 'account_created':
      defaultSeq = [custName];
      break;
    default:
      defaultSeq = [custName, orderNum, totalAmt, linkUrl];
  }

  for (let i = 0; i < expectedBodyVarsCount; i++) {
    const rawVarName = varMatches[i] ? varMatches[i][1] : String(i + 1);
    const lowerVar = rawVarName.toLowerCase();
    const varNum = parseInt(rawVarName, 10);

    // Priority 1: Check explicit data parameter passed (e.g. data["order_id"], data["1"], data["orderId"])
    let val = data[rawVarName] ?? data[lowerVar] ?? (isNaN(varNum) ? undefined : data[varNum]) ?? data[i + 1] ?? data[String(i + 1)] ?? data[`var${rawVarName}`] ?? data[`param${rawVarName}`];

    // Priority 2: Smart fallback mapping based on variable name semantics
    if (val === undefined || val === null || String(val).trim() === '' || String(val) === 'undefined' || String(val) === 'null') {
      if ((eventType === 'store_credit_earned' || eventType === 'store_coins_earned' || eventType === 'order_confirmed_prepaid' || eventType === 'store_credit_expiring') && /amount|credit|coin/.test(lowerVar)) {
        val = amountForNamed(rawVarName);
      } else if (eventType === 'store_credit_expiring' && lowerVar.includes('days') && data.daysLeft !== undefined) {
        val = String(data.daysLeft);
      } else if (lowerVar.includes('order') || lowerVar.includes('id') || lowerVar.includes('number')) {
        val = orderNum;
      } else if (lowerVar.includes('name') || lowerVar.includes('customer') || lowerVar.includes('user')) {
        val = custName;
      } else if (lowerVar.includes('total') || lowerVar.includes('amount') || lowerVar.includes('price')) {
        val = totalAmt;
      } else if (lowerVar.includes('item') || lowerVar.includes('count') || lowerVar.includes('qty')) {
        val = itemsCount;
      } else if (lowerVar.includes('date') || lowerVar.includes('time')) {
        val = dateStr;
      } else if (lowerVar.includes('track') || lowerVar.includes('awb')) {
        val = trackNum;
      } else if (lowerVar.includes('url') || lowerVar.includes('link')) {
        val = linkUrl;
      } else {
        val = defaultSeq[i] !== undefined ? defaultSeq[i] : (i === 0 ? custName : (i === 1 ? orderNum : totalAmt));
      }
    }

    out.push({ name: rawVarName, isNumeric: /^\d+$/.test(rawVarName), value: String(val).trim() });
  }
  return out;
}

/**
 * Example event data for the dashboard preview of each automation, so a preview shows what that template would
 * really say ("Your order ZB72210 …", "₹250 store credit …") with the same mapping the sender uses.
 */
export const PREVIEW_EVENT_DATA = {
  customerName: 'Aarav',
  orderId: 'ZB72210',
  totalAmount: '1,499',
  itemCount: 2,
  trackingNumber: 'ZB-TRACK-123',
  trackingUrl: 'https://zicabella.com/orders/ZB72210',
  orderStatusUrl: 'https://zicabella.com/orders/ZB72210',
  checkoutUrl: 'https://zicabella.com/cart',
  productName: 'Chainster Zip Shirt',
  discountCode: 'ZICA10',
  refundAmount: '₹1,499',
  collectionName: 'Frame Shift',
  discountPercent: '30',
  newItemName: 'Chainster Zip Shirt (M)',
  daysLeft: 15,
  expiryDate: '20 January 2027',
  deliveryDate: '12 November 2026',
};

/** Events where the "amount" is a store credit / coins amount rather than the order total. */
const CREDIT_AMOUNT_EVENTS = ['store_credit_earned', 'store_coins_earned', 'order_confirmed_prepaid', 'store_credit_expiring'];

/** Preview data for one event (the credit events show a credit amount, the others the order total). */
export function previewDataFor(eventType) {
  return CREDIT_AMOUNT_EVENTS.includes(eventType) ? { ...PREVIEW_EVENT_DATA, totalAmount: '250' } : { ...PREVIEW_EVENT_DATA };
}

/** `template_order_shipped` -> 'order_shipped'; the two settings whose key differs from the sender's event name. */
export function eventTypeFromTemplateKey(templateKey) {
  const key = String(templateKey || '').replace(/^template_/, '');
  const renamed = { return_pickup: 'return_pickup_scheduled', exchange_pickup: 'exchange_pickup_scheduled' };
  return renamed[key] || key;
}
