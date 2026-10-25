import {
  isCodAllowedForCountry,
  normalizeCountryCode,
  resolveCheckoutCountry,
} from "../lib/cod-availability";
import { formatPriceWithConfig, type CountryPricingConfig } from "../lib/global-pricing-client";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

eq("India code", isCodAllowedForCountry("IN"), true);
eq("India name", isCodAllowedForCountry("India"), true);
eq("US", isCodAllowedForCountry("US"), false);
eq("United Kingdom", isCodAllowedForCountry("United Kingdom"), false);
eq("GB", isCodAllowedForCountry("GB"), false);
eq("UK alias", normalizeCountryCode("UK"), "GB");

eq(
  "US market from displayCountry",
  resolveCheckoutCountry({ displayCountry: "US", address: { country: "India", countryCode: "IN" } }),
  "US"
);
eq(
  "GB from address",
  resolveCheckoutCountry({ address: { country: "United Kingdom", phone: "+447700900123" } }),
  "GB"
);

const countries: CountryPricingConfig[] = [
  { code: "IN", name: "India", currencyCode: "INR", currencySymbol: "₹", locale: "en-IN", isBase: true, multiplier: 1, exchangeRate: 1, isActive: true, sortOrder: 0 },
  { code: "US", name: "United States", currencyCode: "USD", currencySymbol: "$", locale: "en-US", isBase: false, multiplier: 2.5, exchangeRate: 0.012, isActive: true, sortOrder: 1 },
  { code: "GB", name: "United Kingdom", currencyCode: "GBP", currencySymbol: "£", locale: "en-GB", isBase: false, multiplier: 2.5, exchangeRate: 0.0094, isActive: true, sortOrder: 2 },
];
const sample = 1499;
for (const c of countries) {
  const got = formatPriceWithConfig(sample, c, true);
  const want = c.isBase ? sample : Math.round(sample * c.multiplier * c.exchangeRate * 100) / 100;
  eq(`${c.code} ${sample} INR`, [got.amount, got.currencyCode], [want, c.currencyCode]);
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nAll checks passed");
