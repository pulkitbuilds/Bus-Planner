import fs from "fs";
import path from "path";

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lng: number;
  routes: string[];
}

export interface RouteInfo {
  route_id: string;
  stops: string[];
  seg_km: number[];
}

export interface Landmark {
  name: string;
  lat: number;
  lng: number;
  nearest_stop_id: string;
  walk_m: number;
}

export interface TransitGraph {
  stops: Record<string, Stop>;
  routes: RouteInfo[];
  landmarks: Landmark[];
}

export interface TrafficGrid {
  bounds: { lat_min: number; lat_max: number; lng_min: number; lng_max: number };
  cell_size: number;
  coarse_size: number;
  city: Record<string, { speed_kmh: number; dwell_ratio: number; count: number }>;
  coarse: Record<string, [number, number]>;
  fine: Record<string, [number, number]>;
  route_hour: Record<string, number>;
  hourly_profile: Array<{
    hour: number;
    weekday: { avg_speed_kmh: number; moving_speed_kmh: number; dwell_pct: number; pings: number };
    weekend: { avg_speed_kmh: number; moving_speed_kmh: number; dwell_pct: number; pings: number };
  }>;
}

export interface DecisionTree {
  c_left: number[];
  c_right: number[];
  feat: number[];
  thresh: number[];
  val: number[];
}

export interface MLModel {
  n_estimators: number;
  features: string[];
  trees: DecisionTree[];
}

export interface ModelMetrics {
  train_segments: number;
  test_segments: number;
  train_trips: number;
  test_trips: number;
  ml_model: {
    name: string;
    mae_min: number;
    rmse_min: number;
    mape_pct: number;
    r2_duration: number;
    mae_speed_kmh: number;
  };
  baseline_timetable: {
    name: string;
    mae_min: number;
    rmse_min: number;
    mape_pct: number;
    r2_duration: number;
  };
  baseline_city_hour: {
    name: string;
    mae_min: number;
    rmse_min: number;
    mape_pct: number;
    r2_duration: number;
  };
  feature_names: string[];
  feature_importances: number[];
}

export interface StopRouteRef {
  routeIdx: number;
  posIdx: number;
}

let cachedGraph: TransitGraph | null = null;
let cachedGrid: TrafficGrid | null = null;
let cachedModel: MLModel | null = null;
let cachedMetrics: ModelMetrics | null = null;
let cachedStopRoutes: Record<string, StopRouteRef[]> | null = null;

function readJson<T>(filename: string): T {
  const filePath = path.join(process.cwd(), "data", filename);
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

export function getTransitGraph(): TransitGraph {
  if (!cachedGraph) {
    cachedGraph = readJson<TransitGraph>("transit_graph.json");
  }
  return cachedGraph;
}

export function getStopRouteIndex(): Record<string, StopRouteRef[]> {
  if (!cachedStopRoutes) {
    const graph = getTransitGraph();
    const idx: Record<string, StopRouteRef[]> = {};
    graph.routes.forEach((r, rIdx) => {
      r.stops.forEach((sid, pIdx) => {
        if (!idx[sid]) idx[sid] = [];
        idx[sid].push({ routeIdx: rIdx, posIdx: pIdx });
      });
    });
    cachedStopRoutes = idx;
  }
  return cachedStopRoutes;
}

export function getTrafficGrid(): TrafficGrid {
  if (!cachedGrid) {
    cachedGrid = readJson<TrafficGrid>("traffic_grid.json");
  }
  return cachedGrid;
}

export function getMLModel(): MLModel {
  if (!cachedModel) {
    cachedModel = readJson<MLModel>("ml_model.json");
  }
  return cachedModel;
}

export function getModelMetrics(): ModelMetrics {
  if (!cachedMetrics) {
    cachedMetrics = readJson<ModelMetrics>("model_metrics.json");
  }
  return cachedMetrics;
}
