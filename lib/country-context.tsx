"use client";

/**
 * Country Context — Provides the selected country and pricing config
 * to all client-side storefront components.
 *
 * The provider is mounted in the storefront layout. It reads the `zb_country`
 * cookie client-side and fetches the pricing config from a lightweight API.
 * Components use `useCountryPrice(basePriceINR)` to get formatted prices.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import type { CountryPricingConfig, DisplayPrice } from "@/lib/global-pricing-client";
import { formatPriceWithConfig } from "@/lib/global-pricing-client";

interface CountryContextValue {
  /** Currently selected country code (ISO 3166-1 alpha-2) */
  countryCode: string;
  /** Pricing config for the selected country (null if not yet loaded) */
  countryConfig: CountryPricingConfig | null;
  /** Whether the global store feature is enabled */
  globalStoreEnabled: boolean;
  /** All active countries for the switcher UI */
  activeCountries: CountryPricingConfig[];
  /** Whether the config is still loading */
  isLoading: boolean;
  /** Switch to a different country — sets cookie + reloads pricing */
  setCountry: (code: string) => void;
  /** Format a base INR price for the currently selected country */
  formatPrice: (basePriceINR: number) => DisplayPrice;
}

const CountryContext = createContext<CountryContextValue>({
  countryCode: "IN",
  countryConfig: null,
  globalStoreEnabled: false,
  activeCountries: [],
  isLoading: true,
  setCountry: () => {},
  formatPrice: (basePriceINR: number) => ({
    amount: basePriceINR,
    formatted: `₹${basePriceINR.toLocaleString("en-IN")}`,
    currencyCode: "INR",
    currencySymbol: "₹",
    countryCode: "IN",
  }),
});

export function useCountry() {
  return useContext(CountryContext);
}

/**
 * Convenience hook: pass a base INR price, get back the formatted display price
 * for the currently selected country. Zero-change for India.
 */
export function useCountryPrice(basePriceINR: number): DisplayPrice {
  const { formatPrice } = useCountry();
  return formatPrice(basePriceINR);
}

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name: string, value: string, days = 365) {
  if (typeof document === "undefined") return;
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires};path=/;SameSite=Lax`;
}

interface CountryProviderProps {
  children: ReactNode;
  /** Server-resolved initial country code (from cookie or IP geo) */
  initialCountryCode?: string;
  /** Server-fetched pricing data to avoid client-side fetch on initial render */
  initialConfig?: {
    globalStoreEnabled: boolean;
    countries: CountryPricingConfig[];
  };
}

export function CountryProvider({
  children,
  initialCountryCode = "IN",
  initialConfig,
}: CountryProviderProps) {
  const [countryCode, setCountryCode] = useState(initialCountryCode);
  const [globalStoreEnabled, setGlobalStoreEnabled] = useState(
    initialConfig?.globalStoreEnabled ?? false
  );
  const [activeCountries, setActiveCountries] = useState<CountryPricingConfig[]>(
    initialConfig?.countries ?? []
  );
  const [isLoading, setIsLoading] = useState(!initialConfig);

  // Find config for current country
  const countryConfig =
    activeCountries.find((c) => c.code === countryCode) || null;

  // Fetch pricing config if not provided server-side (single-flight + TTL)
  useEffect(() => {
    if (initialConfig) return;
    let cancelled = false;
    (async () => {
      try {
        const { fetchGlobalStoreConfig } = await import("@/lib/storefront-fetch");
        const data = await fetchGlobalStoreConfig();
        if (!cancelled && data) {
          setGlobalStoreEnabled(data.globalStoreEnabled ?? false);
          const countries: CountryPricingConfig[] = data.countries ?? [];
          setActiveCountries(countries);

          // Auto-detection logic: if no cookie is set, use detected country from server
          const cookieCountry = getCookie("zb_country");
          if (!cookieCountry && data.detectedCountryCode) {
            const isValid = countries.some((c) => c.code === data.detectedCountryCode);
            if (isValid) {
              setCountryCode(data.detectedCountryCode);
              setCookie("zb_country", data.detectedCountryCode);
            }
          } else if (cookieCountry) {
            const isValid = countries.some((c) => c.code === cookieCountry);
            if (isValid) {
              setCountryCode(cookieCountry);
            }
          }
        }
      } catch {
        // Fail silently — defaults to India pricing
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [initialConfig]);

  // Read country from cookie when activeCountries updates
  useEffect(() => {
    const cookieCountry = getCookie("zb_country");
    if (cookieCountry && cookieCountry !== countryCode) {
      const valid = activeCountries.some((c) => c.code === cookieCountry);
      if (valid) {
        setCountryCode(cookieCountry);
      }
    }
  }, [activeCountries]); // eslint-disable-line react-hooks/exhaustive-deps

  const setCountry = useCallback(
    (code: string) => {
      // Validate against active countries
      const valid = activeCountries.some((c) => c.code === code);
      if (!valid) return;
      setCookie("zb_country", code);
      setCountryCode(code);
    },
    [activeCountries]
  );

  const formatPriceFn = useCallback(
    (basePriceINR: number): DisplayPrice => {
      return formatPriceWithConfig(basePriceINR, countryConfig, globalStoreEnabled);
    },
    [countryConfig, globalStoreEnabled]
  );

  return (
    <CountryContext.Provider
      value={{
        countryCode,
        countryConfig,
        globalStoreEnabled,
        activeCountries,
        isLoading,
        setCountry,
        formatPrice: formatPriceFn,
      }}
    >
      {children}
    </CountryContext.Provider>
  );
}
