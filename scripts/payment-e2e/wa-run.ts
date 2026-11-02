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

  console.log(`\n${failed === 0 ? 'ALL PASSED' : 'FAILURES'} — ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
