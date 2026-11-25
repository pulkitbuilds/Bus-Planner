import { Stop, getStopRouteIndex, getTransitGraph } from "./data-loader";
import { haversineMeters, predictLegTravelTime } from "./ml-predictor";

export interface ResolvedPoint {
  query: string;
  label: string;
  lat: number;
  lng: number;
  matchedBy: "coordinates" | "stop_id" | "landmark" | "stop_name";
}

export interface BusLeg {
  type: "bus";
  route_id: string;
  board_stop: { id: string; name: string; lat: number; lng: number };
  alight_stop: { id: string; name: string; lat: number; lng: number };
  num_stops: number;
  distance_km: number;
  duration_min: number;
  quiet_hour_duration_min: number;
  predicted_speed_kmh: number;
  quiet_hour_speed_kmh: number;
  dwell_pct: number;
  polyline: [number, number][];
}

export interface WalkLeg {
  type: "walk";
  from_label: string;
  to_label: string;
  distance_m: number;
  duration_min: number;
}

export interface JourneyOption {
  option_id: number;
  summary: string;
  transfers: number;
  total_duration_min: number;
  quiet_hour_total_min: number;
  traffic_delay_min: number;
  traffic_impact_pct: number;
  depart_time: string;
  estimated_arrival: string;
  walk_to_first_stop: WalkLeg;
  legs: Array<BusLeg | WalkLeg>;
  walk_to_destination: WalkLeg;
  wait_time_min: number;
}

export function resolveLocation(input: string): ResolvedPoint | null {
  const trimmed = input.trim();
  const graph = getTransitGraph();

  // 1. Check "lat,lng" coordinates
  const coordMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lng = parseFloat(coordMatch[2]);
    if (lat >= 28.0 && lat <= 29.2 && lng >= 76.5 && lng <= 77.8) {
      return {
        query: trimmed,
        label: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        lat,
        lng,
        matchedBy: "coordinates",
      };
    }
  }

  // 2. Check exact Stop ID (e.g., S0123)
  const upper = trimmed.toUpperCase();
  if (graph.stops[upper]) {
    const s = graph.stops[upper];
    return { query: trimmed, label: s.name, lat: s.lat, lng: s.lng, matchedBy: "stop_id" };
  }

  const qLower = trimmed.toLowerCase();

  // 3. Check landmarks (exact or substring)
  const exactLm = graph.landmarks.find((l) => l.name.toLowerCase() === qLower);
  if (exactLm) {
    return { query: trimmed, label: exactLm.name, lat: exactLm.lat, lng: exactLm.lng, matchedBy: "landmark" };
  }
  const partialLm = graph.landmarks.find((l) => l.name.toLowerCase().includes(qLower));
  if (partialLm) {
    return { query: trimmed, label: partialLm.name, lat: partialLm.lat, lng: partialLm.lng, matchedBy: "landmark" };
  }

  // 4. Check stop names
  const stopMatch = Object.values(graph.stops).find((s) => s.name.toLowerCase().includes(qLower));
  if (stopMatch) {
    return { query: trimmed, label: stopMatch.name, lat: stopMatch.lat, lng: stopMatch.lng, matchedBy: "stop_name" };
  }

  return null;
}

