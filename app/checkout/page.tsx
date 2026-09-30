"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCart } from "@/lib/cart-context";
import { useMetaEvents } from "@/hooks/useMetaEvents";
import { useSnapEvents } from "@/hooks/useSnapEvents";
import { useOpenAiEvents } from "@/hooks/useOpenAiEvents";
import { trackStorefrontEvent } from "@/lib/track-client";
import { trackBeginCheckout as zbTrackBeginCheckout, trackPaymentInitiated as zbTrackPaymentInitiated } from "@/lib/analytics-tracker";
import { saveUserDataToCookiesAndReinit, getClientCookie } from "@/lib/metaPixel";
import { motion, AnimatePresence } from "framer-motion";
import {
  MapPin,
  CreditCard,
  Truck,
  ShieldCheck,
  Plus,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Tag,
  X,
  ShoppingBag,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Home,
  Navigation,
  Building2,
  Banknote,
  Smartphone,
  Sparkles,
  Lock,
  Sun,
  User,
  Mail,
  Globe,
  Map,
  Folder,
  Wallet
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { useTheme } from "next-themes";
import { useCountry } from "@/lib/country-context";
import { toast } from "sonner";
import { loadGoogleMaps, dismissGoogleMapsErrors, resetGoogleMaps, getLoadedLibrary, hasGoogleMapsAuthFailed } from "@/lib/googleMapsLoader";
import { formatPriceString } from "@/lib/global-pricing-client";
import {
  COUNTRIES,
  INDIAN_STATES,
  matchIndianState,
  isIndia,
  findCountry,
  validatePostalCode,
  validatePhoneNumber,
} from "@/lib/countries";

type Address = {
  name: string;
  email: string;
  phone: string;
  houseNo: string;
  street: string;
  landmark: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  countryCode?: string;
  lat?: number;
  lng?: number;
  placeId?: string;
};

type DBAddress = {
  id: string;
  name: string;
  phone: string;
  email: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  countryCode?: string;
  isDefault: boolean;
  lat?: number | null;
  lng?: number | null;
  placeId?: string | null;
};

type PaymentMethod = "PAYNOW" | "COD" | "CARD" | "UPI" | "PAYLATER" | "EMI";

interface GoogleAddressComponent {
  long_name?: string;
  short_name?: string;
  longText?: string;
  shortText?: string;
  types: string[];
}

const parseAddressComponents = (components: GoogleAddressComponent[]) => {
  let city = "";
  let district = "";
  let state = "";
  let pincode = "";
  let country = "";
  let countryCode = "";
  
  let streetNumber = "";
  let premise = "";
  let subpremise = "";
  let route = "";
  let sublocality3 = "";
  let sublocality2 = "";
  let sublocality1 = "";
  let sublocality = "";
  let neighborhood = "";

  components.forEach(comp => {
    const name = comp.long_name || comp.longText || comp.short_name || comp.shortText || "";
    const shortName = comp.short_name || comp.shortText || name;
    const types = comp.types || [];

    if (types.includes("postal_code")) {
      pincode = name;
    } else if (types.includes("administrative_area_level_1")) {
      state = name;
    } else if (types.includes("locality")) {
      city = name;
    } else if (types.includes("administrative_area_level_2")) {
      district = name;
    } else if (types.includes("sublocality_level_3")) {
      sublocality3 = name;
    } else if (types.includes("sublocality_level_2")) {
      sublocality2 = name;
    } else if (types.includes("sublocality_level_1")) {
      sublocality1 = name;
    } else if (types.includes("sublocality")) {
      sublocality = name;
    } else if (types.includes("neighborhood")) {
      neighborhood = name;
    } else if (types.includes("route")) {
      route = name;
    } else if (types.includes("street_number")) {
      streetNumber = name;
    } else if (types.includes("premise")) {
      premise = name;
    } else if (types.includes("subpremise")) {
      subpremise = name;
    } else if (types.includes("country")) {
      country = name;
      countryCode = shortName.toUpperCase();
    }
  });

  const finalCity = city || district || sublocality1 || sublocality || "";

  const streetParts = [
    subpremise,
    premise,
    streetNumber,
    route,
    sublocality3,
    sublocality2,
    sublocality1,
    sublocality,
    neighborhood
  ].filter(Boolean);
  
  const uniqueStreetParts = streetParts.filter((item, index) => streetParts.indexOf(item) === index);
  const streetName = uniqueStreetParts.join(", ");

  let matchedState = "";
  if (state && isIndia(country, countryCode)) {
    const lowerState = state.toLowerCase().trim();
    const found = INDIAN_STATES.find(s =>
      s.toLowerCase() === lowerState ||
      lowerState.includes(s.toLowerCase()) ||
      s.toLowerCase().includes(lowerState)
    );
    if (found) matchedState = found;
  }

  const cleanPincode = isIndia(country, countryCode)
    ? pincode.replace(/\s/g, "").slice(0, 6)
    : pincode.trim();

  return {
    city: finalCity,
    state: matchedState || state,
    pincode: cleanPincode,
    streetName,
    country: country || (isIndia(country, countryCode) ? "India" : country),
    countryCode
  };
};

/* ─── Validation helpers ────────────────────────────────────── */
const BLOCKED_CHARS = /[`~!@#$%^&*()_+={}[\]|\\:;"'<>?/]/g;
const sanitizeAddress = (val: string) => val.replace(BLOCKED_CHARS, "");
const isValidAddressField = (val: string, minLen = 2) => val.trim().length >= minLen;

export default function CheckoutPage() {
  const { countryCode, countryConfig, globalStoreEnabled, formatPrice: fmtPrice } = useCountry();
  const isInternational = Boolean(
    globalStoreEnabled && countryCode !== "IN" && countryConfig && !countryConfig.isBase
  );

  const fmtAmount = useCallback(
    (basePriceINR: number): string => {
      return fmtPrice(basePriceINR).formatted;
    },
    [fmtPrice]
  );
  const { data: session, status } = useSession();
  const { items, subtotal, clear, isLoaded: cartLoaded } = useCart();
  const router = useRouter();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const { trackInitiateCheckout, trackAddPaymentInfo } = useMetaEvents();
  const { trackStartCheckout: trackSnapStartCheckout, trackAddBilling: trackSnapAddBilling } = useSnapEvents();
  const { trackCheckoutStarted: trackOaiCheckoutStarted } = useOpenAiEvents();

  const initialName = session?.user?.name || "";
  const isPhoneName = /^\+?[0-9\s\-]{8,15}$/.test(initialName.trim());
  const [address, setAddress] = useState<Address>({
    name: isPhoneName ? "" : initialName,
    email: session?.user?.email || "",
    phone: (session as any)?.customer?.phone || "",
    houseNo: "",
    street: "",
    landmark: "",
    city: "",
    state: "",
    zip: "",
    country: "India",
    lat: undefined,
    lng: undefined,
    placeId: undefined,
  });

  const [googleMapsLoaded, setGoogleMapsLoaded] = useState(false);
  const [googleMapsError, setGoogleMapsError] = useState(false);
  const autocompleteInputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<any>(null);

  const [step, setStep] = useState(1); // 1: Address, 2: Payment
  const [loading, setLoading] = useState(false);

  // Sync cart contact details (email, phone, name) in background as user fills checkout form
  useEffect(() => {
    if ((address.email || address.phone) && items.length > 0) {
      const syncCheckoutDetails = async () => {
        try {
          const guestId = getClientCookie("zb_device_id");
          const { getTrafficSource } = await import("@/lib/traffic-source");
          const trafficSource = getTrafficSource();

          await fetch("/api/cart/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items,
              guestId,
              name: address.name || undefined,
              email: address.email || undefined,
              phone: address.phone || undefined,
              source: trafficSource
            }),
          });
        } catch (e) {
          console.error("Failed to sync checkout details to cart session:", e);
        }
      };

      const timer = setTimeout(syncCheckoutDetails, 1000);
      return () => clearTimeout(timer);
    }
  }, [address.email, address.phone, address.name, items]);
  const [error, setError] = useState("");

  // Clear error automatically after 4 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => {
        setError("");
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [error]);
  const [initiatedPixel, setInitiatedPixel] = useState(false);
  const [paymentInfoFired, setPaymentInfoFired] = useState(false);
  const [isOrderPlaced, setIsOrderPlaced] = useState(false);

  // Saved addresses
  const [savedAddresses, setSavedAddresses] = useState<DBAddress[]>([]);
  const [addressesLoaded, setAddressesLoaded] = useState(false);
  const [selectedSavedId, setSelectedSavedId] = useState<string>("");
  const [showAddressForm, setShowAddressForm] = useState(false);
  const [prefetchedOrder, setPrefetchedOrder] = useState<{
    id: string;
    amount: number;
    keyId: string;
  } | null>(null);

  const paymentLockRef = useRef<boolean>(false);

  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    setMounted(true);
  }, []);



  useEffect(() => {
    const canFire = status === "unauthenticated" || (status === "authenticated" && addressesLoaded);

    if (items.length > 0 && !initiatedPixel && canFire) {
      setInitiatedPixel(true);
      const joinedCategories = items.map(item => item.category).filter(Boolean).join(', ') || undefined;
      const contentIds = items.map(item => item.productId);
      const contents = items.map(item => ({
        id: item.productId,
        quantity: item.quantity,
        item_price: parseFloat(item.price),
        title: item.title,
        category: item.category
      }));

      // Parse the pre-filled/saved address state into userData
      let userData: any = undefined;
      if (address.email || address.phone || address.city) {
        const nameParts = (address.name || "").trim().split(/\s+/);
        const fn = nameParts[0] || undefined;
        const ln = nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined;
        userData = {
          country: address.country || undefined,
          st: address.state || undefined,
          ct: address.city || undefined,
          zp: address.zip || undefined,
          fn,
          ln,
          em: address.email || undefined,
          ph: address.phone || undefined,
        };
      }

      trackInitiateCheckout(subtotal, items.length, 'INR', joinedCategories, contentIds, userData, contents);
      trackSnapStartCheckout(subtotal, items.length, 'INR', joinedCategories, contentIds, userData);
      trackOaiCheckoutStarted(subtotal, items.length, 'INR', joinedCategories, contentIds, userData);
      zbTrackBeginCheckout(subtotal, { num_items: items.length, currency: 'INR' });

      // Track Checkout Started event server-side
      trackStorefrontEvent('Checkout Started', {
        customerId: (session?.user as any)?.id || null,
        customerPhone: address.phone || null,
        metadata: {
          num_items: items.length,
          value: subtotal,
          currency: "INR",
          content_ids: contentIds
        }
      });
    }
  }, [items, subtotal, initiatedPixel, session, address, status, addressesLoaded]);


  const [addressErrors, setAddressErrors] = useState<Record<string, string>>({});
  const [zipLoading, setZipLoading] = useState(false);
  const [locating, setLocating] = useState(false);

  // Address search suggestions & dropdown state
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Array<{
    placeId: string;
    displayName: string;
    mainText: string;
    secondaryText: string;
    street: string;
    landmark: string;
    city: string;
    state: string;
    zip: string;
    country: string;
    countryCode: string;
    lat: number;
    lng: number;
  }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Load Google Maps API via the singleton loader (setOptions called once globally)
  useEffect(() => {
    if (googleMapsLoaded) return;

    loadGoogleMaps(['places', 'geocoding'])
      .then((ok) => {
        if (ok) {
          setGoogleMapsLoaded(true);
          setGoogleMapsError(false);
        } else {
          console.warn("Google Maps failed to load (missing key or auth error). Falling back to Nominatim + IP geo.");
          dismissGoogleMapsErrors();
          setGoogleMapsError(true);
        }
      })
      .catch((err) => {
        console.error("Failed to load Google Maps script:", err);
        dismissGoogleMapsErrors();
        setGoogleMapsError(true);
      });
  }, [googleMapsLoaded]);

  // Initialize Place Autocomplete
  useEffect(() => {
    if (!googleMapsLoaded || !autocompleteInputRef.current) return;
    if (hasGoogleMapsAuthFailed()) return;

    let active = true;

    const initAutocomplete = async () => {
      try {
        if (hasGoogleMapsAuthFailed()) return;
        // Use the singleton loader — it's already loaded, this just awaits the same promise
        const mapsOk = await loadGoogleMaps(['places', 'geocoding']);
        if (!active || hasGoogleMapsAuthFailed() || !mapsOk) return;

        // Get Autocomplete from the cached library module (preferred) or fall back to global
        let AutocompleteClass: any = null;
        if (mapsOk) {
          const placesLib = getLoadedLibrary('places');
          AutocompleteClass = placesLib?.Autocomplete ?? (window as any).google?.maps?.places?.Autocomplete;
        }
        if (!AutocompleteClass || hasGoogleMapsAuthFailed()) {
          return;
        }

        const autocomplete = new AutocompleteClass(autocompleteInputRef.current, {
          fields: ["address_components", "geometry", "place_id", "formatted_address", "name"],
          types: ["geocode", "establishment"]
        });

        autocompleteRef.current = autocomplete;

        autocomplete.addListener("place_changed", () => {
          if (!active) return;
          const place = autocomplete.getPlace();
          if (!place || !place.address_components) return;

          const lat = place.geometry?.location?.lat();
          const lng = place.geometry?.location?.lng();
          const placeId = place.place_id;
          const components = place.address_components;

          const parsed = parseAddressComponents(components);

          let streetVal = parsed.streetName || address.street;
          if (!parsed.streetName && place.name) {
            const nameLower = place.name.toLowerCase();
            const cityLower = (parsed.city || "").toLowerCase();
            const stateLower = (parsed.state || "").toLowerCase();
            if (nameLower !== cityLower && nameLower !== stateLower && nameLower !== "india") {
              streetVal = place.name;
            }
          }

          setAddress(prev => ({
            ...prev,
            street: streetVal,
            city: parsed.city || prev.city,
            state: parsed.state || prev.state,
            zip: parsed.pincode || prev.zip,
            country: parsed.country || prev.country,
            countryCode: parsed.countryCode || prev.countryCode,
            lat: lat != null ? lat : prev.lat,
            lng: lng != null ? lng : prev.lng,
            placeId: placeId || prev.placeId,
          }));

          setAddressErrors(prev => {
            const next = { ...prev };
            delete next.street;
            delete next.city;
            delete next.state;
            delete next.zip;
            return next;
          });
        });
      } catch (err) {
        console.error("Error initializing Google Autocomplete:", err);
        dismissGoogleMapsErrors();
        setGoogleMapsError(true);
      }
    };

    initAutocomplete();

    return () => {
      active = false;
      if (autocompleteRef.current) {
        try {
          const googleObj = (window as any).google;
          if (googleObj && googleObj.maps && googleObj.maps.event) {
            googleObj.maps.event.clearInstanceListeners(autocompleteRef.current);
          }
        } catch (e) {
          console.error("Failed to clean up Google Autocomplete listeners:", e);
        }
      }
    };
  }, [googleMapsLoaded, showAddressForm]);

  // Dismiss search dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle address search suggestions via server-side /api/geo/suggest
  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    if (!value || value.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    searchDebounceRef.current = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const country = address.countryCode || "IN";
        const res = await fetch(`/api/geo/suggest?q=${encodeURIComponent(value.trim())}&country=${country}`);
        if (res.ok) {
          const data = await res.json();
          if (data.ok && Array.isArray(data.suggestions) && data.suggestions.length > 0) {
            setSuggestions(data.suggestions);
            setShowSuggestions(true);
          } else {
            setSuggestions([]);
          }
        }
      } catch (err) {
        console.warn("[Checkout] Suggest error:", err);
      } finally {
        setSearchLoading(false);
      }
    }, 280);
  };

  const handleSelectSuggestion = (suggestion: any) => {
    const matchedState = matchIndianState(suggestion.state);

    setAddress(prev => ({
      ...prev,
      street: suggestion.street || prev.street,
      landmark: suggestion.landmark || prev.landmark,
      city: suggestion.city || prev.city,
      state: matchedState || suggestion.state || prev.state,
      zip: suggestion.zip ? suggestion.zip.replace(/\s/g, "").slice(0, 6) : prev.zip,
      country: suggestion.country || prev.country,
      countryCode: suggestion.countryCode || prev.countryCode,
      lat: suggestion.lat || prev.lat,
      lng: suggestion.lng || prev.lng,
      placeId: suggestion.placeId || prev.placeId,
    }));

    setAddressErrors(prev => {
      const next = { ...prev };
      delete next.street;
      delete next.city;
      delete next.state;
      delete next.zip;
      return next;
    });

    if (autocompleteInputRef.current) {
      autocompleteInputRef.current.value = suggestion.displayName || suggestion.mainText;
    }
    setSearchQuery(suggestion.mainText);
    setShowSuggestions(false);
    toast.success("Address filled from selected location");
  };

  /**
   * Reverse-geocode via server-side endpoint (/api/geo/reverse).
   * Safely resolves address components with OpenStreetMap Nominatim / BigDataCloud
   * without browser CORS or unsafe User-Agent header issues.
   */
  const reverseGeocodeServer = async (latitude: number, longitude: number): Promise<boolean> => {
    try {
      const res = await fetch(`/api/geo/reverse?lat=${latitude}&lng=${longitude}`);
      if (!res.ok) return false;
      const data = await res.json();
      if (data && data.ok) {
        const matchedState = matchIndianState(data.state);
        const validZip = data.zip && data.zip !== '0' && data.zip !== 'null'
          ? data.zip.replace(/\s/g, "").slice(0, 6)
          : "";

        const resolvedStreet = data.street || data.landmark || (data.formattedAddress ? data.formattedAddress.split(",")[0].trim() : "");

        // Verify that meaningful address information was actually returned
        if (!data.city && !resolvedStreet && !matchedState) {
          return false;
        }

        if (autocompleteInputRef.current && (data.formattedAddress || resolvedStreet)) {
          autocompleteInputRef.current.value = data.formattedAddress || resolvedStreet;
        }

        setAddress(prev => ({
          ...prev,
          houseNo: data.houseNo || prev.houseNo,
          street: resolvedStreet || prev.street,
          landmark: data.landmark || prev.landmark,
          zip: validZip || prev.zip,
          city: data.city || prev.city,
          state: matchedState || prev.state || data.state,
          country: data.country || prev.country,
          countryCode: data.countryCode || prev.countryCode,
          lat: latitude,
          lng: longitude,
          placeId: data.placeId || prev.placeId,
        }));

        setAddressErrors(prev => {
          const next = { ...prev };
          if (resolvedStreet) delete next.street;
          if (data.city) delete next.city;
          if (matchedState || data.state) delete next.state;
          if (validZip) delete next.zip;
          return next;
        });

        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  /**
   * Fetch approximate location from /api/geo (IP-based). Used when GPS is
   * denied/unavailable or both Maps and reverse geocode fail.
   */
  const fetchIpGeoFallback = async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/geo');
      if (!res.ok) return false;
      const data = await res.json();
      if (!data.ok) return false;

      // If coordinates are available, attempt reverse geocoding to obtain street, city, pin code
      if (typeof data.lat === 'number' && typeof data.lng === 'number') {
        try {
          const revOk = await reverseGeocodeServer(data.lat, data.lng);
          if (revOk) return true;
        } catch {}
      }

      const matchedState = matchIndianState(data.region);
      const validZip = data.zip && data.zip !== '0' && data.zip !== 'null' ? String(data.zip).trim() : '';
      const fallbackStreet = data.city || '';

      if (autocompleteInputRef.current && data.city) {
        autocompleteInputRef.current.value = `${data.city}${data.region ? `, ${data.region}` : ''}`;
      }

      setAddress(prev => ({
        ...prev,
        street: prev.street || fallbackStreet,
        city: data.city || prev.city,
        state: matchedState || prev.state || data.region,
        zip: validZip || prev.zip,
        country: data.country || prev.country,
        countryCode: data.countryCode || prev.countryCode,
        lat: data.lat ?? prev.lat,
        lng: data.lng ?? prev.lng,
      }));

      setAddressErrors(prev => {
        const next = { ...prev };
        if (data.city) delete next.city;
        if (matchedState || data.region) delete next.state;
        if (validZip) delete next.zip;
        if (fallbackStreet || prev.street) delete next.street;
        return next;
      });

      return true;
    } catch {
      return false;
    }
  };

  const handleDetectLocation = async () => {
    setLocating(true);
    setError("");

    // Dismiss any lingering Google Maps error overlays
    dismissGoogleMapsErrors();

    // Helper to resolve coordinates via server reverse-geocoding
    const applyCoordinates = async (latitude: number, longitude: number): Promise<boolean> => {
      try {
        const revOk = await reverseGeocodeServer(latitude, longitude);
        if (revOk) {
          toast.success("Location detected successfully!");
          return true;
        }
      } catch (e) {
        console.warn("[Checkout] Server reverse-geocode error:", e);
      }
      return false;
    };

    // Helper for IP fallback
    const applyIpFallback = async (): Promise<boolean> => {
      try {
        const ipOk = await fetchIpGeoFallback();
        if (ipOk) {
          toast.success("Location detected successfully!");
          return true;
        }
      } catch (e) {
        console.warn("[Checkout] IP fallback error:", e);
      }
      return false;
    };

    // Fast check: if permission is already explicitly denied in browser, don't wait on GPS timeout
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      try {
        const perm = await navigator.permissions.query({ name: 'geolocation' as any });
        if (perm.state === 'denied') {
          console.log('[Checkout] Geolocation permission is denied. Using network location.');
          const ok = await applyIpFallback();
          setLocating(false);
          if (!ok) {
            toast.info("Please enter your address details manually.");
          }
          return;
        }
      } catch {
        // Permissions query unsupported — continue to standard flow
      }
    }

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      const ok = await applyIpFallback();
      setLocating(false);
      if (!ok) {
        toast.info("Please enter your address details manually.");
      }
      return;
    }

    // Try browser geolocation with a snappy 2000ms hard timer so user experience is instant
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        const hardTimer = setTimeout(() => {
          reject(new Error("GEO_TIMEOUT"));
        }, 2000);

        navigator.geolocation.getCurrentPosition(
          (p) => {
            clearTimeout(hardTimer);
            resolve(p);
          },
          (err) => {
            clearTimeout(hardTimer);
            reject(err);
          },
          {
            enableHighAccuracy: false,
            timeout: 1800,
            maximumAge: 120000,
          }
        );
      });

      const success = await applyCoordinates(pos.coords.latitude, pos.coords.longitude);
      if (!success) {
        await applyIpFallback();
      }
    } catch (geoErr) {
      console.log("[Checkout] Geolocation falling back to network:", geoErr);
      const ok = await applyIpFallback();
      if (!ok) {
        toast.info("Please enter your delivery address details below.");
      }
    } finally {
      setLocating(false);
      setError("");
      dismissGoogleMapsErrors();
    }
  };

  useEffect(() => {
    const fetchZipDetails = async () => {
      if (!isIndia(address.country, address.countryCode)) return;
      const cleanZip = address.zip.trim();
      if (/^\d{6}$/.test(cleanZip)) {
        setZipLoading(true);
        try {
          const res = await fetch(`https://api.postalpincode.in/pincode/${cleanZip}`);
          const data = await res.json();
          if (data && data[0] && data[0].Status === "Success" && data[0].PostOffice && data[0].PostOffice[0]) {
            const firstOffice = data[0].PostOffice[0];
            const resolvedCity = firstOffice.District || firstOffice.Block || firstOffice.Name || "";
            const resolvedState = matchIndianState(firstOffice.State) || firstOffice.State || "";
            setAddress(prev => ({
              ...prev,
              city: resolvedCity || prev.city,
              state: resolvedState || prev.state,
            }));
            setAddressErrors(prev => {
              const next = { ...prev };
              if (resolvedCity) delete next.city;
              if (resolvedState) delete next.state;
              return next;
            });
          }
        } catch (err) {
          console.error("Error fetching pincode details:", err);
        } finally {
          setZipLoading(false);
        }
      }
    };
    fetchZipDetails();
  }, [address.zip, address.country, address.countryCode]);

   const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("PAYNOW");

  // Ensure paymentMethod is either PAYNOW or COD
  useEffect(() => {
    if (paymentMethod !== "PAYNOW" && paymentMethod !== "COD") {
      setPaymentMethod("PAYNOW");
    }
  }, [paymentMethod]);

  const shipping = 0;

  // Checkout Session & Prefetch Guard
  const [checkoutSessionId] = useState(() => `cs_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);
  const lastPrefetchKeyRef = useRef("");

  // Coupon state
  const [couponCode, setCouponCode] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponDiscount, setCouponDiscount] = useState(0);
  const [couponMessage, setCouponMessage] = useState("");
  const [couponValid, setCouponValid] = useState(false);
  const [applyAsStoreCredit, setApplyAsStoreCredit] = useState(false);
  const [cashbackAmount, setCashbackAmount] = useState(0);
  const [activeCoupons, setActiveCoupons] = useState<any[]>([]);
  const [isManualCoupon, setIsManualCoupon] = useState(false);

  // Store Credit Wallet state
  const [availableStoreCredit, setAvailableStoreCredit] = useState(0);
  const [useStoreCredit, setUseStoreCredit] = useState(false);

  // Calculate totals including Store Credit deduction
  const totalBeforeStoreCredit = subtotal - (applyAsStoreCredit ? 0 : couponDiscount) + shipping;
  const appliedStoreCredit = useStoreCredit ? Math.min(availableStoreCredit, totalBeforeStoreCredit) : 0;
  const finalTotal = Math.max(0, totalBeforeStoreCredit - appliedStoreCredit);
  const total = finalTotal;

  // Calculate COD upfront fee:
  // Domestic India: fixed ₹99
  // International: 10% of order value in target currency
  const codFeeBase = isInternational ? finalTotal * 0.10 : 99;
  const codFeeDisplay = fmtPrice(codFeeBase);
  const codFee = isInternational ? codFeeDisplay.amount : 99;
  const codFeeFormatted = isInternational ? codFeeDisplay.formatted : `₹99`;

  // Fetch available store credit balance when customer email/phone or session changes
  useEffect(() => {
    const fetchStoreCredits = async () => {
      try {
        const email = address.email || (session?.user as any)?.email;
        const phone = address.phone;
        if (!email && !phone) return;

        const params = new URLSearchParams();
        if (email) params.set('email', email);
        if (phone) params.set('phone', phone);

        const res = await fetch(`/api/user/store-credits?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.balance > 0) {
            setAvailableStoreCredit(data.balance);
          } else {
            setAvailableStoreCredit(0);
          }
        }
      } catch (err) {
        console.error('[Checkout] Error fetching store credits:', err);
      }
    };

    fetchStoreCredits();
  }, [address.email, address.phone, session]);

  // Background prefetch of the Razorpay order when entering Step 2 or changing payment configurations
  useEffect(() => {
    if (step === 2 && items.length > 0 && address.name && address.phone && finalTotal > 0) {
      const currentPrefetchKey = `${paymentMethod}_${finalTotal}_${codFee}_${couponValid ? couponCode : ''}_${couponDiscount}_${appliedStoreCredit}_${items.length}`;
      if (lastPrefetchKeyRef.current === currentPrefetchKey && prefetchedOrder) {
        return;
      }
      lastPrefetchKeyRef.current = currentPrefetchKey;

      const prefetchRazorpayOrder = async () => {
        try {
          const fullStreet = [address.houseNo, address.street, address.landmark].filter(Boolean).join(", ");
          const checkoutAddress = { ...address, street: fullStreet || address.street };
          const convertedItems = items.map(item => ({
            ...item,
            price: fmtPrice(parseFloat(item.price)).amount,
          }));
          const convertedSubtotal = fmtPrice(subtotal).amount;
          const convertedTotal = fmtPrice(finalTotal).amount;
          const paymentAmount = paymentMethod === "COD" ? codFee : convertedTotal;

          const res = await fetch("/api/checkout/razorpay", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              amount: paymentAmount,
              currency: countryConfig?.currencyCode || "INR",
              displayCountry: countryCode,
              address: checkoutAddress,
              items: convertedItems,
              subtotal: convertedSubtotal,
              total: convertedTotal,
              shipping,
              paymentMethod,
              codFee: paymentMethod === "COD" ? codFee : 0,
              couponCode: couponValid ? couponCode : null,
              couponDiscount: fmtPrice(couponDiscount).amount,
              storeCreditAmount: fmtPrice(appliedStoreCredit).amount,
              checkoutSessionId,
              notes: {
                name: address.name,
                email: address.email || "",
                contact: address.phone,
              }
            }),
          });
          const orderData = await res.json();
          if (res.ok) {
            setPrefetchedOrder({
              id: orderData.id || orderData.razorpay_order_id,
              amount: orderData.amount,
              keyId: orderData.keyId || orderData.key_id,
            });
          }
        } catch (e) {
          console.error("Failed to prefetch Razorpay order:", e);
        }
      };

      prefetchRazorpayOrder();
    }
  }, [step, paymentMethod, total, codFee, address.name, address.email, address.phone, items.length, checkoutSessionId]);

  useEffect(() => {
    if (!cartLoaded || status === "loading") return;
    if (status === "unauthenticated") {
      router.push(`/login?callbackUrl=/checkout`);
    } else if (items.length === 0 && !isOrderPlaced) {
      router.push("/cart");
    }
  }, [cartLoaded, items, isOrderPlaced, router, status]);

  // Auto-fill address details from session once authenticated
  useEffect(() => {
    if (status === "authenticated" && session?.user) {
      const initialName = session?.user?.name || "";
      const isPhoneName = /^\+?[0-9\s\-]{8,15}$/.test(initialName.trim());
      const cleanName = isPhoneName ? "" : initialName;
      setAddress(prev => ({
        ...prev,
        name: prev.name || cleanName,
        email: prev.email || session?.user?.email || "",
        phone: prev.phone || (session as any)?.customer?.phone || (session?.user as any)?.phone || "",
      }));
    }
  }, [session, status]);

  // Fetch saved addresses callback
  const fetchSavedAddresses = useCallback(async (selectDefault = false) => {
    if (status === "loading") return;
    if (status !== "authenticated") {
      setAddressesLoaded(true);
      return;
    }
    try {
      const res = await fetch("/api/customer/addresses");
      const data = await res.json();
      if (data.addresses && data.addresses.length > 0) {
        setSavedAddresses(data.addresses);
        if (selectDefault) {
          const def = data.addresses.find((a: DBAddress) => a.isDefault) || data.addresses[0];
          setSelectedSavedId(def.id);
          // Parse saved address into new fields
          const parts = def.address1?.split(",").map((s: string) => s.trim()) || [];
          setAddress({
            name: def.name || "",
            email: def.email || "",
            phone: def.phone || "",
            houseNo: parts[0] || def.address1 || "",
            street: parts.slice(1).join(", ") || def.address2 || "",
            landmark: def.address2 && !parts[1] ? def.address2 : "",
            city: def.city || "",
            state: def.state || "",
            zip: def.zip || "",
            country: def.country || "India",
            lat: def.lat || undefined,
            lng: def.lng || undefined,
            placeId: def.placeId || undefined,
          });
          setShowAddressForm(false);
        }
      } else {
        setShowAddressForm(true);
      }
    } catch (err) {
      console.error("Error loading addresses:", err);
      setShowAddressForm(true);
    } finally {
      setAddressesLoaded(true);
    }
  }, [status]);

  useEffect(() => {
    fetchSavedAddresses(true);
  }, [fetchSavedAddresses]);

  const handleSelectSavedAddress = (addr: DBAddress) => {
    setSelectedSavedId(addr.id);
    const parts = addr.address1?.split(",").map((s: string) => s.trim()) || [];
    setAddress({
      name: addr.name || "",
      email: addr.email || "",
      phone: addr.phone || "",
      houseNo: parts[0] || addr.address1 || "",
      street: parts.slice(1).join(", ") || addr.address2 || "",
      landmark: addr.address2 && !parts[1] ? addr.address2 : "",
      city: addr.city || "",
      state: addr.state || "",
      zip: addr.zip || "",
      country: addr.country || "India",
      lat: addr.lat || undefined,
      lng: addr.lng || undefined,
      placeId: addr.placeId || undefined,
    });
    setAddressErrors({});
    setShowAddressForm(false);

    // Save details to cookies and re-init pixel for Advanced Matching
    saveUserDataToCookiesAndReinit({
      email: addr.email || undefined,
      phone: addr.phone || undefined,
      name: addr.name || undefined,
      city: addr.city || undefined,
      state: addr.state || undefined,
      zip: addr.zip || undefined,
      country: addr.country || "India",
    });
  };

  const validateAddress = (): boolean => {
    const errors: Record<string, string> = {};

    if (!address.name.trim() || address.name.trim().length < 2) {
      errors.name = "Enter your full name";
    }
    if (!address.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.email)) {
      errors.email = "Enter a valid email";
    }

    // Phone validation
    const phoneRes = validatePhoneNumber(address.phone, address.country, address.countryCode);
    if (!phoneRes.valid) {
      errors.phone = phoneRes.error;
    }

    if (!isValidAddressField(address.houseNo, 1)) {
      errors.houseNo = "Enter house/flat number";
    }
    if (!isValidAddressField(address.street, 3)) {
      errors.street = "Enter street/road/area name";
    }
    if (!address.city.trim()) {
      errors.city = "City is required";
    }
    if (!address.state.trim()) {
      errors.state = isIndia(address.country, address.countryCode) ? "Select your state" : "Enter state / province / region";
    }
    if (!validatePostalCode(address.zip, address.country, address.countryCode)) {
      errors.zip = isIndia(address.country, address.countryCode) ? "Enter a valid 6-digit PIN code" : "Enter a valid postal / ZIP code";
    }

    setAddressErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleAddressSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateAddress()) return;

    setLoading(true);

    // Format phone
    const phoneRes = validatePhoneNumber(address.phone, address.country, address.countryCode);
    const formattedPhone = phoneRes.formattedPhone;
    const updatedAddress = { ...address, phone: formattedPhone };
    setAddress(updatedAddress);

    // Auto-save address to database on proceed
    try {
      const response = await fetch("/api/customer/addresses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: updatedAddress.name,
          phone: updatedAddress.phone,
          email: updatedAddress.email,
          address1: `${updatedAddress.houseNo}, ${updatedAddress.street}`,
          address2: updatedAddress.landmark,
          city: updatedAddress.city,
          state: updatedAddress.state,
          zip: updatedAddress.zip,
          country: updatedAddress.country,
          isDefault: true,
          lat: updatedAddress.lat,
          lng: updatedAddress.lng,
          placeId: updatedAddress.placeId,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.address) {
          setSelectedSavedId(data.address.id);
          // Reload saved addresses to sync UI in real time
          await fetchSavedAddresses(false);
          setShowAddressForm(false);
        }
      }
    } catch (err) {
      console.error("Failed to auto-save address on proceed:", err);
    } finally {
      setLoading(false);
    }

    setStep(2);

    const nameParts = (updatedAddress.name || "").trim().split(/\s+/);
    const fn = nameParts[0] || undefined;
    const ln = nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined;

    const contentIds = items.map(item => item.productId);
    const contents = items.map(item => ({
      id: item.productId,
      quantity: item.quantity,
      item_price: parseFloat(item.price)
    }));

    if (!paymentInfoFired) {
      trackAddPaymentInfo(
        {
          country: updatedAddress.country,
          st: updatedAddress.state,
          ct: updatedAddress.city,
          zp: updatedAddress.zip,
          fn,
          ln,
          em: updatedAddress.email || undefined,
          ph: formattedPhone || undefined,
        },
        subtotal,
        'INR',
        contentIds,
        contents
      );
      trackSnapAddBilling(
        subtotal,
        'INR',
        {
          country: updatedAddress.country,
          st: updatedAddress.state,
          ct: updatedAddress.city,
          zp: updatedAddress.zip,
          fn,
          ln,
          em: updatedAddress.email || undefined,
          ph: formattedPhone || undefined,
        },
        contentIds
      );
      zbTrackPaymentInitiated(subtotal, { payment_method: paymentMethod, currency: 'INR' });
      setPaymentInfoFired(true);
    }

    // Save details to cookies and re-init pixel for Advanced Matching
    saveUserDataToCookiesAndReinit({
      email: updatedAddress.email || undefined,
      phone: formattedPhone || undefined,
      name: updatedAddress.name || undefined,
      city: updatedAddress.city || undefined,
      state: updatedAddress.state || undefined,
      zip: updatedAddress.zip || undefined,
      country: updatedAddress.country || "India",
    });
  };

  const handleApplyCoupon = async (overrideCode?: string, currentPaymentMethod?: string, isAuto = false) => {
    const codeToValidate = overrideCode !== undefined ? overrideCode : couponCode;
    const paymentMethodToValidate = currentPaymentMethod !== undefined ? currentPaymentMethod : paymentMethod;
    if (!codeToValidate.trim()) return;

    if (!isAuto) {
      setIsManualCoupon(true);
    }

    setCouponLoading(true);
    setCouponMessage("");

    try {
      const res = await fetch("/api/storefront/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: codeToValidate,
          subtotal,
          paymentMethod: paymentMethodToValidate
        }),
      });
      const data = await res.json();

      setCouponMessage(data.message);
      if (data.valid) {
        setCouponValid(true);
        setApplyAsStoreCredit(!!data.applyAsStoreCredit);

        // Handle double discounts: check if cashback is enabled
        if (data.cashbackEnabled && data.cashbackAmount > 0) {
          setCashbackAmount(data.cashbackAmount);
          if (data.applyAsStoreCredit) {
            setCouponDiscount(0);
          } else {
            setCouponDiscount(data.discount);
          }
        } else {
          if (data.applyAsStoreCredit) {
            setCouponDiscount(0);
            setCashbackAmount(data.discount);
          } else {
            setCouponDiscount(data.discount);
            setCashbackAmount(0);
          }
        }
      } else {
        setCouponDiscount(0);
        setCouponValid(false);
        setApplyAsStoreCredit(false);
        setCashbackAmount(0);
        if (!isAuto) {
          setIsManualCoupon(false);
        }
      }
    } catch {
      setCouponMessage("Unable to validate coupon.");
      setCouponValid(false);
      setApplyAsStoreCredit(false);
      setCashbackAmount(0);
      if (!isAuto) {
        setIsManualCoupon(false);
      }
    } finally {
      setCouponLoading(false);
    }
  };

  const handleRemoveCoupon = () => {
    setIsManualCoupon(true);
    setCouponCode("");
    setCouponDiscount(0);
    setCouponMessage("");
    setCouponValid(false);
    setApplyAsStoreCredit(false);
    setCashbackAmount(0);
  };

  // Fetch active coupons from storefront active API
  useEffect(() => {
    const fetchActiveCoupons = async () => {
      try {
        const res = await fetch("/api/storefront/coupons/active");
        if (res.ok) {
          const data = await res.json();
          setActiveCoupons(data.coupons || []);
        }
      } catch (err) {
        console.error("Failed to load active coupons:", err);
      }
    };
    fetchActiveCoupons();
  }, []);

  // Client-side local evaluation helper for ranking coupons
  const calculateCouponDiscount = useCallback((coupon: any, subtotalAmount: number, payMethod: string) => {
    const isCOD = payMethod === "COD" || (payMethod && payMethod.toUpperCase().includes("COD"));

    // check minimum order value
    if (subtotalAmount < Number(coupon.minOrderValue || 0)) {
      return {
        discount: 0,
        eligible: false,
        message: "Min order amount not met",
        type: "",
        value: 0,
        applyAsStoreCredit: false,
        cashbackEnabled: false,
        cashbackType: "percentage",
        cashbackValue: 0,
        cashbackAmount: 0
      };
    }

    // check payment method applicability
    if (coupon.applicability === "PREPAID_ONLY" && isCOD) {
      return {
        discount: 0,
        eligible: false,
        message: "Only valid for prepaid orders",
        type: "",
        value: 0,
        applyAsStoreCredit: false,
        cashbackEnabled: false,
        cashbackType: "percentage",
        cashbackValue: 0,
        cashbackAmount: 0
      };
    }
    if (coupon.applicability === "COD_ONLY" && !isCOD) {
      return {
        discount: 0,
        eligible: false,
        message: "Only valid for COD orders",
        type: "",
        value: 0,
        applyAsStoreCredit: false,
        cashbackEnabled: false,
        cashbackType: "percentage",
        cashbackValue: 0,
        cashbackAmount: 0
      };
    }

    let currentDiscountType = coupon.discountType;
    let currentDiscountValue = Number(coupon.discountValue);

    if (coupon.applicability === "CUSTOM_RATES") {
      if (!isCOD) {
        currentDiscountType = coupon.prepaidDiscountType;
        currentDiscountValue = Number(coupon.prepaidDiscountValue);
      } else {
        currentDiscountType = coupon.codDiscountType;
        currentDiscountValue = Number(coupon.codDiscountValue);
      }
    }

    let calculatedDiscount = 0;
    if (currentDiscountType === "percentage") {
      calculatedDiscount = Math.round((subtotalAmount * currentDiscountValue) / 100);
    } else {
      calculatedDiscount = Math.min(currentDiscountValue, subtotalAmount);
    }

    // Calculate cashback if enabled
    let cashbackAmount = 0;
    const isCashbackEnabled = !!coupon.cashbackEnabled;
    if (isCashbackEnabled) {
      const cbVal = Number(coupon.cashbackValue || 0);
      if (coupon.cashbackType === "percentage") {
        cashbackAmount = Math.round((subtotalAmount * cbVal) / 100);
      } else {
        cashbackAmount = Math.min(cbVal, subtotalAmount);
      }
    }

    return {
      discount: calculatedDiscount,
      eligible: true,
      type: currentDiscountType,
      value: currentDiscountValue,
      applyAsStoreCredit: !!coupon.applyAsStoreCredit,
      cashbackEnabled: isCashbackEnabled,
      cashbackType: coupon.cashbackType || "percentage",
      cashbackValue: Number(coupon.cashbackValue || 0),
      cashbackAmount
    };
  }, []);

  // Automatic coupon application logic
  useEffect(() => {
    if (activeCoupons.length === 0 || isManualCoupon) return;

    const ranked = activeCoupons
      .map(coupon => ({
        coupon,
        calc: calculateCouponDiscount(coupon, subtotal, paymentMethod)
      }))
      .filter(item => item.coupon.autoApply && item.calc.eligible && (item.calc.discount > 0 || item.calc.cashbackAmount > 0))
      .sort((a, b) => {
        const immediateA = a.calc.applyAsStoreCredit ? 0 : a.calc.discount;
        const immediateB = b.calc.applyAsStoreCredit ? 0 : b.calc.discount;
        if (immediateA !== immediateB) {
          return immediateB - immediateA;
        }
        const cashbackA = a.calc.applyAsStoreCredit ? a.calc.discount : a.calc.cashbackAmount;
        const cashbackB = b.calc.applyAsStoreCredit ? b.calc.discount : b.calc.cashbackAmount;
        return cashbackB - cashbackA;
      });

    const best = ranked[0];
    if (best) {
      setCouponCode(best.coupon.code);
      setCouponValid(true);
      setApplyAsStoreCredit(best.coupon.applyAsStoreCredit);

      if (best.calc.cashbackEnabled && best.calc.cashbackAmount > 0) {
        setCashbackAmount(best.calc.cashbackAmount);
        if (best.coupon.applyAsStoreCredit) {
          setCouponDiscount(0);
        } else {
          setCouponDiscount(best.calc.discount);
        }
      } else {
        if (best.coupon.applyAsStoreCredit) {
          setCouponDiscount(0);
          setCashbackAmount(best.calc.discount);
        } else {
          setCouponDiscount(best.calc.discount);
          setCashbackAmount(0);
        }
      }

      let displayMessage = "";
      if (best.calc.cashbackEnabled && !best.coupon.applyAsStoreCredit && best.calc.discount > 0) {
        displayMessage = best.calc.type === "percentage"
          ? `${best.calc.value}% instant off + ₹${best.calc.cashbackAmount.toLocaleString("en-IN")} store credit cashback!`
          : `₹${best.calc.value.toLocaleString("en-IN")} instant off + ₹${best.calc.cashbackAmount.toLocaleString("en-IN")} store credit cashback!`;
      } else if (best.coupon.applyAsStoreCredit || (best.calc.cashbackEnabled && best.calc.discount === 0)) {
        const finalCashback = best.calc.discount > 0 ? best.calc.discount : best.calc.cashbackAmount;
        displayMessage = `₹${finalCashback.toLocaleString("en-IN")} Store Credit cashback will be added!`;
      } else {
        displayMessage = best.calc.type === "percentage"
          ? `${best.calc.value}% off applied automatically!`
          : `₹${best.calc.value.toLocaleString("en-IN")} off applied automatically!`;
      }
      setCouponMessage(displayMessage);
    } else {
      setCouponCode("");
      setCouponDiscount(0);
      setCouponMessage("");
      setCouponValid(false);
      setApplyAsStoreCredit(false);
      setCashbackAmount(0);
    }
  }, [activeCoupons, subtotal, paymentMethod, isManualCoupon, calculateCouponDiscount]);

  // Re-validate coupon when payment method changes (for ALL coupons to ensure PREPAID_ONLY is never allowed for COD)
  useEffect(() => {
    if (couponCode) {
      handleApplyCoupon(couponCode, paymentMethod, !isManualCoupon);
    }
  }, [paymentMethod]);

  const handlePlaceOrder = async () => {
    // Synchronous double-submit lock check
    if (paymentLockRef.current) {
      console.warn("[Razorpay] Blocked rapid double-tap trigger.");
      return;
    }
    paymentLockRef.current = true;

    setLoading(true);
    setError("");

    try {
      // Ensure Razorpay SDK is loaded
      if (!(window as any).Razorpay) {
        setError("Payment gateway is loading. Please try again in a moment.");
        setLoading(false);
        paymentLockRef.current = false;
        return;
      }

      // Combine address fields into a single street for storage
      const fullStreet = [address.houseNo, address.street, address.landmark].filter(Boolean).join(", ");
      const checkoutAddress = { ...address, street: fullStreet };

      // Case 1: 100% Store Credit Payment (finalTotal === 0)
      if (finalTotal === 0 && appliedStoreCredit > 0) {
        console.log("[Checkout] Completing order with 100% Store Credit");
        const completeRes = await fetch("/api/checkout/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: checkoutAddress,
            paymentMethod: "store_credit",
            items,
            total: 0,
            subtotal,
            codFee: 0,
            couponCode: couponValid ? couponCode : null,
            couponDiscount: couponDiscount,
            storeCreditAmount: appliedStoreCredit,
            guestId: getClientCookie("zb_device_id"),
          }),
        });

        const completeData = await completeRes.json();
        if (completeRes.ok) {
          setIsOrderPlaced(true);
          if (typeof window !== "undefined") {
            sessionStorage.setItem("last_placed_order_id", completeData.orderId);
            const joinedCategories = items.map(item => item.category).filter(Boolean).join(', ');
            sessionStorage.setItem(`order_categories_${completeData.orderId}`, joinedCategories);
          }
          clear();
          router.push(`/orders/${completeData.orderId}/confirmation`);
          return;
        } else {
          throw new Error(completeData.error || "Failed to complete order with store credit.");
        }
      }

      // Case 2: Partial Store Credit or Standard Payment
      // Synchronously check coupon applicability before placing order
      let activeCouponDiscount = couponDiscount;
      let activeCouponValid = couponValid;
      let activeCouponCode = couponCode;

      if (activeCouponValid && activeCouponCode) {
        const matchedActive = activeCoupons.find((c: any) => c.code === activeCouponCode);
        if (matchedActive) {
          const calc = calculateCouponDiscount(matchedActive, subtotal, paymentMethod);
          if (!calc.eligible) {
            console.warn(`[Checkout] Coupon ${activeCouponCode} ineligible for ${paymentMethod}, stripping client-side.`);
            activeCouponDiscount = 0;
            activeCouponValid = false;
            activeCouponCode = "";
            setCouponDiscount(0);
            setCouponValid(false);
            setCouponCode("");
            setCouponMessage("");
            setCashbackAmount(0);
          }
        }
      }

      const effectiveTotalBeforeSC = subtotal - (applyAsStoreCredit ? 0 : activeCouponDiscount) + shipping;
      const effectiveSC = useStoreCredit ? Math.min(availableStoreCredit, effectiveTotalBeforeSC) : 0;
      const effectiveFinalTotal = Math.max(0, effectiveTotalBeforeSC - effectiveSC);

      const convertedItems = items.map(item => ({
        ...item,
        price: fmtPrice(parseFloat(item.price)).amount,
      }));
      const convertedSubtotal = fmtPrice(subtotal).amount;
      const convertedTotal = fmtPrice(effectiveFinalTotal).amount;
      const paymentAmount = paymentMethod === "COD" ? codFee : convertedTotal;

      let orderId = "";
      let keyId = "";
      let orderData: any = null;

      if (prefetchedOrder && Math.round(prefetchedOrder.amount / 100) === Math.round(paymentAmount)) {
        orderId = prefetchedOrder.id;
        keyId = prefetchedOrder.keyId;
        orderData = prefetchedOrder;
        console.log("[Razorpay] Using pre-fetched order:", orderId);
      } else {
        console.log("[Razorpay] Pre-fetched order missing or mismatch, fetching fresh...");
        const res = await fetch("/api/checkout/razorpay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: paymentAmount,
            currency: countryConfig?.currencyCode || "INR",
            displayCountry: countryCode,
            address: checkoutAddress,
            items: convertedItems,
            subtotal: convertedSubtotal,
            total: convertedTotal,
            shipping,
            paymentMethod,
            codFee: paymentMethod === "COD" ? codFee : 0,
            couponCode: activeCouponValid ? activeCouponCode : null,
            couponDiscount: fmtPrice(activeCouponDiscount).amount,
            storeCreditAmount: fmtPrice(appliedStoreCredit).amount,
            checkoutSessionId,
            notes: {
              name: address.name,
              email: address.email || "",
              contact: address.phone,
            }
          }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to initiate payment");
        orderId = data.id || data.razorpay_order_id;
        keyId = data.keyId || data.key_id;
        orderData = data;
      }

      // Track Payment Initiated event
      trackStorefrontEvent('Payment Initiated', {
        customerId: (session?.user as any)?.id || null,
        customerPhone: address.phone || null,
        orderId: orderId,
        metadata: {
          amount: paymentAmount,
          currency: countryConfig?.currencyCode || 'INR',
          paymentMethod,
          num_items: items.length
        }
      });

      // ═══════════════════════════════════════════════════════════
      // Shared success handler — called by Razorpay Standard Checkout
      // ═══════════════════════════════════════════════════════════
      const handlePaymentSuccess = async (response: any) => {
        try {
          const verifyRes = await fetch("/api/checkout/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              address: checkoutAddress,
              paymentMethod,
              items: convertedItems,
              total: convertedTotal,
              subtotal: convertedSubtotal,
              currency: countryConfig?.currencyCode || "INR",
              displayCountry: countryCode,
              codFee: paymentMethod === "COD" ? codFee : 0,
              razorpay: response,
              couponCode: couponValid ? couponCode : null,
              couponDiscount: fmtPrice(couponDiscount).amount,
              applyAsStoreCredit,
              cashbackAmount: fmtPrice(cashbackAmount).amount,
              storeCreditAmount: fmtPrice(appliedStoreCredit).amount,
              guestId: getClientCookie("zb_device_id"),
            }),
          });

          const verifyData = await verifyRes.json();
          if (verifyRes.ok) {
            setIsOrderPlaced(true);
            if (typeof window !== "undefined") {
              sessionStorage.setItem("last_placed_order_id", verifyData.orderId);
              const joinedCategories = items.map(item => item.category).filter(Boolean).join(', ');
              sessionStorage.setItem(`order_categories_${verifyData.orderId}`, joinedCategories);
            }
            clear();
            router.push(`/orders/${verifyData.orderId}/confirmation`);
          } else {
            // CRITICAL: Payment was captured successfully, but database registration failed.
            // Do not allow retry to prevent double-charging the customer.
            setError(`Your payment of ${fmtAmount(paymentAmount)} was successful (ID: ${response.razorpay_payment_id || "N/A"}), but we encountered an issue registering your order. Please do NOT try paying again. Contact support at support@zicabella.com with your payment ID so we can verify and manually create your order.`);
            setLoading(false);
          }
        } catch {
          setError(`Your payment of ${fmtAmount(paymentAmount)} was successful (ID: ${response.razorpay_payment_id || "N/A"}), but we encountered a connection issue confirming your order. Please do NOT try paying again. Contact support at support@zicabella.com with your payment ID so we can confirm your order manually.`);
          setLoading(false);
        } finally {
          paymentLockRef.current = false;
        }
      };

      // ═══════════════════════════════════════════════════════════
      // Shared error handler for payment.failed event
      // ═══════════════════════════════════════════════════════════
      const handlePaymentError = (error: any) => {
        paymentLockRef.current = false;

        const errorDesc = error?.error?.description || error?.description || "Payment failed. Please try again.";
        const errorCode = error?.error?.code || error?.code || "";
        const errorReason = error?.error?.reason || "";
        console.error('[Razorpay] Payment error:', error?.error || error);

        const failureReason = errorReason || errorCode || errorDesc || "payment_failed";

        // Call cancel API to log reason on backend
        if (orderId) {
          fetch("/api/checkout/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ razorpayOrderId: orderId, reason: failureReason }),
          }).catch(err => console.error("[Razorpay] Failed to notify cancel API:", err));
        }

        // Map specific error reasons to friendly messages
        let friendlyMessage = errorDesc;
        if (errorReason === "payment_cancelled") {
          friendlyMessage = "Payment was cancelled. You can try again.";
        } else if (errorReason === "intent_no_apps_error") {
          friendlyMessage = "No UPI app found on this device. Please try entering your UPI ID in the payment window.";
        }

        setError(`${friendlyMessage}${errorCode ? ` (${errorCode})` : ''}`);
        setLoading(false);
      };

      // ═══════════════════════════════════════════════════════════
      // Razorpay Standard Checkout — used for ALL payment methods
      // The Standard Checkout modal handles UPI Intent (auto-detects
      // installed apps on mobile), UPI Collect (VPA entry), QR code
      // (desktop), Cards, Pay Later, EMI — all within its own UI.
      // ═══════════════════════════════════════════════════════════
      const options: any = {
        key: keyId,
        amount: orderData.amount,
        currency: orderData.currency || countryConfig?.currencyCode || "INR",
        name: "Zica Bella",
        description: paymentMethod === "COD" ? "COD Upfront Fee" : "Order Payment",
        order_id: orderId,
        handler: handlePaymentSuccess,
        prefill: {
          name: address.name,
          email: address.email,
          contact: address.phone,
        },
        theme: {
          color: "#000000",
          backdrop_color: "rgba(0,0,0,0.85)",
        },
        modal: {
          ondismiss: function () {
            setLoading(false);
            paymentLockRef.current = false;
            if (orderId) {
              fetch("/api/checkout/cancel", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ razorpayOrderId: orderId, reason: "payment_cancelled_by_user" }),
              }).catch(err => console.error("[Razorpay] Failed to log modal dismiss:", err));
            }
          },
          confirm_close: true,
        },
      };

      // Configure display preferences:
      // Both PAYNOW and COD open the full standard Razorpay checkout modal
      // supporting all instruments (UPI, Cards, Netbanking, Wallets)
      if (isInternational) {
        options.prefill.method = "card";
      }

      const rzp = new (window as any).Razorpay(options);
      rzp.on('payment.failed', function (response: any) {
        handlePaymentError(response);
      });
      rzp.open();

    } catch (err: any) {
      setError(err.message || "An error occurred");
      setLoading(false);
      paymentLockRef.current = false;
    }
  };

  /* ═══ Address field update helper ════════════════════════════ */
  const updateField = useCallback((field: keyof Address, value: string, sanitize = false) => {
    setSelectedSavedId("");
    setAddressErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
    setAddress(prev => ({ ...prev, [field]: sanitize ? sanitizeAddress(value) : value }));
  }, []);

  const handleBackClick = useCallback(() => {
    if (step === 2) {
      setStep(1);
    } else {
      if (typeof window !== "undefined" && document.referrer && document.referrer.startsWith(window.location.origin)) {
        router.back();
      } else {
        router.push("/cart");
      }
    }
  }, [step, router]);

  const renderPaymentSelector = (isMobileOnly = false) => {
    return (
      <div className={isMobileOnly ? "md:hidden flex flex-col w-full" : "hidden md:flex flex-col w-full"}>
        {/* Payment selection segment tabs */}
        {(() => {
          const availableMethods = [
            { id: "PAYNOW" as PaymentMethod, label: "PAY NOW" },
            { id: "COD" as PaymentMethod, label: "COD" }
          ];
          return (
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-foreground/[0.03] border border-foreground/5 mb-4">
              {availableMethods.map((method) => {
                const isActive = paymentMethod === method.id;
                return (
                  <button
                    key={method.id}
                    type="button"
                    onClick={() => {
                      setPaymentMethod(method.id);
                      const nameParts = (address.name || "").trim().split(/\s+/);
                      const fn = nameParts[0] || undefined;
                      const ln = nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined;

                      const contentIds = items.map(item => item.productId);
                      const contents = items.map(item => ({
                        id: item.productId,
                        quantity: item.quantity,
                        item_price: parseFloat(item.price)
                      }));

                      if (!paymentInfoFired) {
                        trackAddPaymentInfo(
                          {
                            country: address.country,
                            st: address.state,
                            ct: address.city,
                            zp: address.zip,
                            fn,
                            ln,
                            em: address.email || undefined,
                            ph: address.phone || undefined,
                          },
                          subtotal,
                          countryConfig?.currencyCode || 'INR',
                          contentIds,
                          contents
                        );
                        trackSnapAddBilling(
                          subtotal,
                          countryConfig?.currencyCode || 'INR',
                          {
                            country: address.country,
                            st: address.state,
                            ct: address.city,
                            zp: address.zip,
                            fn,
                            ln,
                            em: address.email || undefined,
                            ph: address.phone || undefined,
                          },
                          contentIds
                        );
                        setPaymentInfoFired(true);
                      }
                    }}
                    className={`py-2.5 px-2 text-[8px] min-[360px]:text-[9px] sm:text-[10px] font-medium uppercase tracking-[0.1em] sm:tracking-[0.12em] rounded-lg text-center transition-all duration-300 border whitespace-nowrap ${isActive
                      ? "bg-foreground/[0.08] dark:bg-white/[0.1] border-foreground/15 dark:border-white/15 text-foreground scale-[1.02] font-bold shadow-xs"
                      : "border-transparent text-foreground/40 hover:text-foreground hover:bg-foreground/[0.02]"
                      }`}
                  >
                    {method.label}
                  </button>
                );
              })}
            </div>
          );
        })()}

        {/* Payment info banners */}
        <div className="flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-300 mb-4 w-full">
          {paymentMethod === "COD" && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-foreground/[0.02] border border-foreground/5">
              <Banknote className="w-3.5 h-3.5 text-foreground/40 shrink-0" />
              <p className="text-[9px] font-light text-foreground/60 leading-relaxed">
                {isInternational
                  ? `Pay ${codFeeFormatted} upfront (10% of order value, deducted from total). Remaining ${fmtAmount(Math.max(0, finalTotal - codFeeBase))} due at delivery.`
                  : `Pay ₹99 upfront (deducted from total). Remaining ₹${Math.max(0, finalTotal - 99).toLocaleString("en-IN")} due at delivery.`}
              </p>
            </div>
          )}
          {paymentMethod === "PAYNOW" && (
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-foreground/[0.02] border border-foreground/5">
              <CreditCard className="w-3.5 h-3.5 text-foreground/40 shrink-0" />
              <p className="text-[9px] font-light text-foreground/60 leading-relaxed">
                {isInternational
                  ? `Pay securely using any Credit/Debit Card or supported payment method in ${countryConfig?.currencyCode || "USD"}.`
                  : "Pay securely via UPI, Credit/Debit Cards, Netbanking, Wallets, Pay Later, or EMI in the next screen."}
              </p>
            </div>
          )}
        </div>

      </div>
    );
  };

  const renderOrderSummary = () => {
    return (
      <div className="flex flex-col gap-3.5 w-full">
        {/* Product Preview Card */}
        <div className="apple-glass-capsule p-4.5 rounded-[24px] flex flex-col gap-3.5">
          {items.map((item) => (
            <div key={item.id} className="flex gap-3 items-center">
              <div className="w-10 h-13 rounded-lg bg-foreground/[0.02] border border-foreground/10 overflow-hidden shrink-0 relative">
                {item.image ? (
                  <img src={item.image} className="w-full h-full object-cover animate-in fade-in duration-300" alt={item.title} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-foreground/20 text-[8px] font-light">ZB</div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-[10px] font-normal text-foreground/85 uppercase tracking-wide truncate leading-tight">{item.title}</h4>
                <p className="text-[8px] text-foreground/40 font-light uppercase tracking-wider mt-1 leading-none">
                  Size: {item.size || "Free"} &nbsp;•&nbsp; Qty: {item.quantity}
                </p>
              </div>
              <span className="text-[10px] font-normal text-foreground/80 shrink-0">{fmtAmount(parseFloat(item.price) * item.quantity)}</span>
            </div>
          ))}
        </div>

        {/* Store Credit Wallet Card (Domestic India only) */}
        {!isInternational && availableStoreCredit > 0 && (
          <div className="apple-glass-capsule p-3.5 rounded-2xl flex flex-col gap-2.5 transition-all duration-300 border-emerald-500/20 bg-emerald-500/[0.04]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center text-emerald-400 shrink-0">
                  <Wallet className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-[10px] font-semibold text-foreground tracking-wide leading-none">
                    Store Credit Wallet
                  </h4>
                  <p className="text-[8.5px] text-emerald-400 font-light mt-0.5">
                    Available: ₹{availableStoreCredit.toLocaleString('en-IN')}
                  </p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={useStoreCredit}
                  onChange={(e) => setUseStoreCredit(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-8 h-4.5 bg-foreground/15 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-emerald-500"></div>
              </label>
            </div>
            {useStoreCredit && appliedStoreCredit > 0 && (
              <div className="text-[8.5px] font-light text-emerald-400/90 flex justify-between items-center pt-1 border-t border-emerald-500/10">
                <span>Store Credit Discount</span>
                <span className="font-semibold">- ₹{appliedStoreCredit.toLocaleString('en-IN')}</span>
              </div>
            )}
          </div>
        )}

        {/* Calculations Summary */}
        <div className="apple-glass-capsule p-4 rounded-2xl flex flex-col gap-2.5">
          <div className="flex justify-between items-center text-[9px] font-light uppercase tracking-wider">
            <span className="text-foreground/40">Subtotal</span>
            <span className="text-foreground/75">{fmtAmount(subtotal)}</span>
          </div>

          {couponDiscount > 0 && !applyAsStoreCredit && (
            <div className="flex justify-between items-center text-[9px] font-light uppercase tracking-wider">
              <span className="text-emerald-400/90">Discount ({couponCode})</span>
              <span className="text-emerald-400/90">- {fmtAmount(couponDiscount)}</span>
            </div>
          )}

          {appliedStoreCredit > 0 && (
            <div className="flex justify-between items-center text-[9px] font-light uppercase tracking-wider">
              <span className="text-emerald-400/90">Store Credit Applied</span>
              <span className="text-emerald-400/90">- {fmtAmount(appliedStoreCredit)}</span>
            </div>
          )}

          {cashbackAmount > 0 && (
            <div className="flex justify-between items-center text-[9px] font-light uppercase tracking-wider">
              <span className="text-emerald-400/90">Cashback ({couponCode})</span>
              <span className="text-emerald-400/90">+ {fmtAmount(cashbackAmount)}</span>
            </div>
          )}

          {paymentMethod === "COD" && (
            <div className="flex justify-between items-center text-[9px] font-light uppercase tracking-wider">
              <span className="text-foreground/45">COD Upfront (included)</span>
              <span className="text-foreground/60">{codFeeFormatted}</span>
            </div>
          )}

          <div className="flex justify-between items-center text-[9px] font-light uppercase tracking-wider">
            <span className="text-foreground/40">Shipping</span>
            <span className="text-foreground/75">FREE</span>
          </div>

          <div className="h-[1px] bg-foreground/5 my-0.5" />

          {paymentMethod === "COD" ? (
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center text-[9px] font-light uppercase tracking-wider">
                <span className="text-foreground/40">Order Total</span>
                <span className="text-foreground/75">{fmtAmount(finalTotal)}</span>
              </div>
              <div className="flex justify-between items-center text-[9px] font-light uppercase tracking-wider">
                <span className="text-foreground/40">Due at Delivery</span>
                <span className="text-foreground/75">{fmtAmount(Math.max(0, finalTotal - codFeeBase))}</span>
              </div>
              <div className="h-[1px] bg-foreground/5 my-0.5" />
              <div className="flex justify-between items-center">
                <span className="font-light text-[9px] text-foreground/45 uppercase tracking-widest">Pay Now (Upfront)</span>
                <span className="text-base font-medium text-foreground tracking-tight leading-none">{codFeeFormatted}</span>
              </div>
            </div>
          ) : (
            <div className="flex justify-between items-center">
              <span className="font-light text-[9px] text-foreground/45 uppercase tracking-widest">Total</span>
              <span className="text-base font-medium text-foreground tracking-tight leading-none">{fmtAmount(finalTotal)}</span>
            </div>
          )}
        </div>

        {/* Payment Selector (Only if Step 2) */}
        {step === 2 && renderPaymentSelector(true)}

        {/* Apply Discount Banner */}
        <div className="apple-glass-capsule p-3 rounded-2xl flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-foreground/40" />
            <span className="text-[10px] font-light text-foreground/75">Apply Discount</span>
          </div>

          {couponValid ? (
            <div className="flex items-center gap-2 py-1 px-2.5 rounded-full bg-foreground/[0.08] border border-foreground/10 animate-in scale-in duration-300">
              <span className="text-[9px] font-medium text-foreground uppercase tracking-wider">{couponCode}</span>
              <button
                type="button"
                onClick={handleRemoveCoupon}
                className="w-3.5 h-3.5 rounded-full bg-foreground/10 flex items-center justify-center hover:bg-foreground/20 text-foreground/60 hover:text-foreground"
              >
                <X className="w-2 h-2" />
              </button>
            </div>
          ) : (
            <div className="flex gap-2 items-center flex-1 max-w-[180px]">
              <input
                type="text"
                placeholder="Enter code"
                aria-label="Discount Code"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                className="w-full h-8 px-2.5 rounded-lg bg-foreground/[0.02] border border-foreground/5 text-foreground text-[9px] font-mono tracking-wider placeholder:text-foreground/20 uppercase focus:border-foreground/20 focus:outline-none transition-all"
              />
              <button
                type="button"
                onClick={() => handleApplyCoupon()}
                disabled={couponLoading || !couponCode.trim()}
                className="h-8 px-2.5 rounded-lg bg-foreground/[0.03] dark:bg-white/[0.05] border border-foreground/10 dark:border-white/10 text-foreground font-light text-[9px] uppercase tracking-[0.12em] hover:bg-foreground/[0.06] dark:hover:bg-white/[0.08] backdrop-blur-md active:scale-[0.98] disabled:opacity-30 transition-all flex items-center justify-center shrink-0 whitespace-nowrap"
              >
                {couponLoading ? <Loader2 className="w-3 animate-spin" /> : "Apply"}
              </button>
            </div>
          )}
        </div>

        {/* Available Offers */}
        {!couponValid && activeCoupons.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 pl-1 mb-0.5 leading-none">
              <Sparkles className="w-3 h-3 text-yellow-500 animate-pulse" />
              <span className="text-[7.5px] font-light text-foreground/40 uppercase tracking-widest">Available Offers</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none snap-x snap-mandatory">
              {activeCoupons.map((coupon) => {
                const isCOD = paymentMethod === "COD";
                let benefitText = "";
                let val = 0;
                let type = "";

                if (coupon.applicability === "CUSTOM_RATES") {
                  if (!isCOD) {
                    val = Number(coupon.prepaidDiscountValue);
                    type = coupon.prepaidDiscountType;
                  } else {
                    val = Number(coupon.codDiscountValue);
                    type = coupon.codDiscountType;
                  }
                } else {
                  val = Number(coupon.discountValue);
                  type = coupon.discountType;
                }

                if (type === "percentage") {
                  benefitText = `${val}% Off`;
                } else {
                  benefitText = `₹${val} Off`;
                }

                if (coupon.applyAsStoreCredit) {
                  benefitText = `${benefitText} Cashback`;
                }

                const isEligible = subtotal >= Number(coupon.minOrderValue);
                const isMethodApplicable =
                  coupon.applicability === "ALL" ||
                  (isCOD && (coupon.applicability === "COD_ONLY" || coupon.applicability === "CUSTOM_RATES")) ||
                  (!isCOD && (coupon.applicability === "PREPAID_ONLY" || coupon.applicability === "CUSTOM_RATES"));

                return (
                  <button
                    key={coupon.id}
                    type="button"
                    disabled={!isEligible || !isMethodApplicable}
                    onClick={() => {
                      setCouponCode(coupon.code);
                      setIsManualCoupon(true);
                      handleApplyCoupon(coupon.code, paymentMethod, false);
                    }}
                    className={`snap-start shrink-0 p-2.5 rounded-xl border text-left w-[150px] flex flex-col gap-1 transition-all duration-300 ${!isEligible || !isMethodApplicable
                      ? "bg-foreground/[0.002] border-foreground/5 opacity-30 cursor-not-allowed"
                      : "bg-foreground/[0.015] border-foreground/5 hover:border-foreground/10 hover:bg-foreground/[0.02]"
                      }`}
                  >
                    <span className="font-mono text-[8px] font-light text-foreground bg-foreground/10 px-1 py-0.5 rounded uppercase tracking-wider self-start leading-none">
                      {coupon.code}
                    </span>
                    <p className="text-[9px] font-light text-foreground/80 leading-tight mt-0.5">
                      {benefitText} {coupon.applyAsStoreCredit ? "credited as cashback" : "instantly at checkout"}
                    </p>
                    <p className="text-[7px] text-foreground/35 font-light">
                      {Number(coupon.minOrderValue) > 0 ? `On orders above ₹${Number(coupon.minOrderValue).toLocaleString("en-IN")}` : "No minimum limit"}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* CTA Buttons based on Step */}
        <div className="mt-2">
          {step === 1 ? (
            showAddressForm ? (
              <button
                type="submit"
                form="address-form"
                disabled={loading}
                className="w-full h-11 rounded-xl bg-black text-white dark:bg-white dark:text-black hover:opacity-90 active:scale-[0.98] border border-black/10 dark:border-white/10 transition-all flex items-center justify-center gap-1.5 shadow-sm"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span className="text-[10px] font-bold tracking-[0.16em] uppercase">Continue to Payment</span>
                    <ChevronRight className="w-4 h-4" strokeWidth={2.5} />
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={loading || !selectedSavedId}
                className="w-full h-11 rounded-xl bg-black text-white dark:bg-white dark:text-black hover:opacity-90 active:scale-[0.98] border border-black/10 dark:border-white/10 transition-all flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                <span className="text-[10px] font-bold tracking-[0.16em] uppercase">Deliver to this Address</span>
                <ChevronRight className="w-4 h-4" strokeWidth={2.5} />
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={handlePlaceOrder}
              disabled={loading}
              className={`w-full ${paymentMethod === "COD" ? "h-13 pl-13" : "h-11 pl-11"
                } rounded-xl bg-black dark:bg-white text-white dark:text-black hover:opacity-95 active:scale-[0.98] border border-black/10 dark:border-white/10 transition-all flex items-center justify-between pr-1.5 disabled:opacity-50 shadow-sm`}
            >
              <span className="text-[9.5px] font-bold tracking-[0.16em] uppercase text-center flex-1 whitespace-nowrap">
                {loading
                  ? "PROCESSING..."
                  : finalTotal === 0
                  ? `PAY ${fmtAmount(0)} WITH STORE CREDIT`
                  : paymentMethod === "COD"
                  ? `PAY ${codFeeFormatted} & PLACE COD ORDER`
                  : `PAY ${fmtAmount(finalTotal)} SECURELY`}
              </span>
              <div className="w-8 h-8 rounded-lg bg-white/10 dark:bg-black/10 flex items-center justify-center text-white dark:text-black shrink-0">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" strokeWidth={2.5} />}
              </div>
            </button>
          )}

          <div className="flex items-center justify-center gap-1.5 mt-3 text-foreground/20">
            <Lock className="w-2.5 h-2.5" />
            <span className="text-[7.5px] font-bold uppercase tracking-[0.25em] leading-none">256-bit SSL secured transaction</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-[100dvh] relative bg-background text-foreground font-sans">
      <div className="relative z-10 max-w-xl md:max-w-5xl mx-auto px-4 pt-16 pb-8 md:pt-24 md:pb-12 flex flex-col" style={{ minHeight: '100dvh' }}>

        {/* Page Title & H1 */}
        <div className="mb-4 md:mb-6">
          <p className="text-[8px] font-extrabold uppercase tracking-[0.4em] text-foreground/40 mb-0.5 pl-0.5">YOUR PURCHASE</p>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-[32px] font-black tracking-tight text-foreground leading-none">Checkout</h1>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-8 items-start flex-1 w-full">
          {/* Left Column: Flow Steps */}
          <div className="col-span-12 md:col-span-7 flex flex-col w-full">
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0, y: -10 }}
                  animate={{ opacity: 1, height: "auto", y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -10 }}
                  className="overflow-hidden mb-4"
                >
                  <div className="flex items-start gap-2.5 p-3 rounded-xl border border-red-500/20 bg-red-500/[0.04] backdrop-blur-md text-red-400 text-[10px] font-semibold">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-400 mt-0.5" />
                    <p className="leading-relaxed">{error}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence mode="wait">
              {step === 1 ? (
                <motion.div
                  key="address"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="flex flex-col animate-in fade-in duration-300 w-full"
                >
                  <div className="flex flex-col gap-0.5 mb-4">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-foreground/80" strokeWidth={2.25} />
                      <h2 className="text-[10px] md:text-[12px] font-black uppercase tracking-[0.12em] text-foreground/90">
                        SHIPPING DETAILS
                      </h2>
                    </div>
                    <p className="text-[8px] font-bold uppercase tracking-[0.08em] text-foreground/40 pl-5">
                      WHERE SHOULD WE DELIVER?
                    </p>
                  </div>

                  {/* Saved Addresses list */}
                  {savedAddresses.length > 0 && !showAddressForm && (
                    <div className="mb-4">
                      <p className="text-[8px] font-black uppercase tracking-[0.2em] text-foreground/40 mb-2 pl-0.5">Saved Addresses</p>
                      <div className="flex gap-2.5 overflow-x-auto pb-2 scrollbar-none snap-x snap-mandatory">
                        {savedAddresses.map((addr) => {
                          const isSelected = selectedSavedId === addr.id;
                          return (
                            <button
                              key={addr.id}
                              type="button"
                              onClick={() => handleSelectSavedAddress(addr)}
                              className={`snap-start shrink-0 w-[185px] text-left p-3.5 rounded-2xl border transition-all duration-300 relative overflow-hidden backdrop-blur-md ${isSelected
                                ? "border-black/50 dark:border-white/40 bg-black/[0.04] dark:bg-white/[0.05] shadow-[0_0_15px_rgba(255,255,255,0.04)] scale-[1.02]"
                                : "border-black/[0.06] dark:border-white/[0.06] bg-white/30 dark:bg-black/20 hover:border-black/20 dark:hover:border-white/20"
                                }`}
                            >
                              {/* Glare effect inside selected card */}
                              {isSelected && (
                                <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.02] to-white/[0.08] pointer-events-none" />
                              )}
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[10px] font-bold truncate pr-1 text-foreground/90 flex items-center gap-1.5">
                                  {isSelected && <CheckCircle2 className="w-3 h-3 text-foreground/80 shrink-0" />}
                                  {addr.name}
                                </span>
                                {addr.isDefault && (
                                  <span className="px-1.5 py-0.5 rounded-md text-[5.5px] font-black uppercase tracking-wider bg-foreground text-background">
                                    Default
                                  </span>
                                )}
                              </div>
                              <p className="text-[8.5px] text-foreground/50 truncate leading-relaxed">
                                {addr.address1}{addr.address2 ? `, ${addr.address2}` : ""}
                              </p>
                              <p className="text-[8.5px] text-foreground/50 font-semibold leading-relaxed">
                                {addr.city}, {addr.state}
                              </p>
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSavedId("");
                            setAddress({
                              name: session?.user?.name || "",
                              email: session?.user?.email || "",
                              phone: (session as any)?.customer?.phone || (session?.user as any)?.phone || "",
                              houseNo: "", street: "",
                              landmark: "", city: "", state: "", zip: "", country: "India",
                            });
                            setAddressErrors({});
                            setShowAddressForm(true);
                          }}
                          className="snap-start shrink-0 p-3.5 rounded-2xl border border-dashed border-black/[0.12] dark:border-white/[0.12] bg-white/20 dark:bg-black/10 flex flex-col items-center justify-center gap-1.5 w-[100px] text-center transition-all duration-300 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] hover:border-black/30 dark:hover:border-white/30"
                        >
                          <Plus className="w-3.5 h-3.5 text-foreground/50" />
                          <span className="text-[7.5px] font-bold uppercase tracking-[0.1em] text-foreground/55">New</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Selected Address Display Card when form is hidden */}
                  {!showAddressForm && selectedSavedId && (
                    <div className="apple-glass-capsule p-5 rounded-2xl flex flex-col gap-4 mb-4 animate-in fade-in duration-300">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <p className="text-[8px] font-black uppercase tracking-[0.2em] text-foreground/45">Deliver to</p>
                          <span className="flex items-center gap-1 text-[8px] font-bold text-foreground/50 uppercase tracking-widest bg-foreground/[0.04] px-2 py-0.5 rounded-md border border-foreground/5">
                            <ShieldCheck className="w-3 h-3 text-foreground/40" /> Verified
                          </span>
                        </div>
                        <p className="text-sm font-extrabold tracking-tight">{address.name}</p>
                        <p className="text-[11px] text-foreground/60 leading-relaxed font-medium">
                          {address.houseNo}, {address.street}
                          {address.landmark ? `, ${address.landmark}` : ""}
                        </p>
                        <p className="text-[11px] text-foreground/60 leading-relaxed font-semibold">
                          {address.city}, {address.state} — {address.zip}
                        </p>
                        <p className="text-[10px] text-foreground/50 font-bold uppercase tracking-wider flex items-center gap-1.5 pt-1 border-t border-foreground/5 mt-2">
                          <Smartphone className="w-3.5 h-3.5 text-foreground/35" />
                          +91 {address.phone.replace("+91", "").replace("+91", "")}
                        </p>
                      </div>

                      <div className="flex flex-col gap-2 pt-3 border-t border-white/10">
                        <button
                          type="button"
                          onClick={() => setStep(2)}
                          className="w-full h-11 bg-black text-white dark:bg-white dark:text-black rounded-xl text-[10px] font-bold uppercase tracking-[0.2em] hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 shadow-sm md:hidden"
                        >
                          <span>Deliver to this Address</span>
                          <ChevronRight className="w-3.5 h-3.5" strokeWidth={3} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSavedId("");
                            setAddress({
                              name: session?.user?.name || "",
                              email: session?.user?.email || "",
                              phone: (session as any)?.customer?.phone || (session?.user as any)?.phone || "",
                              houseNo: "", street: "",
                              landmark: "", city: "", state: "", zip: "", country: "India",
                            });
                            setAddressErrors({});
                            setShowAddressForm(true);
                          }}
                          className="w-full h-10 text-[8.5px] font-semibold uppercase tracking-[0.15em] bg-transparent border border-dashed border-black/[0.12] dark:border-white/[0.12] hover:bg-black/[0.02] dark:hover:bg-white/[0.02] active:scale-[0.98] rounded-xl text-foreground/75 transition-all flex items-center justify-center gap-1.5 whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add New Address
                        </button>
                      </div>
                    </div>
                  )}

                  {showAddressForm && (
                    <form id="address-form" onSubmit={handleAddressSubmit} className="flex-1 flex flex-col w-full">
                      <style>{`
                        .pac-container {
                          background-color: #121212 !important;
                          border: 1px solid rgba(255, 255, 255, 0.08) !important;
                          border-radius: 12px !important;
                          box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5), 0 8px 10px -6px rgba(0,0,0,0.5) !important;
                          font-family: inherit !important;
                          margin-top: 4px !important;
                          z-index: 9999 !important;
                        }
                        .pac-item {
                          border-top: 1px solid rgba(255, 255, 255, 0.05) !important;
                          padding: 10px 14px !important;
                          color: rgba(255, 255, 255, 0.8) !important;
                          font-size: 13px !important;
                          cursor: pointer !important;
                          display: flex !important;
                          align-items: center !important;
                        }
                        .pac-item:hover, .pac-item-selected {
                          background-color: rgba(255, 255, 255, 0.05) !important;
                        }
                        .pac-item-query {
                          font-size: 13px !important;
                          color: #ffffff !important;
                          padding-right: 4px !important;
                        }
                        .pac-matched {
                          font-weight: 700 !important;
                        }
                        .pac-icon {
                          margin-right: 10px !important;
                          filter: invert(1) !important;
                        }
                      `}</style>
                      {savedAddresses.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const def = savedAddresses.find((a: DBAddress) => a.id === selectedSavedId) || savedAddresses[0];
                            if (def) {
                              handleSelectSavedAddress(def);
                            }
                            setShowAddressForm(false);
                          }}
                          className="w-full h-14 px-4 rounded-2xl border border-black/[0.08] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] backdrop-blur-md hover:bg-black/[0.04] dark:hover:bg-white/[0.05] active:scale-[0.98] transition-all flex items-center justify-between text-foreground mb-5 cursor-pointer"
                        >
                          <div className="flex items-center gap-3">
                            <Folder className="w-5 h-5 text-foreground/70" />
                            <span className="text-[14px] font-medium">Use saved addresses</span>
                          </div>
                          <ChevronRight className="w-5 h-5 text-foreground/70" />
                        </button>
                      )}

                      {/* Search and Geolocation Card */}
                      <div className="p-4 mb-5 rounded-2xl border border-black/[0.06] dark:border-white/[0.08] bg-white/10 dark:bg-white/[0.02] backdrop-blur-md flex flex-col gap-3 shadow-sm">
                        <div className="flex flex-row gap-2.5 w-full">
                          {/* Autocomplete Input & Suggestions Dropdown */}
                          <div ref={searchContainerRef} className="flex-1 relative">
                            <div className="relative flex items-center h-[46px] rounded-xl px-3 transition-all duration-300 backdrop-blur-md border border-black/[0.08] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.02)] focus-within:border-foreground/40 dark:focus-within:border-white/30">
                              <MapPin className="w-4 h-4 text-foreground/40 mr-2 shrink-0" />
                              <input
                                ref={autocompleteInputRef}
                                type="text"
                                placeholder="Search area, locality, or landmark"
                                onInput={(e) => handleSearchInput((e.target as HTMLInputElement).value)}
                                onChange={(e) => handleSearchInput(e.target.value)}
                                onFocus={() => {
                                  if (suggestions.length > 0) setShowSuggestions(true);
                                }}
                                className="flex-1 min-w-0 h-full bg-transparent border-0 outline-none text-[15px] text-foreground placeholder:text-foreground/35 p-0"
                              />
                              {searchLoading && (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-foreground/40 ml-2 shrink-0" />
                              )}
                            </div>

                            {/* Fallback Location Suggestions Dropdown */}
                            <AnimatePresence>
                              {showSuggestions && suggestions.length > 0 && (
                                <motion.div
                                  initial={{ opacity: 0, y: -4 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -4 }}
                                  className="absolute left-0 right-0 top-[50px] z-50 rounded-xl border border-black/10 dark:border-white/10 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl shadow-xl overflow-hidden py-1 max-h-[260px] overflow-y-auto"
                                >
                                  {suggestions.map((item) => (
                                    <button
                                      key={item.placeId}
                                      type="button"
                                      onClick={() => handleSelectSuggestion(item)}
                                      className="w-full text-left px-3.5 py-2.5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors flex items-start gap-2.5 border-b last:border-b-0 border-black/[0.04] dark:border-white/[0.04]"
                                    >
                                      <MapPin className="w-4 h-4 text-foreground/50 shrink-0 mt-0.5" />
                                      <div className="flex flex-col min-w-0">
                                        <span className="text-[13px] font-semibold text-foreground truncate">
                                          {item.mainText}
                                        </span>
                                        {item.secondaryText && (
                                          <span className="text-[11px] text-foreground/50 truncate">
                                            {item.secondaryText}
                                          </span>
                                        )}
                                      </div>
                                    </button>
                                  ))}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>

                        {/* Use Current Location Button */}
                        <button
                          type="button"
                          onClick={handleDetectLocation}
                          disabled={locating}
                          className="w-full h-[46px] rounded-xl border border-black/[0.08] dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.03] backdrop-blur-md text-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.05] active:scale-[0.98] transition-all flex items-center justify-center gap-2 text-[14px] font-medium shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.02)] cursor-pointer"
                        >
                          {locating ? (
                            <Loader2 className="w-4 h-4 animate-spin text-current" />
                          ) : (
                            <Navigation className="w-3.5 h-3.5 rotate-45 text-current shrink-0" />
                          )}
                          <span>Detect my location</span>
                        </button>
                      </div>

                      {/* Section 1: Contact Details */}
                      <div className="flex flex-col gap-0.5 mb-3.5 pl-0.5">
                        <p className="text-[8px] font-black uppercase tracking-[0.2em] text-foreground/45">Contact Details</p>
                      </div>
                      <div className="grid grid-cols-12 gap-3.5 w-full mb-6">
                        {/* Full Name */}
                        <div className="col-span-6">
                          <div className={`relative flex items-center w-full h-[46px] rounded-xl px-3 transition-all duration-300 backdrop-blur-md ${addressErrors.name ? "border border-red-500/40 bg-red-500/[0.02]" : "border border-black/[0.08] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.02)] focus-within:border-foreground/40 dark:focus-within:border-white/30"}`}>
                            <User className="w-4 h-4 text-foreground/40 mr-2 shrink-0" />
                            <input
                              id="address-name"
                              name="name"
                              type="text"
                              placeholder="Full Name"
                              aria-label="Full Name"
                              autoComplete="name"
                              required
                              value={address.name}
                              onChange={(e) => updateField("name", e.target.value)}
                              className="flex-1 min-w-0 h-full bg-transparent border-0 outline-none text-[15px] font-sans font-normal text-foreground placeholder:text-foreground/35 p-0"
                            />
                          </div>
                          {addressErrors.name && <p className="text-[8px] text-red-500 mt-1 pl-1 leading-none">{addressErrors.name}</p>}
                        </div>

                        {/* Email Address */}
                        <div className="col-span-6">
                          <div className={`relative flex items-center w-full h-[46px] rounded-xl px-3 transition-all duration-300 backdrop-blur-md ${addressErrors.email ? "border border-red-500/40 bg-red-500/[0.02]" : "border border-black/[0.08] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.02)] focus-within:border-foreground/40 dark:focus-within:border-white/30"}`}>
                            <Mail className="w-4 h-4 text-foreground/40 mr-2 shrink-0" />
                            <input
                              id="address-email"
                              name="email"
                              type="email"
                              placeholder="Email Address"
                              aria-label="Email"
                              autoComplete="email"
                              required
                              value={address.email}
                              onChange={(e) => updateField("email", e.target.value)}
                              className="flex-1 min-w-0 h-full bg-transparent border-0 outline-none text-[15px] font-sans font-normal text-foreground placeholder:text-foreground/35 p-0"
                            />
                          </div>
                          {addressErrors.email && <p className="text-[8px] text-red-500 mt-1 pl-1 leading-none">{addressErrors.email}</p>}
                        </div>

                        {/* Mobile Number */}
                        <div className="col-span-12">
                          <div className={`relative flex items-center w-full h-[46px] rounded-xl px-3 transition-all duration-300 backdrop-blur-md ${addressErrors.phone ? "border border-red-500/40 bg-red-500/[0.02]" : "border border-black/[0.08] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.02)] focus-within:border-foreground/40 dark:focus-within:border-white/30"}`}>
                            {isIndia(address.country, address.countryCode) ? (
                              <>
                                <div className="flex items-center text-[15px] font-semibold text-foreground/60 select-none mr-2 pl-1">
                                  <span>+91</span>
                                </div>
                                <div className="h-4 w-[1px] bg-black/[0.08] dark:bg-white/[0.08] mr-2.5 shrink-0" />
                                <input
                                  id="address-phone"
                                  name="phone"
                                  type="tel"
                                  placeholder="Mobile Number"
                                  aria-label="Mobile Number"
                                  autoComplete="tel"
                                  inputMode="tel"
                                  required
                                  value={address.phone.startsWith("+91") ? address.phone.slice(3) : address.phone}
                                  onChange={(e) => updateField("phone", e.target.value)}
                                  className="flex-1 min-w-0 h-full bg-transparent border-0 outline-none text-[15px] font-sans font-normal text-foreground placeholder:text-foreground/35 p-0"
                                />
                              </>
                            ) : (
                              <input
                                id="address-phone"
                                name="phone"
                                type="tel"
                                placeholder="Mobile Number (with country code)"
                                aria-label="Mobile Number"
                                autoComplete="tel"
                                inputMode="tel"
                                required
                                value={address.phone}
                                onChange={(e) => updateField("phone", e.target.value)}
                                className="flex-1 min-w-0 h-full bg-transparent border-0 outline-none text-[15px] font-sans font-normal text-foreground placeholder:text-foreground/35 p-0"
                              />
                            )}
                          </div>
                          {addressErrors.phone && <p className="text-[8px] text-red-500 mt-1 pl-1 leading-none">{addressErrors.phone}</p>}
                        </div>
                      </div>

                      {/* Section 2: Shipping Address */}
                      <div className="flex flex-col gap-0.5 mb-3.5 pl-0.5">
                        <p className="text-[8px] font-black uppercase tracking-[0.2em] text-foreground/45">Delivery Address</p>
                      </div>
                      <div className="grid grid-cols-12 gap-3.5 w-full">
                        {/* House / Flat / Building */}
                        <div className="col-span-6">
                          <div className={`relative flex items-center w-full h-[46px] rounded-xl px-3 transition-all duration-300 backdrop-blur-md ${addressErrors.houseNo ? "border border-red-500/40 bg-red-500/[0.02]" : "border border-black/[0.08] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.02)] focus-within:border-foreground/40 dark:focus-within:border-white/30"}`}>
                            <Home className="w-4 h-4 text-foreground/40 mr-2 shrink-0" />
                            <input
                              id="address-house"
                              name="houseNo"
                              type="text"
                              placeholder="House/Flat"
                              aria-label="House, Flat, Tower, or Building Details"
                              autoComplete="address-line2"
                              required
                              value={address.houseNo}
                              onChange={(e) => updateField("houseNo", e.target.value, true)}
                              className="flex-1 min-w-0 h-full bg-transparent border-0 outline-none text-[15px] font-sans font-normal text-foreground placeholder:text-foreground/35 p-0"
                            />
                          </div>
                          {addressErrors.houseNo && <p className="text-[8px] text-red-500 mt-1 pl-1 leading-none">{addressErrors.houseNo}</p>}
                        </div>

                        {/* Street / Road / Area */}
                        <div className="col-span-6">
                          <div className={`relative flex items-center w-full h-[46px] rounded-xl px-3 transition-all duration-300 backdrop-blur-md ${addressErrors.street ? "border border-red-500/40 bg-red-500/[0.02]" : "border border-black/[0.08] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.02)] focus-within:border-foreground/40 dark:focus-within:border-white/30"}`}>
                            <svg
                              className="w-4 h-4 text-foreground/40 mr-2 shrink-0"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M18 22L14 2M6 22L10 2M12 2v4M12 9v3M12 15v3" />
                            </svg>
                            <input
                              id="address-street"
                              name="street"
                              type="text"
                              placeholder="Street/Road"
                              aria-label="Street, Road, or Area"
                              autoComplete="address-line1"
                              required
                              value={address.street}
                              onChange={(e) => updateField("street", e.target.value, true)}
                              className="flex-1 min-w-0 h-full bg-transparent border-0 outline-none text-[15px] font-sans font-normal text-foreground placeholder:text-foreground/35 p-0"
                            />
                          </div>
                          {addressErrors.street && <p className="text-[8px] text-red-500 mt-1 pl-1 leading-none">{addressErrors.street}</p>}
                        </div>

                        {/* Landmark */}
                        <div className="col-span-6">
                          <div className={`relative flex items-center w-full h-[46px] rounded-xl px-3 transition-all duration-300 backdrop-blur-md border border-black/[0.08] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.02)] focus-within:border-foreground/40 dark:focus-within:border-white/30`}>
                            <Tag className="w-4 h-4 text-foreground/40 mr-2 shrink-0" />
                            <input
                              id="address-landmark"
                              name="landmark"
                              type="text"
                              placeholder="Landmark"
                              aria-label="Landmark"
                              autoComplete="address-line3"
                              value={address.landmark}
                              onChange={(e) => updateField("landmark", e.target.value, true)}
                              className="flex-1 min-w-0 h-full bg-transparent border-0 outline-none text-[15px] font-sans font-normal text-foreground placeholder:text-foreground/35 p-0"
                            />
                          </div>
                        </div>

                        {/* PIN / ZIP Code */}
                        <div className="col-span-6">
                          <div className={`relative flex items-center w-full h-[46px] rounded-xl px-3 transition-all duration-300 backdrop-blur-md ${addressErrors.zip ? "border border-red-500/40 bg-red-500/[0.02]" : "border border-black/[0.08] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.02)] focus-within:border-foreground/40 dark:focus-within:border-white/30"}`}>
                            <Map className="w-4 h-4 text-foreground/40 mr-2 shrink-0" />
                            <input
                              id="address-zip"
                              name="zip"
                              type="text"
                              placeholder={isIndia(address.country, address.countryCode) ? "PIN Code" : "Postal / ZIP Code"}
                              aria-label={isIndia(address.country, address.countryCode) ? "PIN Code" : "Postal / ZIP Code"}
                              autoComplete="postal-code"
                              inputMode={isIndia(address.country, address.countryCode) ? "numeric" : "text"}
                              required
                              maxLength={isIndia(address.country, address.countryCode) ? 6 : 12}
                              value={address.zip}
                              onChange={(e) => {
                                const val = isIndia(address.country, address.countryCode)
                                  ? e.target.value.replace(/\D/g, '').slice(0, 6)
                                  : e.target.value;
                                updateField("zip", val);
                              }}
                              className="flex-1 min-w-0 h-full bg-transparent border-0 outline-none text-[15px] font-sans font-normal text-foreground placeholder:text-foreground/35 p-0"
                            />
                            {zipLoading && (
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-foreground/30 ml-1.5 shrink-0" />
                            )}
                          </div>
                          {addressErrors.zip && <p className="text-[8px] text-red-500 mt-1 pl-1 leading-none">{addressErrors.zip}</p>}
                        </div>

                        {/* City */}
                        <div className="col-span-6">
                          <div className={`relative flex items-center w-full h-[46px] rounded-xl px-3 transition-all duration-300 backdrop-blur-md ${addressErrors.city ? "border border-red-500/40 bg-red-500/[0.02]" : "border border-black/[0.08] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.02)] focus-within:border-foreground/40 dark:focus-within:border-white/30"}`}>
                            <Building2 className="w-4 h-4 text-foreground/40 mr-2 shrink-0" />
                            <input
                              id="address-city"
                              name="city"
                              type="text"
                              placeholder="City"
                              aria-label="City"
                              autoComplete="address-level2"
                              required
                              value={address.city}
                              onChange={(e) => updateField("city", e.target.value)}
                              className="flex-1 min-w-0 h-full bg-transparent border-0 outline-none text-[15px] font-sans font-normal text-foreground placeholder:text-foreground/35 p-0"
                            />
                          </div>
                          {addressErrors.city && <p className="text-[8px] text-red-500 mt-1 pl-1 leading-none">{addressErrors.city}</p>}
                        </div>

                        {/* Country Selector */}
                        <div className="col-span-6">
                          <div className={`relative flex items-center w-full h-[46px] rounded-xl px-3 transition-all duration-300 backdrop-blur-md ${addressErrors.country ? "border border-red-500/40 bg-red-500/[0.02]" : "border border-black/[0.08] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.02)] focus-within:border-foreground/40 dark:focus-within:border-white/30"}`}>
                            <Globe className="w-4 h-4 text-foreground/40 mr-2 shrink-0" />
                            <span className={`text-[15px] font-sans font-normal truncate pr-4 ${!address.country ? "text-foreground/35" : "text-foreground"}`}>
                              {address.country || "Select Country"}
                            </span>
                            <ChevronDown className="absolute right-3 w-4 h-4 text-foreground/40 pointer-events-none" />
                            <select
                              id="address-country"
                              name="country"
                              required
                              autoComplete="country-name"
                              value={address.country}
                              onChange={(e) => {
                                const selectedName = e.target.value;
                                const found = findCountry(selectedName);
                                updateField("country", found.name);
                                setAddress(prev => ({ ...prev, country: found.name, countryCode: found.code }));
                              }}
                              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-[15px]"
                            >
                              {COUNTRIES.map(c => (
                                <option key={c.code} value={c.name} className="bg-background text-foreground text-[15px]">{c.name}</option>
                              ))}
                            </select>
                          </div>
                          {addressErrors.country && <p className="text-[8px] text-red-500 mt-1 pl-1 leading-none">{addressErrors.country}</p>}
                        </div>

                        {/* State */}
                        <div className="col-span-6">
                          <div className={`relative flex items-center w-full h-[46px] rounded-xl px-3 transition-all duration-300 backdrop-blur-md ${addressErrors.state ? "border border-red-500/40 bg-red-500/[0.02]" : "border border-black/[0.08] dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02] shadow-[inset_0_1px_1px_rgba(255,255,255,0.2),0_1px_2px_rgba(0,0,0,0.02)] focus-within:border-foreground/40 dark:focus-within:border-white/30"}`}>
                            <MapPin className="w-4 h-4 text-foreground/40 mr-2 shrink-0" />
                            {isIndia(address.country, address.countryCode) ? (
                              <>
                                <span className={`text-[15px] font-sans font-normal truncate pr-4 ${!address.state ? "text-foreground/35" : "text-foreground"}`}>
                                  {address.state || "Select State"}
                                </span>
                                <ChevronDown className="absolute right-3 w-4 h-4 text-foreground/40 pointer-events-none" />
                                <select
                                  id="address-state"
                                  name="state"
                                  required
                                  autoComplete="address-level1"
                                  value={address.state}
                                  onChange={(e) => updateField("state", e.target.value)}
                                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer text-[15px]"
                                >
                                  <option value="" disabled>Select State</option>
                                  {INDIAN_STATES.map(s => (
                                    <option key={s} value={s} className="bg-background text-foreground text-[15px]">{s}</option>
                                  ))}
                                </select>
                              </>
                            ) : (
                              <input
                                id="address-state"
                                name="state"
                                type="text"
                                placeholder="State / Province / Region"
                                aria-label="State / Province / Region"
                                autoComplete="address-level1"
                                required
                                value={address.state}
                                onChange={(e) => updateField("state", e.target.value)}
                                className="flex-1 min-w-0 h-full bg-transparent border-0 outline-none text-[15px] font-sans font-normal text-foreground placeholder:text-foreground/35 p-0"
                              />
                            )}
                          </div>
                          {addressErrors.state && <p className="text-[8px] text-red-500 mt-1 pl-1 leading-none">{addressErrors.state}</p>}
                        </div>
                      </div>

                      {/* Mobile Step 1 CTA button (inside form container) */}
                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full h-11 bg-foreground text-background dark:bg-white dark:text-black rounded-xl text-[10px] font-black uppercase tracking-[0.2em] hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 shadow-md mt-6 md:hidden cursor-pointer"
                      >
                        {loading ? (
                          <Loader2 className="w-4 h-4 animate-spin text-current" />
                        ) : (
                          <>
                            <span>Continue to Payment</span>
                            <ChevronRight className="w-3.5 h-3.5" strokeWidth={3} />
                          </>
                        )}
                      </button>
                    </form>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="payment"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="flex-1 flex flex-col w-full"
                >
                  <div className="flex-1 flex flex-col w-full">
                    <div className="flex flex-col gap-0.5 mb-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setStep(1)}
                          className="p-1 rounded-lg hover:bg-foreground/5 transition-colors -ml-1 mr-1"
                          aria-label="Go back to shipping details"
                        >
                          <ChevronLeft className="w-4 h-4 text-foreground/80" strokeWidth={2.25} />
                        </button>
                        <CreditCard className="w-3.5 h-3.5 text-foreground/80" strokeWidth={2.25} />
                        <h2 className="text-[10px] md:text-[12px] font-black uppercase tracking-[0.12em] text-foreground/90">
                          PAYMENT DETAILS
                        </h2>
                      </div>
                      <p className="text-[8px] font-bold uppercase tracking-[0.08em] text-foreground/40 pl-8">
                        CHOOSE HOW YOU WANT TO PAY
                      </p>
                    </div>

                    {/* Mobile Step 2 Order Summary block */}
                    <div className="md:hidden flex flex-col w-full mb-4">
                      {renderOrderSummary()}
                    </div>

                    {/* Desktop Payment Selector */}
                    {renderPaymentSelector(false)}



                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Right Column: Order Summary (Desktop only) */}
          <div className="hidden md:flex col-span-12 md:col-span-5 flex-col gap-4 w-full sticky top-24">
            <h2 className="text-[10px] font-black uppercase tracking-[0.12em] text-foreground/80 pl-0.5 leading-none">ORDER SUMMARY</h2>
            {renderOrderSummary()}
          </div>
        </div>
      </div>
    </div>
  );
}
