"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeftRight,
  Bus,
  Clock,
  Code2,
  Footprints,
  LineChart,
  MapPin,
  Navigation,
  Search,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type { JourneyOption, ResolvedPoint } from "@/lib/journey-planner";
import type { ModelMetrics, TrafficGrid } from "@/lib/data-loader";

const DelhiMap = dynamic(() => import("@/components/DelhiMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[460px] rounded-xl bg-gray-900 border border-gray-800 flex items-center justify-center text-gray-400 text-sm">
      Loading interactive Delhi map...
    </div>
  ),
});

interface StopSuggestion {
  type: "landmark" | "stop";
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface TrafficCell {
  lat: number;
  lng: number;
  speed_kmh: number;
  dwell_ratio: number;
}

interface MetricsPayload {
  metrics: ModelMetrics;
  network: {
    stops: number;
    routes: number;
    landmarks: number;
    fine_cells: number;
    route_hour_priors: number;
  };
  hourly_profile: TrafficGrid["hourly_profile"];
}

const PRESET_QUERIES = [
  { label: "Kashmere Gate → Nehru Place (8:30 AM)", from: "Kashmere Gate ISBT", to: "Nehru Place", depart: "08:30", day: "weekday" as const },
  { label: "Connaught Place → AIIMS (6:00 PM)", from: "Connaught Place / Rajiv Chowk", to: "AIIMS / Safdarjung", depart: "18:00", day: "weekday" as const },
  { label: "Anand Vihar → Dhaula Kuan (9:00 AM)", from: "Anand Vihar ISBT", to: "Dhaula Kuan", depart: "09:00", day: "weekday" as const },
];

export default function HomePage() {
  const [tab, setTab] = useState<"planner" | "model" | "api">("planner");

  const [fromInput, setFromInput] = useState("Kashmere Gate ISBT");
  const [toInput, setToInput] = useState("Nehru Place");
  const [departTime, setDepartTime] = useState("08:30");
  const [dayType, setDayType] = useState<"weekday" | "weekend">("weekday");

  const [fromSuggestions, setFromSuggestions] = useState<StopSuggestion[]>([]);
  const [toSuggestions, setToSuggestions] = useState<StopSuggestion[]>([]);
  const [showFromDrop, setShowFromDrop] = useState(false);
  const [showToDrop, setShowToDrop] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [originPoint, setOriginPoint] = useState<ResolvedPoint | null>(null);
  const [destPoint, setDestPoint] = useState<ResolvedPoint | null>(null);
  const [options, setOptions] = useState<JourneyOption[]>([]);
  const [selectedOptIdx, setSelectedOptIdx] = useState(0);

  const [trafficCells, setTrafficCells] = useState<TrafficCell[]>([]);
  const [showTraffic, setShowTraffic] = useState(true);
  const [pickMode, setPickMode] = useState<"origin" | "dest" | null>(null);

  const [metricsData, setMetricsData] = useState<MetricsPayload | null>(null);
  const [rawApiJson, setRawApiJson] = useState<string>("");

  const currentHour = Math.min(23, Math.max(0, parseInt(departTime.split(":")[0] || "8", 10) || 0));

  const fetchTraffic = useCallback(async (hr: number, wknd: number) => {
    try {
      const res = await fetch(`/api/traffic?hour=${hr}&is_weekend=${wknd}`);
      if (res.ok) {
        const data = await res.json();
        setTrafficCells(data.cells || []);
      }
    } catch {
      // ignore transient error
    }
  }, []);

  const searchJourneys = useCallback(
    async (fromVal = fromInput, toVal = toInput, depVal = departTime, dayVal = dayType) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          from: fromVal,
          to: toVal,
          depart: depVal,
          day: dayVal,
        });
        const res = await fetch(`/api/journeys?${params.toString()}`);
        const data = await res.json();
        setRawApiJson(JSON.stringify(data, null, 2));
        if (!res.ok || data.error) {
          setError(data.error || "Failed to plan journey");
          setOptions([]);
        } else {
          setOriginPoint(data.origin);
          setDestPoint(data.destination);
          setOptions(data.options || []);
          setSelectedOptIdx(0);
          if ((data.options || []).length === 0) {
            setError("No bus routes found between these points within 1 transfer.");
          }
        }
      } catch {
        setError("Network error while contacting journey API.");
      } finally {
        setLoading(false);
      }
    },
    [fromInput, toInput, departTime, dayType]
  );

  useEffect(() => {
    searchJourneys("Kashmere Gate ISBT", "Nehru Place", "08:30", "weekday");
    fetch("/api/model-metrics")
      .then((r) => r.json())
      .then((d) => setMetricsData(d))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchTraffic(currentHour, dayType === "weekend" ? 1 : 0);
  }, [currentHour, dayType, fetchTraffic]);

  const fetchSuggestions = async (q: string, target: "from" | "to") => {
    try {
      const res = await fetch(`/api/stops?q=${encodeURIComponent(q)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (target === "from") setFromSuggestions(data.results || []);
      else setToSuggestions(data.results || []);
    } catch {
      // ignore
    }
  };

  const handleMapPick = (lat: number, lng: number) => {
    const coord = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    if (pickMode === "origin") {
      setFromInput(coord);
      setPickMode(null);
      searchJourneys(coord, toInput, departTime, dayType);
    } else if (pickMode === "dest") {
      setToInput(coord);
      setPickMode(null);
      searchJourneys(fromInput, coord, departTime, dayType);
    }
  };

  const activeOption = options[selectedOptIdx] || null;

  return (
    <div className="min-h-screen flex flex-col bg-[#0b0f19] text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400">
              <Bus className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
                Delhi Bus Traffic &amp; Journey Planner
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  ML-Powered
                </span>
              </h1>
              <p className="text-xs text-gray-400">
                Trained on 57M+ Delhi DTC &amp; Cluster Bus GPS records · Real-time &amp; hourly speed prediction
              </p>
            </div>
          </div>

          <nav className="flex items-center gap-1 bg-gray-900 p-1 rounded-lg border border-gray-800">
            <button
              onClick={() => setTab("planner")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition ${
                tab === "planner" ? "bg-sky-600 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              <Navigation className="w-3.5 h-3.5" /> Journey Planner
            </button>
            <button
              onClick={() => setTab("model")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition ${
                tab === "model" ? "bg-sky-600 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              <LineChart className="w-3.5 h-3.5" /> ML Model &amp; Validation
            </button>
            <button
              onClick={() => setTab("api")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition ${
                tab === "api" ? "bg-sky-600 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              <Code2 className="w-3.5 h-3.5" /> API Explorer
            </button>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-5">
        {tab === "planner" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left Sidebar: Search & Results */}
            <div className="lg:col-span-5 flex flex-col gap-4">
              {/* Search Card */}
              <div className="bg-gray-900/90 border border-gray-800 rounded-xl p-4 space-y-3">
                {/* Origin */}
                <div className="relative">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-gray-400">Origin (Landmark, Stop ID, or lat,lng)</label>
                    <button
                      type="button"
                      onClick={() => setPickMode(pickMode === "origin" ? null : "origin")}
                      className={`text-[11px] px-2 py-0.5 rounded border ${
                        pickMode === "origin"
                          ? "bg-sky-600 border-sky-500 text-white"
                          : "border-gray-700 text-gray-400 hover:text-white"
                      }`}
                    >
                      {pickMode === "origin" ? "Cancel pick" : "Pick on map"}
                    </button>
                  </div>
                  <div className="relative flex items-center">
                    <MapPin className="w-4 h-4 text-emerald-400 absolute left-3" />
                    <input
                      value={fromInput}
                      onFocus={() => {
                        setShowFromDrop(true);
                        fetchSuggestions(fromInput, "from");
                      }}
                      onBlur={() => setTimeout(() => setShowFromDrop(false), 180)}
                      onChange={(e) => {
                        setFromInput(e.target.value);
                        fetchSuggestions(e.target.value, "from");
                      }}
                      placeholder="e.g. Kashmere Gate ISBT or 28.6675,77.2282"
                      className="w-full bg-gray-950 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  {showFromDrop && fromSuggestions.length > 0 && (
                    <div className="absolute z-40 mt-1 w-full bg-gray-950 border border-gray-800 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                      {fromSuggestions.map((s) => (
                        <button
                          key={`${s.type}-${s.id}-${s.name}`}
                          type="button"
                          onMouseDown={() => {
                            setFromInput(s.name);
                            setShowFromDrop(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-gray-800 flex items-center justify-between"
                        >
                          <span className="text-gray-200">{s.name}</span>
                          <span className="text-[10px] uppercase text-gray-500">{s.type}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Swap + Destination */}
                <div className="relative">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-gray-400">Destination</label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const tmp = fromInput;
                          setFromInput(toInput);
                          setToInput(tmp);
                        }}
                        className="text-[11px] px-2 py-0.5 rounded border border-gray-700 text-gray-400 hover:text-white flex items-center gap-1"
                      >
                        <ArrowLeftRight className="w-3 h-3" /> Swap
                      </button>
                      <button
                        type="button"
                        onClick={() => setPickMode(pickMode === "dest" ? null : "dest")}
                        className={`text-[11px] px-2 py-0.5 rounded border ${
                          pickMode === "dest"
                            ? "bg-sky-600 border-sky-500 text-white"
                            : "border-gray-700 text-gray-400 hover:text-white"
                        }`}
                      >
                        {pickMode === "dest" ? "Cancel pick" : "Pick on map"}
                      </button>
                    </div>
                  </div>
                  <div className="relative flex items-center">
                    <MapPin className="w-4 h-4 text-red-400 absolute left-3" />
                    <input
                      value={toInput}
                      onFocus={() => {
                        setShowToDrop(true);
                        fetchSuggestions(toInput, "to");
                      }}
                      onBlur={() => setTimeout(() => setShowToDrop(false), 180)}
                      onChange={(e) => {
                        setToInput(e.target.value);
                        fetchSuggestions(e.target.value, "to");
                      }}
                      placeholder="e.g. Nehru Place or 28.5494,77.2519"
                      className="w-full bg-gray-950 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  {showToDrop && toSuggestions.length > 0 && (
                    <div className="absolute z-40 mt-1 w-full bg-gray-950 border border-gray-800 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                      {toSuggestions.map((s) => (
                        <button
                          key={`${s.type}-${s.id}-${s.name}`}
                          type="button"
                          onMouseDown={() => {
                            setToInput(s.name);
                            setShowToDrop(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-gray-800 flex items-center justify-between"
                        >
                          <span className="text-gray-200">{s.name}</span>
                          <span className="text-[10px] uppercase text-gray-500">{s.type}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Time & Day Controls */}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="text-xs font-medium text-gray-400 block mb-1">Departure Time (IST)</label>
                    <div className="relative flex items-center">
                      <Clock className="w-4 h-4 text-sky-400 absolute left-3" />
                      <input
                        type="time"
                        value={departTime}
                        onChange={(e) => setDepartTime(e.target.value)}
                        className="w-full bg-gray-950 border border-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-400 block mb-1">Day Profile</label>
                    <div className="grid grid-cols-2 gap-1 bg-gray-950 p-1 rounded-lg border border-gray-800">
                      <button
                        type="button"
                        onClick={() => setDayType("weekday")}
                        className={`py-1.5 text-xs rounded-md font-medium transition ${
                          dayType === "weekday" ? "bg-sky-600 text-white" : "text-gray-400 hover:text-white"
                        }`}
                      >
                        Weekday
                      </button>
                      <button
                        type="button"
                        onClick={() => setDayType("weekend")}
                        className={`py-1.5 text-xs rounded-md font-medium transition ${
                          dayType === "weekend" ? "bg-sky-600 text-white" : "text-gray-400 hover:text-white"
                        }`}
                      >
                        Weekend
                      </button>
                    </div>
                  </div>
                </div>

                {/* Quick Time Pills */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-gray-500 mr-1">Quick time:</span>
                  {[
                    { label: "08:30 Peak", t: "08:30" },
                    { label: "13:00 Midday", t: "13:00" },
                    { label: "18:30 Rush", t: "18:30" },
                    { label: "23:00 Quiet", t: "23:00" },
                  ].map((p) => (
                    <button
                      key={p.t}
                      type="button"
                      onClick={() => {
                        setDepartTime(p.t);
                        searchJourneys(fromInput, toInput, p.t, dayType);
                      }}
                      className={`px-2 py-0.5 rounded border ${
                        departTime === p.t
                          ? "border-sky-500 bg-sky-500/20 text-sky-300"
                          : "border-gray-800 text-gray-400 hover:text-white"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => searchJourneys()}
                  disabled={loading}
                  className="w-full bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm flex items-center justify-center gap-2 transition"
                >
                  <Search className="w-4 h-4" />
                  {loading ? "Predicting travel times..." : "Find Bus Journeys"}
                </button>

                {/* Example Presets */}
                <div className="pt-1 border-t border-gray-800/80">
                  <div className="text-[11px] text-gray-500 mb-1.5">Try benchmark corridors:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_QUERIES.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => {
                          setFromInput(p.from);
                          setToInput(p.to);
                          setDepartTime(p.depart);
                          setDayType(p.day);
                          searchJourneys(p.from, p.to, p.depart, p.day);
                        }}
                        className="text-[11px] px-2 py-1 rounded bg-gray-950 border border-gray-800 text-gray-300 hover:border-sky-500/50 hover:text-white transition"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="bg-red-950/40 border border-red-800/60 text-red-200 text-xs rounded-xl p-3">
                  {error}
                </div>
              )}

              {/* Journey Options */}
              <div className="space-y-3">
                {options.map((opt, idx) => {
                  const isSelected = idx === selectedOptIdx;
                  return (
                    <div
                      key={opt.option_id}
                      onClick={() => setSelectedOptIdx(idx)}
                      className={`cursor-pointer rounded-xl border p-4 transition ${
                        isSelected
                          ? "bg-gray-900 border-sky-500 shadow-lg shadow-sky-950/20"
                          : "bg-gray-900/60 border-gray-800 hover:border-gray-700"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold px-2 py-0.5 rounded bg-sky-500/20 text-sky-300">
                              Option {opt.option_id}
                            </span>
                            <span className="text-sm font-semibold text-white">{opt.summary}</span>
                          </div>
                          <div className="text-xs text-gray-400 mt-1">
                            Depart {opt.depart_time} → Arrive{" "}
                            <span className="text-gray-200 font-medium">{opt.estimated_arrival}</span> ·{" "}
                            {opt.transfers === 0 ? "Direct" : `${opt.transfers} Transfer`}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xl font-bold text-white">{Math.round(opt.total_duration_min)} min</div>
                          <div className="text-[11px] text-gray-400">
                            Quiet hr: {Math.round(opt.quiet_hour_total_min)} min
                          </div>
                        </div>
                      </div>

                      {/* Traffic Impact Banner */}
                      <div className="mt-2.5 flex items-center justify-between text-xs bg-gray-950/80 border border-gray-800/80 rounded-lg px-2.5 py-1.5">
                        <span className="text-gray-400 flex items-center gap-1.5">
                          <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
                          Traffic impact vs 11:00 PM:
                        </span>
                        <span
                          className={`font-semibold ${
                            opt.traffic_delay_min > 3
                              ? "text-amber-400"
                              : opt.traffic_delay_min < -1
                              ? "text-emerald-400"
                              : "text-gray-300"
                          }`}
                        >
                          {opt.traffic_delay_min > 0 ? `+${opt.traffic_delay_min}` : opt.traffic_delay_min} min (
                          {opt.traffic_impact_pct > 0 ? `+${opt.traffic_impact_pct}%` : `${opt.traffic_impact_pct}%`})
                        </span>
                      </div>

                      {/* Detailed Steps */}
                      {isSelected && (
                        <div className="mt-3 pt-3 border-t border-gray-800 space-y-2.5 text-xs">
                          <div className="flex items-center gap-2 text-gray-300">
                            <Footprints className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <span>
                              Walk <b>{opt.walk_to_first_stop.distance_m} m</b> ({opt.walk_to_first_stop.duration_min} min) to{" "}
                              <span className="text-white">{opt.walk_to_first_stop.to_label}</span>
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-gray-400 pl-5">
                            Estimated headway wait: ~{opt.wait_time_min} min
                          </div>

                          {opt.legs.map((leg, lIdx) =>
                            leg.type === "bus" ? (
                              <div
                                key={lIdx}
                                className="bg-gray-950 border border-gray-800 rounded-lg p-2.5 space-y-1"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold text-sky-300 flex items-center gap-1.5">
                                    <Bus className="w-3.5 h-3.5" /> Route {leg.route_id}
                                  </span>
                                  <span className="text-white font-semibold">{leg.duration_min} min</span>
                                </div>
                                <div className="text-gray-300">
                                  Board: <span className="text-white">{leg.board_stop.name}</span> ({leg.board_stop.id})
                                </div>
                                <div className="text-gray-300">
                                  Alight: <span className="text-white">{leg.alight_stop.name}</span> ({leg.alight_stop.id})
                                </div>
                                <div className="text-[11px] text-gray-400 flex flex-wrap gap-3 pt-0.5">
                                  <span>{leg.num_stops} stops</span>
                                  <span>{leg.distance_km} km</span>
                                  <span>ML speed: {leg.predicted_speed_kmh} km/h</span>
                                  <span>Dwell/signal: {leg.dwell_pct}%</span>
                                </div>
                              </div>
                            ) : (
                              <div key={lIdx} className="flex items-center gap-2 text-amber-300">
                                <Footprints className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  Transfer walk ({leg.distance_m} m, {leg.duration_min} min) at {leg.from_label}
                                </span>
                              </div>
                            )
                          )}

                          <div className="flex items-center gap-2 text-gray-300">
                            <Footprints className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <span>
                              Walk <b>{opt.walk_to_destination.distance_m} m</b> ({opt.walk_to_destination.duration_min} min) to{" "}
                              <span className="text-white">{opt.walk_to_destination.to_label}</span>
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Panel: Interactive Map */}
            <div className="lg:col-span-7 flex flex-col gap-3">
              <div className="flex items-center justify-between bg-gray-900/90 border border-gray-800 rounded-xl px-4 py-2.5 text-xs">
                <div className="flex items-center gap-2 text-gray-300">
                  <Sparkles className="w-4 h-4 text-sky-400" />
                  <span>
                    Showing{" "}
                    <b className="text-white">
                      {String(currentHour).padStart(2, "0")}:00 ({dayType})
                    </b>{" "}
                    GPS traffic grid ({trafficCells.length} active 1.1 km cells)
                  </span>
                </div>
                <label className="flex items-center gap-2 cursor-pointer text-gray-300">
                  <input
                    type="checkbox"
                    checked={showTraffic}
                    onChange={(e) => setShowTraffic(e.target.checked)}
                    className="accent-sky-500"
                  />
                  Traffic Overlay
                </label>
              </div>
              <div className="flex-1 min-h-[560px]">
                <DelhiMap
                  origin={originPoint}
                  destination={destPoint}
                  activeOption={activeOption}
                  trafficCells={trafficCells}
                  showTraffic={showTraffic}
                  pickMode={pickMode}
                  onMapPick={handleMapPick}
                />
              </div>
            </div>
          </div>
        )}

        {tab === "model" && metricsData && (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="text-xs text-gray-400">ML Model MAE (Held-Out Trips)</div>
                <div className="text-2xl font-bold text-emerald-400 mt-1">
                  {metricsData.metrics.ml_model.mae_min} min
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  vs {metricsData.metrics.baseline_timetable.mae_min} min static timetable
                </div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="text-xs text-gray-400">Duration R² Score</div>
                <div className="text-2xl font-bold text-sky-400 mt-1">
                  {metricsData.metrics.ml_model.r2_duration}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  RMSE: {metricsData.metrics.ml_model.rmse_min} min · MAPE: {metricsData.metrics.ml_model.mape_pct}%
                </div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="text-xs text-gray-400">Observed Trip Segments</div>
                <div className="text-2xl font-bold text-white mt-1">
                  {(metricsData.metrics.train_segments + metricsData.metrics.test_segments).toLocaleString()}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  80/20 trip-grouped split ({metricsData.metrics.test_trips} held-out trips)
                </div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="text-xs text-gray-400">Inferred Transit Network</div>
                <div className="text-2xl font-bold text-white mt-1">
                  {metricsData.network.routes} Routes
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {metricsData.network.stops.toLocaleString()} stops · {metricsData.network.fine_cells.toLocaleString()} grid priors
                </div>
              </div>
            </div>

            {/* Model Comparison Table & Feature Importance */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-white mb-3">
                  Benchmark Against Baselines (Held-Out Observed Trips)
                </h2>
                <table className="w-full text-xs text-left">
                  <thead className="text-gray-400 border-b border-gray-800">
                    <tr>
                      <th className="py-2">Model</th>
                      <th className="py-2">MAE (min)</th>
                      <th className="py-2">RMSE (min)</th>
                      <th className="py-2">MAPE</th>
                      <th className="py-2">R²</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/70">
                    <tr className="text-emerald-300 font-medium">
                      <td className="py-2.5">{metricsData.metrics.ml_model.name}</td>
                      <td>{metricsData.metrics.ml_model.mae_min}</td>
                      <td>{metricsData.metrics.ml_model.rmse_min}</td>
                      <td>{metricsData.metrics.ml_model.mape_pct}%</td>
                      <td>{metricsData.metrics.ml_model.r2_duration}</td>
                    </tr>
                    <tr className="text-gray-300">
                      <td className="py-2.5">{metricsData.metrics.baseline_city_hour.name}</td>
                      <td>{metricsData.metrics.baseline_city_hour.mae_min}</td>
                      <td>{metricsData.metrics.baseline_city_hour.rmse_min}</td>
                      <td>{metricsData.metrics.baseline_city_hour.mape_pct}%</td>
                      <td>{metricsData.metrics.baseline_city_hour.r2_duration}</td>
                    </tr>
                    <tr className="text-gray-400">
                      <td className="py-2.5">{metricsData.metrics.baseline_timetable.name}</td>
                      <td>{metricsData.metrics.baseline_timetable.mae_min}</td>
                      <td>{metricsData.metrics.baseline_timetable.rmse_min}</td>
                      <td>{metricsData.metrics.baseline_timetable.mape_pct}%</td>
                      <td>{metricsData.metrics.baseline_timetable.r2_duration}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h2 className="text-sm font-semibold text-white mb-3">Top ML Feature Importances</h2>
                <div className="space-y-2">
                  {metricsData.metrics.feature_names
                    .map((name, i) => ({ name, imp: metricsData.metrics.feature_importances[i] }))
                    .sort((a, b) => b.imp - a.imp)
                    .slice(0, 8)
                    .map((f) => (
                      <div key={f.name} className="text-xs">
                        <div className="flex justify-between text-gray-300 mb-0.5">
                          <span>{f.name}</span>
                          <span>{(f.imp * 100).toFixed(1)}%</span>
                        </div>
                        <div className="w-full bg-gray-950 h-2 rounded-full overflow-hidden">
                          <div
                            className="bg-sky-500 h-full rounded-full"
                            style={{ width: `${Math.min(100, f.imp * 220)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            {/* 24-Hour Speed Profile */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-white mb-3">
                Delhi Bus Speed &amp; Dwell Profile by Hour (Oct 30 Weekday vs Oct 31 Weekend)
              </h2>
              <div className="overflow-x-auto">
                <div className="grid grid-cols-24 gap-1 min-w-[640px] items-end h-44 pt-4">
                  {metricsData.hourly_profile.map((h) => (
                    <div key={h.hour} className="flex flex-col items-center gap-1 h-full justify-end group relative">
                      <div className="w-full flex gap-0.5 items-end justify-center h-32">
                        <div
                          className="w-2 bg-sky-500 rounded-t"
                          style={{ height: `${Math.min(100, (h.weekday.avg_speed_kmh / 40) * 100)}%` }}
                          title={`Hr ${h.hour} Weekday: ${h.weekday.avg_speed_kmh} km/h`}
                        />
                        <div
                          className="w-2 bg-emerald-500 rounded-t"
                          style={{ height: `${Math.min(100, (h.weekend.avg_speed_kmh / 40) * 100)}%` }}
                          title={`Hr ${h.hour} Weekend: ${h.weekend.avg_speed_kmh} km/h`}
                        />
                      </div>
                      <span className="text-[10px] text-gray-500">{h.hour}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-400 mt-3">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-2 bg-sky-500 inline-block rounded" /> Weekday (Oct 30)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-2 bg-emerald-500 inline-block rounded" /> Weekend (Oct 31)
                </span>
              </div>
            </div>
          </div>
        )}

        {tab === "api" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4 text-xs">
              <h2 className="text-base font-semibold text-white">REST API Endpoints</h2>
              <div className="space-y-3">
                <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
                  <div className="font-mono text-sky-400 font-semibold">
                    GET /api/journeys?from=...&amp;to=...&amp;depart=...&amp;day=...
                  </div>
                  <p className="text-gray-400 mt-1">
                    Returns ranked bus journey options (direct &amp; 1-transfer) with walking legs, ML-predicted segment
                    speeds, dwell ratios, ETA, and 11:00 PM quiet-hour counterfactual.
                  </p>
                </div>
                <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
                  <div className="font-mono text-sky-400 font-semibold">GET /api/stops?q=...</div>
                  <p className="text-gray-400 mt-1">Autocomplete search across Delhi landmarks and inferred bus stops.</p>
                </div>
                <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
                  <div className="font-mono text-sky-400 font-semibold">
                    GET /api/traffic?hour=8&amp;is_weekend=0
                  </div>
                  <p className="text-gray-400 mt-1">
                    Returns 1.1 km spatial-temporal road grid speeds and 24-hour city profile.
                  </p>
                </div>
                <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
                  <div className="font-mono text-sky-400 font-semibold">GET /api/model-metrics</div>
                  <p className="text-gray-400 mt-1">
                    Returns RandomForest validation metrics (MAE, RMSE, MAPE, R²) and feature importances.
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex flex-col">
              <h2 className="text-sm font-semibold text-white mb-2">Live /api/journeys JSON Response</h2>
              <pre className="flex-1 bg-gray-950 border border-gray-800 rounded-lg p-3 text-[11px] text-emerald-300 overflow-auto max-h-[500px]">
                {rawApiJson || "Run a journey search to inspect the live JSON response."}
              </pre>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
