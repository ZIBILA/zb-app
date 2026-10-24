"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { getCountryCentroid } from "@/lib/country-centroids";

// Dynamic import of Globe component from react-globe.gl (CSR only with ref forwarding)
const Globe = dynamic(
  () =>
    import("react-globe.gl").then((mod) => {
      const Component = mod.default;
      return function GlobeInner({ forwardedRef, ...props }: any) {
        return <Component ref={forwardedRef} {...props} />;
      };
    }),
  { ssr: false }
);

export interface VisitorPoint {
  countryCode: string;
  country: string;
  city: string;
  lat: number | null;
  lng: number | null;
  count: number;
}

export interface Globe3DProps {
  points?: VisitorPoint[];
  countries?: Record<string, number>;
  unknownCount?: number;
}

interface ProcessedPoint {
  lat: number;
  lng: number;
  countryCode: string;
  country: string;
  city: string;
  count: number;
  color: string;
  size: number;
}

interface RingPoint {
  lat: number;
  lng: number;
  count: number;
}

// ─── Color Palette for Globe Points ─────────────────────
// Vibrant warm tones that pop on a blue satellite globe
const getPointColor = (count: number): string => {
  if (count > 10) return "#ef4444";  // Red – heavy traffic
  if (count > 5) return "#f97316";   // Orange – high traffic
  if (count > 2) return "#eab308";   // Yellow – moderate
  return "#10b981";                   // Emerald – single/light
};

export default function Globe3D({ points = [], countries = {}, unknownCount = 0 }: Globe3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const globeEl = useRef<any>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 320, height: 320 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Handle responsive container resizing
  useEffect(() => {
    if (!containerRef.current) return;

    const updateDimensions = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        const w = clientWidth > 0 ? clientWidth : 320;
        const h = clientHeight > 0 ? clientHeight : w; // keep square ratio if height is 0
        setDimensions({ width: w, height: h });
      }
    };

    updateDimensions();

    const resizeObserver = new ResizeObserver(() => {
      updateDimensions();
    });

    resizeObserver.observe(containerRef.current);

    return () => resizeObserver.disconnect();
  }, []);

  // Process visitor points and map missing lat/lng to country centroids
  const processedPoints = useMemo<ProcessedPoint[]>(() => {
    const list: ProcessedPoint[] = [];

    // 1. Process explicit visitor points
    if (points && points.length > 0) {
      points.forEach((p) => {
        let lat = p.lat;
        let lng = p.lng;

        if (lat == null || lng == null) {
          const centroid = getCountryCentroid(p.countryCode);
          if (centroid) {
            lat = centroid[0];
            lng = centroid[1];
          }
        }

        if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
          list.push({
            lat,
            lng,
            countryCode: p.countryCode || "XX",
            country: p.country || "Unknown",
            city: p.city || "Unknown",
            count: p.count || 1,
            color: getPointColor(p.count || 1),
            size: Math.min(0.8, 0.15 + (p.count || 1) * 0.06),
          });
        }
      });
    } else if (countries && Object.keys(countries).length > 0) {
      // 2. Fallback to country count breakdown if points list is not supplied directly
      Object.entries(countries).forEach(([countryKey, count]) => {
        if (count > 0 && countryKey !== "unknown") {
          const centroid = getCountryCentroid(countryKey);
          if (centroid) {
            list.push({
              lat: centroid[0],
              lng: centroid[1],
              countryCode: countryKey.toUpperCase(),
              country: countryKey,
              city: "Centroid",
              count,
              color: getPointColor(count),
              size: Math.min(0.8, 0.15 + count * 0.06),
            });
          }
        }
      });
    }

    return list;
  }, [points, countries]);

  // Rings data for live pulse animation
  const ringPoints = useMemo<RingPoint[]>(() => {
    return processedPoints.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      count: p.count,
    }));
  }, [processedPoints]);

  // Configure Globe controls once mounted
  useEffect(() => {
    if (globeEl.current) {
      const controls = globeEl.current.controls();
      if (controls) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.6;
        controls.enableZoom = true;
        controls.minDistance = 180;
        controls.maxDistance = 450;
      }

      // Set initial point-of-view to show India/Asia region (primary audience)
      globeEl.current.pointOfView({ lat: 20, lng: 78, altitude: 2.2 }, 1000);
    }
  }, [mounted, dimensions]);

  if (!mounted) {
    return (
      <div ref={containerRef} className="relative w-full aspect-square flex items-center justify-center bg-foreground/[0.02] rounded-2xl">
        <div className="w-6 h-6 border-2 border-foreground/20 border-t-foreground/80 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full aspect-square flex items-center justify-center select-none overflow-hidden rounded-2xl">
      <Globe
        forwardedRef={globeEl}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor="rgba(0, 0, 0, 0)"
        globeImageUrl="/globe/earth-blue-marble.jpg"
        bumpImageUrl="/globe/earth-topology.png"
        atmosphereColor="#3b82f6"
        atmosphereAltitude={0.25}
        showAtmosphere={true}
        
        // Points layer
        pointsData={processedPoints}
        pointColor={(d: any) => d.color || "#10b981"}
        pointAltitude={0.04}
        pointRadius={(d: any) => d.size || 0.2}
        pointResolution={32}
        pointsMerge={false}

        // Tooltip formatting
        pointLabel={(d: any) => `
          <div style="
            background: rgba(10, 10, 18, 0.94);
            backdrop-filter: blur(16px);
            color: #ffffff;
            padding: 10px 14px;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 11px;
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
            pointer-events: none;
            line-height: 1.5;
            min-width: 140px;
          ">
            <div style="font-weight: 700; color: #93c5fd; margin-bottom: 3px; font-size: 12px;">
              ${d.city && d.city !== "Unknown" && d.city !== "Centroid" ? `${d.city}, ` : ""}${d.country}
            </div>
            <div style="color: #94a3b8; font-size: 10px; display: flex; align-items: center; gap: 6px;">
              <span style="display: inline-flex; align-items: center; gap: 3px;">
                <span style="width: 6px; height: 6px; border-radius: 50%; background: ${d.color}; display: inline-block;"></span>
                <span style="color: #e2e8f0; font-weight: 600;">${d.count}</span>
              </span>
              session${d.count > 1 ? "s" : ""}
            </div>
          </div>
        `}

        // Pulse Rings layer
        ringsData={ringPoints}
        ringColor={() => (t: number) => `rgba(79, 156, 247, ${Math.max(0, 1 - t)})`}
        ringMaxRadius={(d: any) => Math.min(5, 1.5 + (d.count || 1) * 0.5)}
        ringPropagationSpeed={1.2}
        ringRepeatPeriod={1600}
      />

      {/* Empty State Overlay */}
      {processedPoints.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none bg-background/20 backdrop-blur-[2px] rounded-2xl p-4 text-center">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-ping mb-2" />
          <span className="text-xs font-semibold text-foreground/60 tracking-wide">Waiting for visitor data…</span>
          <span className="text-[10px] text-foreground/30 mt-0.5">Sessions will appear on the globe</span>
        </div>
      )}

      {/* Unresolved Location Chip */}
      {unknownCount > 0 && (
        <div className="absolute bottom-2 left-2 bg-foreground/10 backdrop-blur-md px-2.5 py-1 rounded-full text-[10px] font-medium text-foreground/60 border border-foreground/10 pointer-events-none flex items-center gap-1.5 shadow-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          <span>{unknownCount} visitor{unknownCount > 1 ? "s" : ""} location unresolved</span>
        </div>
      )}
    </div>
  );
}
