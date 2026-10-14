/**
 * Meta funnel money (lib/meta/money.ts) + contents shape (hooks/useMetaEvents.ts):
 * ViewContent / AddToCart / InitiateCheckout / AddPaymentInfo report the money the
 * shopper sees (global store: INR × multiplier × FX in the local currency), and
 * India stays byte-identical to the INR base. `contents` objects carry only the
 * documented keys.
 *
 *   npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/verify-meta-funnel-money.ts
 */
process.env.NEXT_PUBLIC_META_PIXEL_ID = '2049977412558608';

import { formatPriceWithConfig, type CountryPricingConfig } from '../lib/global-pricing-client';
import { metaMoneyFrom, META_INR } from '../lib/meta/money';

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}`, detail !== undefined ? JSON.stringify(detail) : ''); }
}

const GB: CountryPricingConfig = {
  code: 'GB', name: 'United Kingdom', currencyCode: 'GBP', currencySymbol: '£', locale: 'en-GB',
  isBase: false, multiplier: 2.5, exchangeRate: 0.0094, isActive: true, sortOrder: 2,
};
const IN: CountryPricingConfig = { ...GB, code: 'IN', name: 'India', currencyCode: 'INR', currencySymbol: '₹', locale: 'en-IN', isBase: true, multiplier: 1, exchangeRate: 1, sortOrder: 1 };

async function main() {
  const { metaCartPayload, metaContents } = await import('../hooks/useMetaEvents');

  // India / global store off: identity.
  const inMoney = metaMoneyFrom((inr) => formatPriceWithConfig(inr, IN, true));
  check('IN: currency INR', inMoney.currency === 'INR');
  check('IN: amount unchanged', inMoney.amount(1499) === 1499);
  const offMoney = metaMoneyFrom((inr) => formatPriceWithConfig(inr, GB, false));
  check('global store off: INR identity even for a GB config', offMoney.currency === 'INR' && offMoney.amount(1499) === 1499);
  check('no formatPrice at all: INR identity', metaMoneyFrom(undefined).currency === 'INR' && META_INR.amount(10) === 10);

  // GB: the displayed money (same formula Razorpay charges: lib/global-pricing).
  const gbMoney = metaMoneyFrom((inr) => formatPriceWithConfig(inr, GB, true));
  check('GB: currency GBP', gbMoney.currency === 'GBP');
  check('GB: 1499 INR → 35.23 GBP (2.5 × 0.0094, 2 decimals)', gbMoney.amount(1499) === 35.23, gbMoney.amount(1499));

  // Cart payload converts each line's price; ids / units untouched.
  const items = [
    { variantId: 'gid://shopify/ProductVariant/51813148262681', quantity: 2, price: '1499', title: 'A', category: 'Denim' },
    { variantId: '51813148328217', quantity: 1, price: 799, title: 'B', category: 'Tees' },
  ];
  const inCart = metaCartPayload(items, inMoney);
  check('IN cart: INR prices, variant ids, 3 units', inCart.contents[0].item_price === 1499 && inCart.contents[1].item_price === 799 && inCart.ids.join() === '51813148262681,51813148328217' && inCart.numItems === 3, inCart);
  const legacy = metaCartPayload(items);
  check('cart without money arg = INR (unchanged call sites)', JSON.stringify(legacy) === JSON.stringify(inCart));
  const gbCart = metaCartPayload(items, gbMoney);
  check('GB cart: converted line prices', gbCart.contents[0].item_price === 35.23 && gbCart.contents[1].item_price === 18.78, gbCart.contents);

  // Meta contents shape: id / quantity / item_price only (+ delivery_category when asked).
  const meta = metaContents(gbCart.contents);
  check('contents: only id, quantity, item_price', meta.every(c => Object.keys(c).sort().join() === 'id,item_price,quantity'), meta);
  const purchase = metaContents([{ id: '1', quantity: 2, price: 10 }], undefined, 'home_delivery');
  check('contents: legacy price key mapped to item_price, delivery_category added', purchase[0].item_price === 10 && purchase[0].delivery_category === 'home_delivery' && !('price' in purchase[0]), purchase);
  check('contents: missing price → even share of the value', metaContents([{ id: 'x' }, { id: 'y' }], 50)[1].item_price === 50);
  check('contents: empty / id-less lines dropped', metaContents([{ id: '' }, { id: 'ok' }]).length === 1);

  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
