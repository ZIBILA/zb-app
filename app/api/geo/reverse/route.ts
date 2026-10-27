import { NextRequest, NextResponse } from "next/server";
import { matchIndianState } from "@/lib/countries";
import {
  buildDeliveryStreet,
  isAdministrativeNoise,
  stripLeadingHouseFromStreet,
} from "@/lib/parseDetectedAddress";

export const dynamic = "force-dynamic";

interface ReverseGeoResponse {
  ok: boolean;
  formattedAddress?: string;
  houseNo?: string;
  street?: string;
  landmark?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  countryCode?: string;
  placeId?: string;
  lat?: number;
  lng?: number;
  source?: string;
  error?: string;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const latStr = searchParams.get("lat");
    const lngStr = searchParams.get("lng");

    if (!latStr || !lngStr) {
      return NextResponse.json(
        { ok: false, error: "lat and lng parameters are required" },
        { status: 400 }
      );
    }

    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return NextResponse.json(
        { ok: false, error: "Invalid latitude or longitude" },
        { status: 400 }
      );
    }

    // ── Strategy 1: Google Maps Geocoding API (Dedicated server key or general maps key) ──
    const googleServerKey =
      process.env.GOOGLE_MAPS_SERVER_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
      "";

    if (googleServerKey) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const gmUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${googleServerKey}`;
        const gmRes = await fetch(gmUrl, { signal: controller.signal, next: { revalidate: 3600 } });
        clearTimeout(timeoutId);
        if (gmRes.ok) {
          const gmData = await gmRes.json();
          if (gmData.status === "OK" && gmData.results && gmData.results[0]) {
            const first = gmData.results[0];
            const components: any[] = first.address_components || [];

            let houseNo = "";
            let street = "";
            let landmark = "";
            let city = "";
            let state = "";
            let zip = "";
            let country = "India";
            let countryCode = "IN";

            for (const c of components) {
              const types = c.types || [];
              const longName = String(c.long_name || "").trim();
              if (!longName) continue;

              // Keep premise/street_number in houseNo only — never merge into street
              if (types.includes("street_number") || types.includes("premise") || types.includes("subpremise")) {
                houseNo = houseNo ? `${houseNo}, ${longName}` : longName;
                continue;
              }
              if (types.includes("route")) {
                street = street ? `${longName}, ${street}` : longName;
              }
              if (types.includes("sublocality") || types.includes("sublocality_level_1") || types.includes("neighborhood")) {
                if (isAdministrativeNoise(longName)) continue;
                if (!street) {
                  street = longName;
                } else {
                  landmark = landmark ? `${landmark}, ${longName}` : longName;
                }
              }
              if (types.includes("locality")) {
                city = longName;
              } else if (
                !city &&
                (types.includes("administrative_area_level_2") || types.includes("postal_town")) &&
                !isAdministrativeNoise(longName)
              ) {
                city = longName;
              }
              if (types.includes("administrative_area_level_1")) {
                state = longName;
              }
              if (types.includes("postal_code")) {
                zip = longName;
              }
              if (types.includes("country")) {
                country = longName;
                countryCode = (c.short_name || "IN").toUpperCase();
              }
            }

            const cleanStreet =
              buildDeliveryStreet([street, landmark]) ||
              stripLeadingHouseFromStreet(first.formatted_address?.split(",")[0] || "");

            return NextResponse.json<ReverseGeoResponse>({
              ok: true,
              formattedAddress: first.formatted_address || "",
              // Returned for callers that want it, but clients must leave Flat empty for manual entry
              houseNo,
              street: cleanStreet,
              landmark: buildDeliveryStreet([landmark]),
              city: isAdministrativeNoise(city) ? "" : city,
              state: matchIndianState(state) || state,
              zip,
              country,
              countryCode,
              placeId: first.place_id || undefined,
              lat,
              lng,
              source: "google",
            });
          }
        }
      } catch (gmErr) {
        console.warn("[ReverseGeo] Google Geocoding API skipped/failed:", gmErr);
      }
    }

    // ── Strategy 2: OpenStreetMap Nominatim (Fast & Reliable) ──────────────
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
      const nomRes = await fetch(nomUrl, {
        headers: {
          "Accept-Language": "en",
          "User-Agent": "ZicaBellaStore/2.0 (support@zicabella.com)",
        },
        signal: controller.signal,
        next: { revalidate: 3600 },
      });
      clearTimeout(timeoutId);

      if (nomRes.ok) {
        const data = await nomRes.json();
        if (data && data.address) {
          const addr = data.address;
          const houseNo = addr.house_number || addr.building || "";
          const road = addr.road || addr.residential || "";
          const suburbRaw = addr.suburb || addr.neighbourhood || addr.quarter || "";
          const suburb = isAdministrativeNoise(suburbRaw) ? "" : suburbRaw;
          const subdistrict = isAdministrativeNoise(addr.subdistrict || "")
            ? ""
            : addr.subdistrict || "";
          const street = buildDeliveryStreet([road, suburb, subdistrict]);
          const cityRaw =
            addr.city || addr.town || addr.village || addr.county || addr.state_district || "";
          const city = isAdministrativeNoise(cityRaw) ? "" : cityRaw;
          const rawState = addr.state || "";
          const state = matchIndianState(rawState) || rawState;
          const zip = (addr.postcode || "").replace(/\s/g, "").slice(0, 6);
          const country = addr.country || "India";
          const countryCode = (addr.country_code || "in").toUpperCase();

          return NextResponse.json<ReverseGeoResponse>({
            ok: true,
            formattedAddress: data.display_name || "",
            houseNo,
            street: street || stripLeadingHouseFromStreet(data.display_name?.split(",")[0] || ""),
            landmark: suburb && suburb !== street ? suburb : "",
            city,
            state,
            zip,
            country,
            countryCode,
            lat,
            lng,
            source: "nominatim",
          });
        }
      }
    } catch (nomErr) {
      console.warn("[ReverseGeo] Nominatim failed, trying BigDataCloud");
    }

    // ── Strategy 3: BigDataCloud Client-Free Reverse Geocode ───────────
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const bdcUrl = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`;
      const bdcRes = await fetch(bdcUrl, { signal: controller.signal, next: { revalidate: 3600 } });
      clearTimeout(timeoutId);

      if (bdcRes.ok) {
        const data = await bdcRes.json();
        if (data) {
          const locality = isAdministrativeNoise(data.locality || "")
            ? ""
            : data.locality || "";
          // Avoid principalSubdivisionDescription — often "Meerut Division"-style admin labels
          const street = buildDeliveryStreet([locality]);
          const cityRaw = data.city || locality || "";
          const city = isAdministrativeNoise(cityRaw) ? "" : cityRaw;
          const rawState = data.principalSubdivision || "";
          const state = matchIndianState(rawState) || rawState;
          const rawZip = data.postcode || "";
          const zip = rawZip && rawZip !== "0" ? rawZip.replace(/\s/g, "").slice(0, 6) : "";
          const country = data.countryName || "India";
          const countryCode = (data.countryCode || "IN").toUpperCase();

          return NextResponse.json<ReverseGeoResponse>({
            ok: true,
            formattedAddress: [street, city, state, zip, country].filter(Boolean).join(", "),
            street,
            city,
            state,
            zip,
            country,
            countryCode,
            lat,
            lng,
            source: "bigdatacloud",
          });
        }
      }
    } catch (bdcErr) {
      console.warn("[ReverseGeo] BigDataCloud failed");
    }

    // ── Strategy 4: Resilient Fallback ─────────────────────────────────
    return NextResponse.json<ReverseGeoResponse>({
      ok: true,
      formattedAddress: "India",
      street: "",
      city: "",
      state: "",
      zip: "",
      country: "India",
      countryCode: "IN",
      lat,
      lng,
      source: "fallback",
    });
  } catch (error: any) {
    console.error("[ReverseGeo] Unexpected error:", error);
    return NextResponse.json<ReverseGeoResponse>(
      { ok: false, error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
