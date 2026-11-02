/**
 * WhatsApp template variables for Store Credit / Store Coins: the number of {{n}} in the approved
 * template decides what each receives; the ₹ is never doubled; the header image is the banner.
 * Real template builder + sender, Meta faked (fetch). Other events are checked for unchanged mapping.
 *
 *   ZOHO_SMTP_HOST=127.0.0.1 ZOHO_SMTP_PORT=1 \
 *   NODE_OPTIONS="--require $PWD/scripts/payment-e2e/redirect-db.cjs" \
 *   npx tsx --tsconfig scripts/payment-e2e/tsconfig.json scripts/payment-e2e/wa-run.ts
 */
Object.assign(process.env, {
  NODE_ENV: 'test', WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_ACCESS_TOKEN: 'tok', WHATSAPP_BUSINESS_ACCOUNT_ID: '999',
  SHOPIFY_STORE_DOMAIN: 'x.myshopify.com', SHOPIFY_ADMIN_ACCESS_TOKEN: 't',
});
const BANNER = 'https://cdn.shopify.com/s/files/1/0955/5394/5881/files/STORECREDIT.png?v=1793657600';
const sent: any[] = [];
(globalThis as any).fetch = async (url: string, opt: any = {}) => {
  if (String(url).includes('/messages') && opt.body) { try { sent.push(JSON.parse(opt.body)); } catch { /* not JSON */ } }
  return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }], data: [] }), text: async () => '{}', headers: new Map() };
};

let failed = 0, passed = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
};
const eq = (label: string, got: unknown, want: unknown) => check(label, JSON.stringify(got) === JSON.stringify(want), { got, want });