export function parseDepartureTime(departStr?: string): {
  hour: number;
  minute: number;
  isWeekend: number;
  formattedTime: string;
  dayType: "weekday" | "weekend";
} {
  if (!departStr) {
    return { hour: 8, minute: 30, isWeekend: 0, formattedTime: "08:30", dayType: "weekday" };
  }
  const s = departStr.trim();

  // Try ISO or YYYY-MM-DD HH:MM
  const dt = new Date(s.includes("T") || s.includes("-") ? s : `2026-10-30T${s.padStart(5, "0")}:00`);
  if (!isNaN(dt.getTime())) {
    const hr = dt.getHours();
    const min = dt.getMinutes();
    const day = dt.getDay(); // 0=Sun, 6=Sat
    const isWknd = day === 0 || day === 6 ? 1 : 0;
    return {
      hour: hr,
      minute: min,
      isWeekend: isWknd,
      formattedTime: `${String(hr).padStart(2, "0")}:${String(min).padStart(2, "0")}`,
      dayType: isWknd ? "weekend" : "weekday",
    };
  }

  // Fallback HH:MM
  const m = s.match(/(\d{1,2}):(\d{2})/);
  const hr = m ? Math.min(23, Math.max(0, parseInt(m[1], 10))) : 8;
  const min = m ? Math.min(59, Math.max(0, parseInt(m[2], 10))) : 30;
  const isWknd = s.toLowerCase().includes("sat") || s.toLowerCase().includes("sun") || s.toLowerCase().includes("weekend") ? 1 : 0;
  return {
    hour: hr,
    minute: min,
    isWeekend: isWknd,
    formattedTime: `${String(hr).padStart(2, "0")}:${String(min).padStart(2, "0")}`,
    dayType: isWknd ? "weekend" : "weekday",
  };
}

