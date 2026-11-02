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
  await setTemplate(COINS, [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'You earned ₹{{1}} in Store Coins' }]);
  await t.sendStoreCoinsEarned({ phone: '919811122244', customerName: 'Aarav', orderId: 'ZB2', coinsAmount: 99 });
  eq('one variable: the coins amount', lastBody(), ['99']);
  eq('the COD template with an image header gets the same banner', lastHeader(), BANNER);

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
  await setTemplate(EXP, [{ type: 'BODY', text: 'YOUR STORE CREDIT IS EXPIRING SOON!\n\nHi {{1}},\n\nYou still have ₹{{2}} in available store credit.' }]);
  await expiring(); eq('the client\'s template, positional "Hi {{1}} ... ₹{{2}}": name then amount (no date)', lastBody(), ['Aarav', '250']);
  await setTemplate(EXP, [{ type: 'BODY', text: 'Hi {{customer_name}}, you still have ₹{{amount}} in store credit.' }]);
  await expiring(); eq('the client\'s template, named: {{customer_name}} and {{amount}}', lastBody(), ['Aarav', '250']);
  n = sent.length;
  const noDate: any = await expiring({ expiryDate: '' });
  check('missing expiry date: nothing is sent', noDate.success === false && sent.length === n, noDate);
  const noAmount: any = await expiring({ amount: 0 });
  check('zero amount: nothing is sent', noAmount.success === false && sent.length === n, noAmount);

  console.log('\n— 7. header image link set from the dashboard');
  const settingsApi = await import('../../app/api/whatsapp/settings/route.js');
  const postSettings = (body: any) => settingsApi.POST(new Request('https://zicabella.com/api/whatsapp/settings', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
  const EXPIRE_BANNER = 'https://cdn.shopify.com/s/files/1/0955/5394/5881/files/STORECREDIT-EXPIRES.png';
  await setTemplate(EXP, [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Hi {{customer_name}}, you still have ₹{{amount}}' }]);
  await expiring(); check('no link saved yet: the generic Zica logo goes out', /zica-bella-logo/.test(lastHeader() || ''), lastHeader());
  const bad: any = await postSettings({ header_image_store_credit_expiring: 'http://insecure.example/x.png' });
  check('a link that is not https is refused', bad.status === 400, bad.status);
  const worse: any = await postSettings({ header_image_store_credit_expiring: 'javascript:alert(1)' });
  check('a script link is refused', worse.status === 400, worse.status);
  const good: any = await postSettings({ header_image_store_credit_expiring: EXPIRE_BANNER });
  check('an https link is saved', good.status === 200, good.status);
  await expiring(); eq('the reminder now carries the saved banner', lastHeader(), EXPIRE_BANNER);
  await postSettings({ header_image_store_credit_earned: EXPIRE_BANNER });
  await setTemplate(NAME, [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Credit ₹ {{1}}' }]);
  await credit(250); eq('a saved link overrides the built-in banner', lastHeader(), EXPIRE_BANNER);
  await postSettings({ header_image_store_credit_earned: '' });
  await credit(250); eq('clearing it goes back to the built-in banner', lastHeader(), BANNER);

  console.log('\n— 8. the dashboard preview shows what is really sent');
  const { resolveBodyVariables, previewDataFor, eventTypeFromTemplateKey } = await import('../../lib/whatsapp/variable-mapping');
  const preview = (event: string, text: string) => resolveBodyVariables(event, text, previewDataFor(event)).map((v) => v.value);
  eq('8a: prepaid confirmation "order {{1}} … ₹{{2}}" → order number, credit (the client\'s screenshot)', preview('order_confirmed_prepaid', 'Your prepaid order {{1}} has been confirmed. ₹{{2}} in store credit'), ['ZB72210', '250']);
  eq('8b: prepaid store credit "₹{{1}}" → the credit amount, not the name', preview('store_credit_earned', 'YOUR STORE CREDIT: ₹{{1}}'), ['250']);
  eq('8c: COD store coins "₹{{1}}" → the amount', preview('store_coins_earned', 'You earned ₹{{1}}'), ['250']);
  eq('8d: expiry reminder "Hi {{1}}, ₹{{2}}" → name, amount', preview('store_credit_expiring', 'Hi {{1}}, you still have ₹{{2}}'), ['Aarav', '250']);
  eq('8e: standard order confirmation keeps name, order, total', preview('order_confirmed', 'Hi {{1}}, order {{2}} total {{3}}'), ['Aarav', 'ZB72210', '₹1,499']);
  eq('8f: named variables are filled in the preview too', preview('order_confirmed_prepaid', 'Order {{order_id}}: ₹{{amount}}'), ['ZB72210', '250']);
  // the sender produces the same values for the same data
  await setTemplate(PREPAID, [{ type: 'BODY', text: 'Your prepaid order {{1}} has been confirmed. ₹{{2}} in store credit' }]);
  await setSetting('order_confirmed_prepaid_enabled', 'true'); await setSetting('template_order_confirmed_prepaid', PREPAID);
  await confirm({ storeCreditAmount: 250, orderId: 'ZB72210' });
  eq('8g: what is really sent equals the preview', lastBody(), preview('order_confirmed_prepaid', 'Your prepaid order {{1}} has been confirmed. ₹{{2}} in store credit'));
  eq('8h: settings keys map to the sender\'s event names', ['template_order_confirmed_prepaid', 'template_store_credit_earned', 'template_return_pickup', 'template_exchange_pickup', 'template_out_for_delivery'].map(eventTypeFromTemplateKey), ['order_confirmed_prepaid', 'store_credit_earned', 'return_pickup_scheduled', 'exchange_pickup_scheduled', 'out_for_delivery']);

  console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'} — ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