async function main() {
  const { default: prisma } = await import('./memory-prisma');
  (globalThis as any).__zbSettingsFromDb = true; // getWhatsAppSetting reads the seeded settings rows
  const setSetting = async (key: string, value: string) => { await prisma.whatsAppSetting.deleteMany({ where: { key } }).catch(() => {}); await prisma.whatsAppSetting.create({ data: { key, value } }); };
  const t = await import('../../lib/whatsapp/templates.js');
  const NAME = 'zb_store_credit_earned';
  const COINS = 'zb_store_coins_earned';
  async function setTemplate(name: string, components: any[]) {
    await prisma.whatsAppTemplate.deleteMany({ where: { name } }).catch(() => {});
    await prisma.whatsAppTemplate.create({ data: { name, category: 'UTILITY', language: 'en', status: 'APPROVED', components } });
  }
  const lastBody = () => sent[sent.length - 1]?.template?.components?.find((c: any) => c.type === 'body')?.parameters?.map((p: any) => p.text);
  const lastHeader = () => sent[sent.length - 1]?.template?.components?.find((c: any) => c.type === 'header')?.parameters?.[0]?.image?.link;
  const credit = (amount = 250) => t.sendStoreCreditEarned({ phone: '919811122244', customerName: 'Aarav', orderId: 'ZB1', creditAmount: amount });

  console.log('\n— 1. the client\'s template: one variable, "₹ {{1}}", image header');
  await setTemplate(NAME, [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'YOU JUST UNLOCKED A REWARD!\n\n🎁 YOUR STORE CREDIT: ₹ {{1}}\n\nTEAM ZICA BELLA' }]);
  await credit(250);
  eq('{{1}} is the amount as a plain number (no name, no doubled ₹)', lastBody(), ['250']);
  eq('header image is the 10% STORE CREDIT banner', lastHeader(), BANNER);
  await credit(1250.5);
  eq('amounts use Indian grouping', lastBody(), ['1,250.5']);

  console.log('\n— 2. other variable layouts');
  await setTemplate(NAME, [{ type: 'BODY', text: 'Hi {{1}}, you earned ₹{{2}} on order {{3}}' }]);
  await credit(250); eq('3 variables: name, amount, order (₹ already in the text)', lastBody(), ['Aarav', '250', 'ZB1']);
  await setTemplate(NAME, [{ type: 'BODY', text: 'Hi {{1}}, you earned {{2}} on order {{3}}' }]);
  await credit(250); eq('3 variables, no ₹ in the text: the amount carries its own ₹', lastBody(), ['Aarav', '₹250', 'ZB1']);
  await setTemplate(NAME, [{ type: 'BODY', text: 'Hi {{1}}, your credit is {{2}}' }]);
  await credit(250); eq('2 variables: name, amount', lastBody(), ['Aarav', '₹250']);
  await setTemplate(NAME, [{ type: 'BODY', text: 'Your credit is ₹{{amount}} (order {{order_id}})' }]);
  await credit(250); eq('named variables: {{amount}} and {{order_id}}', lastBody(), ['250', 'ZB1']);
  await setTemplate(NAME, [{ type: 'BODY', text: 'Hi {{customer_name}}, credit {{credit_amount}}' }]);
  await credit(250); eq('named variables: {{customer_name}} and {{credit_amount}}', lastBody(), ['Aarav', '₹250']);

  await setTemplate(NAME, [{ type: 'BODY', text: "Your prepaid order {{order_id}} is Confirmed.\n\nYOU'RE IN.\n\nYou've just earned 10% STORE CREDIT on your prepaid order.\n\n🎁 YOUR STORE CREDIT: ₹ {{amount}}\n\nWe'll let you know when it's on the move." }]);
  await credit(250); eq('the client\'s prepaid-confirmation template: {{order_id}} then {{amount}}', lastBody(), ['ZB1', '250']);

  console.log('\n— 3. Store Coins (COD) uses the same rules');
  await setTemplate(COINS, [{ type: 'BODY', text: 'You earned ₹{{1}} in Store Coins' }]);
  await t.sendStoreCoinsEarned({ phone: '919811122244', customerName: 'Aarav', orderId: 'ZB2', coinsAmount: 99 });
  eq('one variable: the coins amount', lastBody(), ['99']);

  console.log('\n— 4. nothing sent without an amount; other events unchanged');
  const before = sent.length;
  const r: any = await credit(NaN as any);
  check('missing amount: nothing is sent', r.success === false && sent.length === before, r);
  await setTemplate('zica_order_confirmed_v1', [{ type: 'BODY', text: 'Hi {{1}}, order {{2}} total {{3}}' }]);
  await t.sendOrderConfirmation({ phone: '919811122244', customerName: 'Aarav', orderId: 'ZB9', totalAmount: 1499, itemCount: 2 });
  eq('order confirmed keeps its name / order / total mapping', lastBody(), ['Aarav', 'ZB9', '₹1499']);

  console.log('\n— 5. prepaid order confirmation that names the store credit');
  const PREPAID = 'order_confirmed_prepaid_v1';
  await setTemplate(PREPAID, [{ type: 'BODY', text: 'Your order {{order_id}} is confirmed. You have earned ₹ {{amount}} store credit.' }]);
  await setTemplate('zica_order_confirmed_v1', [{ type: 'BODY', text: 'Hi {{1}}, order {{2}} total {{3}}' }]);
  const confirm = (extra: any = {}) => t.sendOrderConfirmation({ phone: '919811122244', customerName: 'Aarav', orderId: 'ZB7', totalAmount: 1499, itemCount: 1, ...extra });
  const lastTemplate = () => sent[sent.length - 1]?.template?.name;

  let n = sent.length;
  await confirm({ storeCreditAmount: 150 });
  eq('setting empty: the standard confirmation is sent even when credit was earned', [lastTemplate(), lastBody()], ['zica_order_confirmed_v1', ['Aarav', 'ZB7', '₹1499']]);
  await setSetting('template_order_confirmed_prepaid', PREPAID);
  await confirm({ storeCreditAmount: 150 });
  eq('template set but the automation switched OFF (default): the standard confirmation', lastTemplate(), 'zica_order_confirmed_v1');
  await setSetting('order_confirmed_prepaid_enabled', 'true');
  await confirm({ storeCreditAmount: 150 });
  eq('prepaid + credit: the new template with the ORDER number and the CREDIT (not the order total)', [lastTemplate(), lastBody()], [PREPAID, ['ZB7', '150']]);
  await confirm({ storeCreditAmount: 1250.5 });
  eq('credit uses Indian grouping', lastBody(), ['ZB7', '1,250.5']);
  n = sent.length;
  await confirm({ storeCreditAmount: 0 });
  eq('no credit earned: the standard confirmation', lastTemplate(), 'zica_order_confirmed_v1');
  await confirm({});
  eq('credit unknown: the standard confirmation', lastTemplate(), 'zica_order_confirmed_v1');
  await setSetting('template_order_confirmed_prepaid', 'does_not_exist_v1');
  await confirm({ storeCreditAmount: 150 });
  eq('prepaid template missing in Meta: falls back to the standard confirmation (never nothing)', lastTemplate(), 'zica_order_confirmed_v1');
  await setSetting('template_order_confirmed_prepaid', PREPAID);
  await setTemplate(PREPAID, [{ type: 'BODY', text: 'Hi {{1}}, order {{2}}: you earned {{3}} store credit' }]);
  await confirm({ storeCreditAmount: 150 });
  eq('positional 3 variables: name, order, credit (credit carries its own ₹)', lastBody(), ['Aarav', 'ZB7', '₹150']);
  await setTemplate(PREPAID, [{ type: 'BODY', text: 'Order {{1}}: ₹{{2}} store credit' }]);
  await confirm({ storeCreditAmount: 150 });
  eq('positional 2 variables: order, credit', lastBody(), ['ZB7', '150']);

  // credit lookup for an order
  const { getStoreCreditEarnedForOrder } = await import('../../lib/storeCreditsHelper');
  await prisma.storeCredit.create({ data: { customerId: 'c1', amount: 100, type: 'PENDING_COUPON_REBATE', description: 'x', orderId: 'ord_A', remainingAmount: 100 } });
  await prisma.storeCredit.create({ data: { customerId: 'c1', amount: 50, type: 'DEBIT', description: 'spent', orderId: 'ord_A', remainingAmount: 0 } });
  await prisma.storeCredit.create({ data: { customerId: 'c2', amount: 70, type: 'COUPON_REBATE', description: 'y', orderId: 'ord_B', remainingAmount: 70 } });
  eq('credit earned by an order counts only its own rebate rows', [await getStoreCreditEarnedForOrder('ord_A'), await getStoreCreditEarnedForOrder('ord_B'), await getStoreCreditEarnedForOrder('ord_C'), await getStoreCreditEarnedForOrder('')], [100, 70, 0, 0]);

  console.log('\n— 6. store credit expiring reminder');
  const EXP = 'zb_store_credit_expiring';
  const expiring = (extra: any = {}) => t.sendStoreCreditExpiring({ phone: '919811122244', customerName: 'Aarav', amount: 250, expiryDate: '20 January 2027', daysLeft: 15, ...extra });
  await setTemplate(EXP, [{ type: 'BODY', text: 'You have ₹{{amount}} store credit expiring on {{expiry_date}}. Use it before it is gone.' }]);
  await expiring(); eq('named {{amount}} + {{expiry_date}}', [lastTemplate(), lastBody()], [EXP, ['250', '20 January 2027']]);
  await setTemplate(EXP, [{ type: 'BODY', text: 'Hi {{customer_name}}, ₹{{amount}} expires on {{expiry_date}} ({{days_left}} days left)' }]);
  await expiring(); eq('name, amount, expiry date and days left by name', lastBody(), ['Aarav', '250', '20 January 2027', '15']);
  await setTemplate(EXP, [{ type: 'BODY', text: 'Your store credit: {{1}} expires {{2}}' }]);
  await expiring(); eq('positional 2 variables: amount (with ₹), expiry date', lastBody(), ['₹250', '20 January 2027']);
  await setTemplate(EXP, [{ type: 'BODY', text: 'Hi {{1}}, {{2}} expires {{3}}' }]);
  await expiring(); eq('positional 3 variables: name, amount, expiry date', lastBody(), ['Aarav', '₹250', '20 January 2027']);
  n = sent.length;
  const noDate: any = await expiring({ expiryDate: '' });
  check('missing expiry date: nothing is sent', noDate.success === false && sent.length === n, noDate);
  const noAmount: any = await expiring({ amount: 0 });
  check('zero amount: nothing is sent', noAmount.success === false && sent.length === n, noAmount);

  console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'} — ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