function addMinutesToTime(hour: number, minute: number, addMin: number): string {
  const total = Math.round(hour * 60 + minute + addMin) % (24 * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function findNearestStops(lat: number, lng: number, maxDistM = 1600, limit = 6): Array<{ stop: Stop; distM: number }> {
  const graph = getTransitGraph();
  const all = Object.values(graph.stops).map((stop) => ({
    stop,
    distM: haversineMeters(lat, lng, stop.lat, stop.lng),
  }));
  all.sort((a, b) => a.distM - b.distM);
  const within = all.filter((x) => x.distM <= maxDistM);
  return (within.length >= 2 ? within : all).slice(0, limit);
}

function estimateWaitMin(hour: number, transfers: number): number {
  // Peak hours have more frequent buses (~4 min wait), night ~9 min
  const base = hour >= 7 && hour <= 21 ? 4.5 : 8.5;
  return Math.round((base + transfers * 4.5) * 10) / 10;
}

export function planJourneys(
  fromQuery: string,
  toQuery: string,
  departStr?: string,
  dayOverride?: "weekday" | "weekend"
): {
  origin: ResolvedPoint;
  destination: ResolvedPoint;
  departure: ReturnType<typeof parseDepartureTime>;
  options: JourneyOption[];
} | { error: string } {
  const origin = resolveLocation(fromQuery);
  if (!origin) return { error: `Could not resolve origin: "${fromQuery}". Try a Delhi landmark, Stop ID, or "lat,lng".` };

  const destination = resolveLocation(toQuery);
  if (!destination) return { error: `Could not resolve destination: "${toQuery}". Try a Delhi landmark, Stop ID, or "lat,lng".` };

  const dep = parseDepartureTime(departStr);
  if (dayOverride) {
    dep.isWeekend = dayOverride === "weekend" ? 1 : 0;
    dep.dayType = dayOverride;
  }

  const graph = getTransitGraph();
  const stopRoutes = getStopRouteIndex();

  const originStops = findNearestStops(origin.lat, origin.lng, 1600, 6);
  const destStops = findNearestStops(destination.lat, destination.lng, 1600, 6);
  const destStopSet = new Map(destStops.map((d) => [d.stop.id, d]));

  interface Candidate {
    routeComboKey: string;
    transfers: number;
    oStop: Stop;
    oWalkM: number;
    dStop: Stop;
    dWalkM: number;
    leg1: { routeIdx: number; startPos: number; endPos: number };
    transferWalkM?: number;
    leg2?: { routeIdx: number; startPos: number; endPos: number };
    approxKm: number;
  }

  const candidates: Candidate[] = [];
  const seenCombos = new Set<string>();

  // 1. Direct (0-transfer) routes
  for (const { stop: oStop, distM: oWalkM } of originStops) {
    const refs = stopRoutes[oStop.id] || [];
    for (const { routeIdx, posIdx } of refs) {
      const route = graph.routes[routeIdx];
      for (let p2 = posIdx + 1; p2 < route.stops.length; p2++) {
        const sid2 = route.stops[p2];
        const dMatch = destStopSet.get(sid2);
        if (dMatch) {
          const key = `0|${route.route_id}`;
          if (seenCombos.has(key)) continue;
          seenCombos.add(key);
          let km = 0;
          for (let k = posIdx; k < p2; k++) km += route.seg_km[k];
          candidates.push({
            routeComboKey: key,
            transfers: 0,
            oStop,
            oWalkM,
            dStop: dMatch.stop,
            dWalkM: dMatch.distM,
            leg1: { routeIdx, startPos: posIdx, endPos: p2 },
            approxKm: km,
          });
          break;
        }
      }
    }
  }

  // 2. 1-transfer routes (search if we have < 4 direct options or to offer faster transfer alternatives)
  if (candidates.length < 5) {
    const destRoutesMap = new Map<string, { routeIdx: number; posIdx: number; dStop: Stop; dWalkM: number }[]>();
    for (const { stop: dStop, distM: dWalkM } of destStops) {
      for (const { routeIdx, posIdx } of stopRoutes[dStop.id] || []) {
        const route = graph.routes[routeIdx];
        // Every stop BEFORE posIdx on this route can reach dStop
        for (let p = 0; p < posIdx; p++) {
          const midSid = route.stops[p];
          if (!destRoutesMap.has(midSid)) destRoutesMap.set(midSid, []);
          destRoutesMap.get(midSid)!.push({ routeIdx, posIdx: p, dStop, dWalkM });
        }
      }
    }

    for (const { stop: oStop, distM: oWalkM } of originStops.slice(0, 4)) {
      for (const { routeIdx: r1Idx, posIdx: p1 } of stopRoutes[oStop.id] || []) {
        const r1 = graph.routes[r1Idx];
        for (let m = p1 + 1; m < r1.stops.length; m++) {
          const midSid = r1.stops[m];
          const reachList = destRoutesMap.get(midSid);
          if (!reachList) continue;
          for (const r2Info of reachList.slice(0, 3)) {
            if (r2Info.routeIdx === r1Idx) continue;
            const r2 = graph.routes[r2Info.routeIdx];
            const key = `1|${r1.route_id}->${r2.route_id}`;
            if (seenCombos.has(key)) continue;
            seenCombos.add(key);

            // Find destination pos on r2
            const dPos = r2.stops.indexOf(r2Info.dStop.id, r2Info.posIdx + 1);
            if (dPos === -1) continue;

            let km = 0;
            for (let k = p1; k < m; k++) km += r1.seg_km[k];
            for (let k = r2Info.posIdx; k < dPos; k++) km += r2.seg_km[k];

            candidates.push({
              routeComboKey: key,
              transfers: 1,
              oStop,
              oWalkM,
              dStop: r2Info.dStop,
              dWalkM: r2Info.dWalkM,
              leg1: { routeIdx: r1Idx, startPos: p1, endPos: m },
              transferWalkM: 0,
              leg2: { routeIdx: r2Info.routeIdx, startPos: r2Info.posIdx, endPos: dPos },
              approxKm: km,
            });
            if (candidates.length >= 18) break;
          }
          if (candidates.length >= 18) break;
        }
        if (candidates.length >= 18) break;
      }
      if (candidates.length >= 18) break;
    }
  }

  // Score candidates with ML model
  const evaluated: JourneyOption[] = candidates
    .sort((a, b) => a.transfers - b.transfers || a.approxKm - b.approxKm)
    .slice(0, 10)
    .map((cand, idx) => {
      const WALK_M_PER_MIN = 80; // 4.8 km/h
      const walk1Min = Math.round((cand.oWalkM / WALK_M_PER_MIN) * 10) / 10;
      const walk2Min = Math.round((cand.dWalkM / WALK_M_PER_MIN) * 10) / 10;
      const waitMin = estimateWaitMin(dep.hour, cand.transfers);

      const buildBusLeg = (leg: { routeIdx: number; startPos: number; endPos: number }): BusLeg => {
        const route = graph.routes[leg.routeIdx];
        const legStopIds = route.stops.slice(leg.startPos, leg.endPos + 1);
        const legStops = legStopIds.map((sid) => graph.stops[sid]);
        const legSegKm = route.seg_km.slice(leg.startPos, leg.endPos);

        const mlNow = predictLegTravelTime(legStops, legSegKm, dep.hour, dep.isWeekend, route.route_id);
        const mlQuiet = predictLegTravelTime(legStops, legSegKm, 23, dep.isWeekend, route.route_id);

        return {
          type: "bus",
          route_id: route.route_id,
          board_stop: {
            id: legStops[0].id,
            name: legStops[0].name,
            lat: legStops[0].lat,
            lng: legStops[0].lng,
          },
          alight_stop: {
            id: legStops[legStops.length - 1].id,
            name: legStops[legStops.length - 1].name,
            lat: legStops[legStops.length - 1].lat,
            lng: legStops[legStops.length - 1].lng,
          },
          num_stops: legStops.length - 1,
          distance_km: mlNow.distanceKm,
          duration_min: mlNow.durationMin,
          quiet_hour_duration_min: mlQuiet.durationMin,
          predicted_speed_kmh: mlNow.avgSpeedKmh,
          quiet_hour_speed_kmh: mlQuiet.avgSpeedKmh,
          dwell_pct: Math.round(mlNow.dwellRatio * 100),
          polyline: legStops.map((s) => [s.lat, s.lng]),
        };
      };

      const busLeg1 = buildBusLeg(cand.leg1);
      const legs: Array<BusLeg | WalkLeg> = [busLeg1];
      let busNowMin = busLeg1.duration_min;
      let busQuietMin = busLeg1.quiet_hour_duration_min;

      if (cand.leg2) {
        const busLeg2 = buildBusLeg(cand.leg2);
        legs.push({
          type: "walk",
          from_label: busLeg1.alight_stop.name,
          to_label: busLeg2.board_stop.name,
          distance_m: 45,
          duration_min: 1.0,
        });
        legs.push(busLeg2);
        busNowMin += 1.0 + busLeg2.duration_min;
        busQuietMin += 1.0 + busLeg2.quiet_hour_duration_min;
      }

      const totalMin = Math.round((walk1Min + waitMin + busNowMin + walk2Min) * 10) / 10;
      const quietTotalMin = Math.round((walk1Min + waitMin + busQuietMin + walk2Min) * 10) / 10;
      const delayMin = Math.round((totalMin - quietTotalMin) * 10) / 10;
      const impactPct = quietTotalMin > 0 ? Math.round((delayMin / quietTotalMin) * 100) : 0;

      const routeNames = legs
        .filter((l): l is BusLeg => l.type === "bus")
        .map((l) => `Route ${l.route_id}`)
        .join(" → ");

      return {
        option_id: idx + 1,
        summary: cand.transfers === 0 ? `Direct via ${routeNames}` : `1 Transfer via ${routeNames}`,
        transfers: cand.transfers,
        total_duration_min: totalMin,
        quiet_hour_total_min: quietTotalMin,
        traffic_delay_min: delayMin,
        traffic_impact_pct: impactPct,
        depart_time: dep.formattedTime,
        estimated_arrival: addMinutesToTime(dep.hour, dep.minute, totalMin),
        walk_to_first_stop: {
          type: "walk",
          from_label: origin.label,
          to_label: busLeg1.board_stop.name,
          distance_m: Math.round(cand.oWalkM),
          duration_min: walk1Min,
        },
        legs,
        walk_to_destination: {
          type: "walk",
          from_label: (legs[legs.length - 1] as BusLeg).alight_stop.name,
          to_label: destination.label,
          distance_m: Math.round(cand.dWalkM),
          duration_min: walk2Min,
        },
        wait_time_min: waitMin,
      };
    });

  evaluated.sort((a, b) => a.total_duration_min - b.total_duration_min);
  const topOptions = evaluated.slice(0, 4).map((opt, i) => ({ ...opt, option_id: i + 1 }));

  return {
    origin,
    destination,
    departure: dep,
    options: topOptions,
  };
}
