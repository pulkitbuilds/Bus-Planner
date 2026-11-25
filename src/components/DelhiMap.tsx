"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import type { JourneyOption, ResolvedPoint } from "@/lib/journey-planner";

interface TrafficCell {
  lat: number;
  lng: number;
  speed_kmh: number;
  dwell_ratio: number;
}

interface DelhiMapProps {
  origin?: ResolvedPoint | null;
  destination?: ResolvedPoint | null;
  activeOption?: JourneyOption | null;
  trafficCells: TrafficCell[];
  showTraffic: boolean;
  pickMode: "origin" | "dest" | null;
  onMapPick: (lat: number, lng: number) => void;
}

export default function DelhiMap({
  origin,
  destination,
  activeOption,
  trafficCells,
  showTraffic,
  pickMode,
  onMapPick,
}: DelhiMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const trafficLayerRef = useRef<L.LayerGroup | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const pickModeRef = useRef(pickMode);
  const onMapPickRef = useRef(onMapPick);

  pickModeRef.current = pickMode;
  onMapPickRef.current = onMapPick;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [28.6139, 77.209],
      zoom: 12,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; CARTO',
      maxZoom: 18,
    }).addTo(map);

    trafficLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);

    map.on("click", (e: L.LeafletMouseEvent) => {
      if (pickModeRef.current) {
        onMapPickRef.current(e.latlng.lat, e.latlng.lng);
      }
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update cursor when pickMode changes
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.style.cursor = pickMode ? "crosshair" : "";
  }, [pickMode]);

  // Update traffic grid overlay
  useEffect(() => {
    const layer = trafficLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!showTraffic) return;

    for (const c of trafficCells) {
      const color =
        c.speed_kmh < 14 ? "#ef4444" : c.speed_kmh < 22 ? "#f59e0b" : "#10b981";
      L.circleMarker([c.lat, c.lng], {
        radius: 5,
        color,
        fillColor: color,
        fillOpacity: 0.28,
        weight: 0.5,
        opacity: 0.45,
      })
        .bindTooltip(
          `Speed: <b>${c.speed_kmh.toFixed(1)} km/h</b><br/>Dwell/Signal: ${Math.round(c.dwell_ratio * 100)}%`,
          { direction: "top" }
        )
        .addTo(layer);
    }
  }, [trafficCells, showTraffic]);

  // Update active journey route & markers
  useEffect(() => {
    const map = mapRef.current;
    const layer = routeLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const boundsPts: [number, number][] = [];

    if (origin) {
      boundsPts.push([origin.lat, origin.lng]);
      L.circleMarker([origin.lat, origin.lng], {
        radius: 8,
        color: "#ffffff",
        fillColor: "#22c55e",
        fillOpacity: 1,
        weight: 2,
      })
        .bindPopup(`<b>Origin:</b> ${origin.label}`)
        .addTo(layer);
    }

    if (destination) {
      boundsPts.push([destination.lat, destination.lng]);
      L.circleMarker([destination.lat, destination.lng], {
        radius: 8,
        color: "#ffffff",
        fillColor: "#ef4444",
        fillOpacity: 1,
        weight: 2,
      })
        .bindPopup(`<b>Destination:</b> ${destination.label}`)
        .addTo(layer);
    }

    if (activeOption) {
      const busColors = ["#38bdf8", "#a78bfa", "#fbbf24"];
      let busIdx = 0;

      const busLegs = activeOption.legs.filter((l) => l.type === "bus");
      if (origin && busLegs.length > 0) {
        const first = busLegs[0];
        if (first.type === "bus") {
          L.polyline(
            [
              [origin.lat, origin.lng],
              [first.board_stop.lat, first.board_stop.lng],
            ],
            { color: "#9ca3af", dashArray: "6 6", weight: 3 }
          ).addTo(layer);
        }
      }

      for (const leg of activeOption.legs) {
        if (leg.type === "bus") {
          const color = busColors[busIdx % busColors.length];
          busIdx++;
          L.polyline(leg.polyline, {
            color,
            weight: 5,
            opacity: 0.9,
          })
            .bindPopup(
              `<b>Route ${leg.route_id}</b><br/>${leg.board_stop.name} → ${leg.alight_stop.name}<br/>${leg.distance_km} km · ${leg.duration_min} min (${leg.predicted_speed_kmh} km/h)`
            )
            .addTo(layer);

          for (const pt of leg.polyline) boundsPts.push(pt);

          L.circleMarker([leg.board_stop.lat, leg.board_stop.lng], {
            radius: 6,
            color: "#0b0f19",
            fillColor: color,
            fillOpacity: 1,
            weight: 2,
          })
            .bindPopup(`<b>Board Route ${leg.route_id}</b><br/>${leg.board_stop.name}`)
            .addTo(layer);

          L.circleMarker([leg.alight_stop.lat, leg.alight_stop.lng], {
            radius: 6,
            color: "#0b0f19",
            fillColor: color,
            fillOpacity: 1,
            weight: 2,
          })
            .bindPopup(`<b>Alight Route ${leg.route_id}</b><br/>${leg.alight_stop.name}`)
            .addTo(layer);
        }
      }

      if (destination && busLegs.length > 0) {
        const last = busLegs[busLegs.length - 1];
        if (last.type === "bus") {
          L.polyline(
            [
              [last.alight_stop.lat, last.alight_stop.lng],
              [destination.lat, destination.lng],
            ],
            { color: "#9ca3af", dashArray: "6 6", weight: 3 }
          ).addTo(layer);
        }
      }
    }

    if (boundsPts.length >= 2) {
      map.fitBounds(boundsPts, { padding: [50, 50], maxZoom: 14 });
    }
  }, [origin, destination, activeOption]);

  return (
    <div className="relative w-full h-full min-h-[460px] rounded-xl overflow-hidden border border-gray-800">
      <div ref={containerRef} className="w-full h-full min-h-[460px]" />
      {pickMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] bg-sky-600 text-white text-xs font-medium px-3 py-1.5 rounded-full shadow-lg">
          Click anywhere on the Delhi map to set {pickMode === "origin" ? "Origin" : "Destination"}
        </div>
      )}
      {showTraffic && (
        <div className="absolute bottom-3 left-3 z-[1000] bg-gray-900/90 backdrop-blur border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 flex items-center gap-3">
          <span className="font-semibold text-gray-300">GPS Speed:</span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> &lt;14 km/h
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> 14–22
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> &gt;22 km/h
          </span>
        </div>
      )}
    </div>
  );
}
