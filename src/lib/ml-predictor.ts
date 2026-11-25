import { DecisionTree, Stop, TrafficGrid, getMLModel, getTrafficGrid } from "./data-loader";

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lng2 - lng1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, a)));
}

function cellKey(lat: number, lng: number, bounds: TrafficGrid["bounds"], size: number): string {
  const row = Math.floor((lat - bounds.lat_min) / size);
  const col = Math.floor((lng - bounds.lng_min) / size);
  return `${row}_${col}`;
}

export function lookupGridPrior(
  grid: TrafficGrid,
  lat: number,
  lng: number,
  hour: number,
  isWeekend: number,
  routeId?: string
): { speedKmh: number; dwellRatio: number; routeSpeedKmh: number } {
  const ck = cellKey(lat, lng, grid.bounds, grid.cell_size);
  const cck = cellKey(lat, lng, grid.bounds, grid.coarse_size);

  let val = grid.fine[`${ck}|${hour}|${isWeekend}`];
  if (!val) val = grid.fine[`${ck}|${hour}`];
  if (!val) val = grid.coarse[`${cck}|${hour}`];
  if (!val) {
    const city = grid.city[`${hour}|${isWeekend}`] ?? { speed_kmh: 18.0, dwell_ratio: 0.15 };
    val = [city.speed_kmh, city.dwell_ratio];
  }

  let routeSpeed = val[0];
  if (routeId) {
    const rs = grid.route_hour[`${routeId}|${hour}`];
    if (rs !== undefined) routeSpeed = rs;
  }

  return { speedKmh: val[0], dwellRatio: val[1], routeSpeedKmh: routeSpeed };
}

function evalTree(tree: DecisionTree, features: number[]): number {
  let node = 0;
  while (tree.c_left[node] !== -1) {
    const f = tree.feat[node];
    if (features[f] <= tree.thresh[node]) {
      node = tree.c_left[node];
    } else {
      node = tree.c_right[node];
    }
  }
  return tree.val[node];
}

export function predictSegmentSpeedKmh(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  distKm: number,
  hour: number,
  isWeekend: number,
  routeId?: string
): { predSpeedKmh: number; dwellRatio: number; gridSpeedKmh: number } {
  const grid = getTrafficGrid();
  const model = getMLModel();

  const straightKm = Math.max(0.1, haversineMeters(lat1, lng1, lat2, lng2) / 1000);
  const circuity = Math.min(3.5, distKm / straightKm);
  const midLat = (lat1 + lat2) / 2;
  const midLng = (lng1 + lng2) / 2;

  const oPrior = lookupGridPrior(grid, lat1, lng1, hour, isWeekend, routeId);
  const dPrior = lookupGridPrior(grid, lat2, lng2, hour, isWeekend, routeId);
  const mPrior = lookupGridPrior(grid, midLat, midLng, hour, isWeekend, routeId);

  const ang = (2 * Math.PI * hour) / 24;
  const features = [
    distKm,
    straightKm,
    circuity,
    lat1,
    lng1,
    lat2,
    lng2,
    Math.sin(ang),
    Math.cos(ang),
    isWeekend,
    hour >= 7 && hour <= 10 ? 1 : 0,
    hour >= 17 && hour <= 20 ? 1 : 0,
    hour >= 22 || hour <= 5 ? 1 : 0,
    oPrior.speedKmh,
    dPrior.speedKmh,
    mPrior.speedKmh,
    (oPrior.dwellRatio + dPrior.dwellRatio + mPrior.dwellRatio) / 3,
    mPrior.routeSpeedKmh,
  ];

  let sum = 0;
  for (let i = 0; i < model.trees.length; i++) {
    sum += evalTree(model.trees[i], features);
  }
  const pred = Math.max(6.0, Math.min(48.0, sum / model.trees.length));
  return {
    predSpeedKmh: Math.round(pred * 10) / 10,
    dwellRatio: Math.round(((oPrior.dwellRatio + dPrior.dwellRatio + mPrior.dwellRatio) / 3) * 1000) / 1000,
    gridSpeedKmh: Math.round(mPrior.speedKmh * 10) / 10,
  };
}

/**
 * Predicts travel time along a sequence of stops on a route by chunking into ~3km segments
 * so local corridor congestion is captured accurately.
 */
export function predictLegTravelTime(
  stops: Stop[],
  segKm: number[],
  hour: number,
  isWeekend: number,
  routeId: string
): { durationMin: number; distanceKm: number; avgSpeedKmh: number; dwellRatio: number } {
  let totalMin = 0;
  let totalKm = 0;
  let weightedDwell = 0;

  let chunkStartIdx = 0;
  let chunkKm = 0;

  for (let i = 0; i < segKm.length; i++) {
    chunkKm += segKm[i];
    const isLast = i === segKm.length - 1;
    if (chunkKm >= 2.5 || isLast) {
      const sA = stops[chunkStartIdx];
      const sB = stops[i + 1];
      const dKm = Math.max(0.15, chunkKm);
      const { predSpeedKmh, dwellRatio } = predictSegmentSpeedKmh(
        sA.lat,
        sA.lng,
        sB.lat,
        sB.lng,
        dKm,
        hour,
        isWeekend,
        routeId
      );
      totalMin += (dKm / predSpeedKmh) * 60;
      totalKm += dKm;
      weightedDwell += dwellRatio * dKm;
      chunkStartIdx = i + 1;
      chunkKm = 0;
    }
  }

  const avgSpeed = totalMin > 0 ? totalKm / (totalMin / 60) : 18;
  return {
    durationMin: Math.round(totalMin * 10) / 10,
    distanceKm: Math.round(totalKm * 100) / 100,
    avgSpeedKmh: Math.round(avgSpeed * 10) / 10,
    dwellRatio: totalKm > 0 ? Math.round((weightedDwell / totalKm) * 1000) / 1000 : 0.15,
  };
}
