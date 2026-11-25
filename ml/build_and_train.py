"""
Delhi Bus Traffic ML Pipeline & Transit Graph Builder
Trains on real DTC/Cluster bus GPS traces (2026-10-30 Friday & 2026-10-31 Saturday)
and exports:
  1. data/traffic_grid.json    - Hierarchical spatial-temporal speed & dwell priors
  2. data/transit_graph.json   - Inferred stops, Delhi landmarks, routes & polylines
  3. data/ml_model.json        - Exported RandomForestRegressor trees for JS inference
  4. data/model_metrics.json   - Validation metrics, hourly profiles, OD benchmarks
"""

import json
import math
import os
import sqlite3
import time
from collections import defaultdict

import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

DATASET_DIR = r"C:\Users\pulki\.gemini\antigravity\scratch\dataset"
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
os.makedirs(OUT_DIR, exist_ok=True)

DBS = [
    ("bus_movements_2026_10_30.db", 0),  # Friday (weekday)
    ("bus_movements_2026_10_31.db", 1),  # Saturday (weekend)
]

LAT_MIN, LAT_MAX = 28.40, 28.90
LNG_MIN, LNG_MAX = 76.85, 77.40
CELL_SIZE = 0.01  # ~1.1 km
COARSE_SIZE = 0.03  # ~3.3 km

DELHI_LANDMARKS = [
    ("Kashmere Gate ISBT", 28.6675, 77.2282),
    ("Nehru Place", 28.5494, 77.2519),
    ("Connaught Place / Rajiv Chowk", 28.6328, 77.2197),
    ("AIIMS / Safdarjung", 28.5672, 77.2100),
    ("Anand Vihar ISBT", 28.6469, 77.3160),
    ("Sarai Kale Khan ISBT", 28.5889, 77.2591),
    ("Hauz Khas", 28.5494, 77.2001),
    ("Dhaula Kuan", 28.5919, 77.1616),
    ("ITO", 28.6289, 77.2412),
    ("Karol Bagh", 28.6519, 77.1905),
    ("Lajpat Nagar", 28.5677, 77.2433),
    ("Saket", 28.5245, 77.2066),
    ("Chandni Chowk / Red Fort", 28.6562, 77.2300),
    ("India Gate", 28.6129, 77.2295),
    ("Dwarka Mor", 28.6193, 77.0332),
    ("Dwarka Sector 21", 28.5522, 77.0583),
    ("Rohini Sector 18", 28.7383, 77.1398),
    ("Janakpuri West", 28.6295, 77.0777),
    ("Laxmi Nagar", 28.6305, 77.2773),
    ("Akshardham", 28.6127, 77.2773),
    ("Mayur Vihar Phase 1", 28.6042, 77.2893),
    ("Okhla / NSIC", 28.5554, 77.2654),
    ("Kalkaji Mandir", 28.5499, 77.2588),
    ("Vasant Kunj", 28.5293, 77.1538),
    ("Pitampura", 28.7033, 77.1322),
    ("Azadpur", 28.7076, 77.1806),
    ("Shahdara", 28.6736, 77.2896),
    ("Badarpur Border", 28.4936, 77.3031),
    ("Mehrauli", 28.5205, 77.1855),
    ("IGI Airport T3", 28.5562, 77.1000),
    ("New Delhi Railway Station", 28.6429, 77.2191),
    ("Nizamuddin Railway Station", 28.5879, 77.2512),
    ("Mandi House", 28.6256, 77.2344),
    ("Rajouri Garden", 28.6422, 77.1190),
    ("Punjabi Bagh", 28.6685, 77.1267),
    ("Peeragarhi", 28.6799, 77.0928),
    ("Nangloi", 28.6824, 77.0677),
    ("Najafgarh", 28.6092, 76.9798),
    ("Narela", 28.8527, 77.0929),
    ("Dilshad Garden", 28.6758, 77.3214),
]


def haversine_m(lat1, lon1, lat2, lon2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(min(1.0, a)))


def cell_key(lat, lng, size=CELL_SIZE):
    return f"{int((lat - LAT_MIN) / size)}_{int((lng - LNG_MIN) / size)}"


def build_traffic_grid():
    print("[1/4] Building hierarchical spatial-temporal traffic grid...")
    t0 = time.time()
    fine_stats = defaultdict(lambda: [0.0, 0.0, 0])  # sum_spd, sum_dwell, cnt
    coarse_stats = defaultdict(lambda: [0.0, 0.0, 0])
    city_stats = defaultdict(lambda: [0.0, 0.0, 0])
    route_hour_stats = defaultdict(lambda: [0.0, 0])
    hourly_profile = defaultdict(lambda: [0.0, 0.0, 0.0, 0])  # avg_spd, mov_spd, dwell, cnt

    for fname, is_wknd in DBS:
        db_path = os.path.join(DATASET_DIR, fname)
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        cur = conn.cursor()
        # 5% uniform sample across all rows (~2.85M pings total)
        rows = cur.execute("""
            SELECT CAST(lat AS REAL), CAST(lng AS REAL), speed, CAST(route_id AS INTEGER),
                   CAST(substr(time, 1, 2) AS INTEGER) as hr
            FROM vehicle_feed
            WHERE rowid % 20 = 0
              AND speed >= 0 AND speed <= 25
              AND CAST(lat AS REAL) BETWEEN ? AND ?
              AND CAST(lng AS REAL) BETWEEN ? AND ?
        """, (LAT_MIN, LAT_MAX, LNG_MIN, LNG_MAX))

        for lat, lng, spd, rid, hr in rows:
            is_dwell = 1.0 if spd <= 0.5 else 0.0
            ck = cell_key(lat, lng, CELL_SIZE)
            cck = cell_key(lat, lng, COARSE_SIZE)

            # We store moving speed & dwell separately + effective speed
            fk = f"{ck}|{hr}|{is_wknd}"
            fine_stats[fk][0] += spd
            fine_stats[fk][1] += is_dwell
            fine_stats[fk][2] += 1

            fk_all = f"{ck}|{hr}"
            fine_stats[fk_all][0] += spd
            fine_stats[fk_all][1] += is_dwell
            fine_stats[fk_all][2] += 1

            ck_all = f"{cck}|{hr}"
            coarse_stats[ck_all][0] += spd
            coarse_stats[ck_all][1] += is_dwell
            coarse_stats[ck_all][2] += 1

            city_k = f"{hr}|{is_wknd}"
            city_stats[city_k][0] += spd
            city_stats[city_k][1] += is_dwell
            city_stats[city_k][2] += 1

            if rid:
                rk = f"{rid}|{hr}"
                route_hour_stats[rk][0] += spd
                route_hour_stats[rk][1] += 1

            hp = hourly_profile[f"{hr}|{is_wknd}"]
            hp[0] += spd
            if spd > 0.5:
                hp[1] += spd
                hp[3] += 1
            hp[2] += is_dwell

        conn.close()

    # Convert to km/h (with empirical factor from GPS displacement)
    # Note: raw speed in feed is m/s; multiply by 3.6 -> km/h, clamp realistic bus avg [7, 45]
    city_json = {}
    for k, (ss, sd, cnt) in city_stats.items():
        city_json[k] = {
            "speed_kmh": round(max(8.0, min(42.0, (ss / cnt) * 3.6)), 2),
            "dwell_ratio": round(sd / cnt, 3),
            "count": cnt,
        }

    coarse_json = {}
    for k, (ss, sd, cnt) in coarse_stats.items():
        if cnt >= 10:
            coarse_json[k] = [round(max(7.0, min(45.0, (ss / cnt) * 3.6)), 2), round(sd / cnt, 3)]

    fine_json = {}
    for k, (ss, sd, cnt) in fine_stats.items():
        if cnt >= 8:
            fine_json[k] = [round(max(7.0, min(45.0, (ss / cnt) * 3.6)), 2), round(sd / cnt, 3)]

    route_json = {}
    for k, (ss, cnt) in route_hour_stats.items():
        if cnt >= 10:
            route_json[k] = round(max(7.0, min(45.0, (ss / cnt) * 3.6)), 2)

    profile_list = []
    for hr in range(24):
        row = {"hour": hr}
        for is_wknd, label in [(0, "weekday"), (1, "weekend")]:
            k = f"{hr}|{is_wknd}"
            ss, sd, cnt = city_stats.get(k, [3.0, 0.2, 1])
            mov_s, _, _, mov_cnt = hourly_profile.get(k, [0, 5.0, 0, 1])
            row[label] = {
                "avg_speed_kmh": round((ss / max(1, cnt)) * 3.6, 2),
                "moving_speed_kmh": round((mov_s / max(1, mov_cnt)) * 3.6, 2),
                "dwell_pct": round((sd / max(1, cnt)) * 100, 1),
                "pings": cnt,
            }
        profile_list.append(row)

    grid_data = {
        "bounds": {"lat_min": LAT_MIN, "lat_max": LAT_MAX, "lng_min": LNG_MIN, "lng_max": LNG_MAX},
        "cell_size": CELL_SIZE,
        "coarse_size": COARSE_SIZE,
        "city": city_json,
        "coarse": coarse_json,
        "fine": fine_json,
        "route_hour": route_json,
        "hourly_profile": profile_list,
    }
    with open(os.path.join(OUT_DIR, "traffic_grid.json"), "w") as f:
        json.dump(grid_data, f)
    print(f"   Done in {time.time() - t0:.1f}s: {len(fine_json)} fine cells, {len(coarse_json)} coarse cells, {len(route_json)} route-hours")
    return grid_data


def lookup_grid_prior(grid, lat, lng, hr, is_wknd, route_id=None):
    ck = cell_key(lat, lng, CELL_SIZE)
    cck = cell_key(lat, lng, COARSE_SIZE)

    val = grid["fine"].get(f"{ck}|{hr}|{is_wknd}")
    if val is None:
        val = grid["fine"].get(f"{ck}|{hr}")
    if val is None:
        val = grid["coarse"].get(f"{cck}|{hr}")
    if val is None:
        c = grid["city"].get(f"{hr}|{is_wknd}", {"speed_kmh": 18.0, "dwell_ratio": 0.15})
        val = [c["speed_kmh"], c["dwell_ratio"]]

    r_spd = val[0]
    if route_id is not None:
        r_spd = grid["route_hour"].get(f"{route_id}|{hr}", val[0])
    return val[0], val[1], r_spd


def extract_trip_segments(grid):
    print("[2/4] Extracting real observed bus trip segments for ML training & validation...")
    t0 = time.time()
    segments = []

    for fname, is_wknd in DBS:
        db_path = os.path.join(DATASET_DIR, fname)
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        cur = conn.cursor()

        # Sample ~350 distinct vehicles (indexed!) across both days -> yields ~1,500+ trips in <10s
        vehs = [r[0] for r in cur.execute("""
            SELECT DISTINCT vehicle_id
            FROM vehicle_feed
            WHERE rowid % 500 = 0
              AND vehicle_id IS NOT NULL
            LIMIT 350
        """).fetchall()]

        for vid in vehs:
            all_pts = cur.execute("""
                SELECT trip_id, CAST(route_id AS INTEGER), CAST(lat AS REAL), CAST(lng AS REAL),
                       CAST(timestamp AS INTEGER), CAST(substr(time, 1, 2) AS INTEGER)
                FROM vehicle_feed
                WHERE vehicle_id = ?
                ORDER BY CAST(timestamp AS INTEGER)
            """, (vid,)).fetchall()

            by_trip = defaultdict(list)
            for trip_id, rid, lat, lng, ts, hr in all_pts:
                if trip_id:
                    by_trip[(trip_id, rid)].append((lat, lng, ts, hr))

            for (trip_id, rid), pts in by_trip.items():
                if len(pts) < 12:
                    continue

                # Clean GPS jumps & build cumulative distance
                clean = [pts[0]]
                cum_dist = [0.0]
                for i in range(1, len(pts)):
                    lat1, lng1, ts1, _ = clean[-1]
                    lat2, lng2, ts2, hr2 = pts[i]
                    if not (LAT_MIN <= lat2 <= LAT_MAX and LNG_MIN <= lng2 <= LNG_MAX):
                        continue
                    dt = ts2 - ts1
                    if dt <= 0 or dt > 300:
                        continue
                    d = haversine_m(lat1, lng1, lat2, lng2)
                    if d / dt > 25.0:  # >90 km/h GPS jump
                        continue
                    clean.append((lat2, lng2, ts2, hr2))
                    cum_dist.append(cum_dist[-1] + d)

                if len(clean) < 10 or cum_dist[-1] < 1200:
                    continue

                # Slice up to 8 non-trivial segments per trip
                n = len(clean)
                step = max(2, n // 6)
                for i in range(0, n - step, step):
                    for j_off in (step, min(n - 1 - i, step * 2)):
                        j = i + j_off
                        if j >= n:
                            continue
                        dist_m = cum_dist[j] - cum_dist[i]
                        dt = clean[j][2] - clean[i][2]
                        if dist_m < 800 or dist_m > 22000 or dt < 90 or dt > 5400:
                            continue
                        obs_kmh = (dist_m / dt) * 3.6
                        if obs_kmh < 4.0 or obs_kmh > 55.0:
                            continue

                        lat1, lng1, _, hr1 = clean[i]
                        lat2, lng2, _, _ = clean[j]
                        mid_lat, mid_lng = (lat1 + lat2) / 2.0, (lng1 + lng2) / 2.0
                        straight_km = max(0.1, haversine_m(lat1, lng1, lat2, lng2) / 1000.0)
                        dist_km = dist_m / 1000.0

                        o_spd, o_dw, _ = lookup_grid_prior(grid, lat1, lng1, hr1, is_wknd, rid)
                        d_spd, d_dw, _ = lookup_grid_prior(grid, lat2, lng2, hr1, is_wknd, rid)
                        m_spd, m_dw, r_spd = lookup_grid_prior(grid, mid_lat, mid_lng, hr1, is_wknd, rid)

                        ang = 2 * math.pi * hr1 / 24.0
                        segments.append({
                            "trip_id": f"{fname}_{trip_id}",
                            "route_id": rid,
                            "hour": hr1,
                            "is_weekend": is_wknd,
                            "dist_km": dist_km,
                            "obs_dur_s": dt,
                            "obs_kmh": obs_kmh,
                            "features": [
                                dist_km,
                                straight_km,
                                dist_km / straight_km,
                                lat1,
                                lng1,
                                lat2,
                                lng2,
                                math.sin(ang),
                                math.cos(ang),
                                is_wknd,
                                1 if 7 <= hr1 <= 10 else 0,
                                1 if 17 <= hr1 <= 20 else 0,
                                1 if (hr1 >= 22 or hr1 <= 5) else 0,
                                o_spd,
                                d_spd,
                                m_spd,
                                (o_dw + d_dw + m_dw) / 3.0,
                                r_spd,
                            ],
                        })

        conn.close()

    print(f"   Extracted {len(segments)} observed trip segments in {time.time() - t0:.1f}s")
    return segments


def export_tree(tree):
    t = tree.tree_
    return {
        "c_left": t.children_left.tolist(),
        "c_right": t.children_right.tolist(),
        "feat": t.feature.tolist(),
        "thresh": [round(float(x), 5) for x in t.threshold],
        "val": [round(float(v[0][0]), 3) for v in t.value],
    }


def train_and_validate(segments, grid):
    print("[3/4] Training RandomForestRegressor & validating on 20% held-out trips...")
    t0 = time.time()

    # Group split by trip_id so no trip leaks across train & test
    rng = np.random.default_rng(42)
    unique_trips = list({s["trip_id"] for s in segments})
    rng.shuffle(unique_trips)
    split_idx = int(len(unique_trips) * 0.8)
    train_trips = set(unique_trips[:split_idx])

    X_train, y_train = [], []
    test_segs = []
    for s in segments:
        if s["trip_id"] in train_trips:
            X_train.append(s["features"])
            y_train.append(s["obs_kmh"])
        else:
            test_segs.append(s)

    X_train = np.array(X_train, dtype=np.float32)
    y_train = np.array(y_train, dtype=np.float32)
    X_test = np.array([s["features"] for s in test_segs], dtype=np.float32)
    y_test_kmh = np.array([s["obs_kmh"] for s in test_segs], dtype=np.float32)
    y_test_min = np.array([s["obs_dur_s"] / 60.0 for s in test_segs], dtype=np.float32)
    test_dist = np.array([s["dist_km"] for s in test_segs], dtype=np.float32)

    model = RandomForestRegressor(
        n_estimators=32,
        max_depth=10,
        min_samples_leaf=15,
        n_jobs=-1,
        random_state=42,
    )
    model.fit(X_train, y_train)

    pred_kmh = np.clip(model.predict(X_test), 5.0, 50.0)
    pred_min = (test_dist / pred_kmh) * 60.0

    # Baseline 1: Fixed timetable speed (mean training speed)
    const_kmh = float(np.mean(y_train))
    base_const_min = (test_dist / const_kmh) * 60.0

    # Baseline 2: City-hour average
    city_pred_kmh = np.array([
        grid["city"].get(f"{s['hour']}|{s['is_weekend']}", {"speed_kmh": const_kmh})["speed_kmh"]
        for s in test_segs
    ])
    base_city_min = (test_dist / np.clip(city_pred_kmh, 5.0, 50.0)) * 60.0

    metrics = {
        "train_segments": len(X_train),
        "test_segments": len(X_test),
        "train_trips": len(train_trips),
        "test_trips": len(unique_trips) - len(train_trips),
        "ml_model": {
            "name": "RandomForestRegressor (32 trees, max_depth=10)",
            "mae_min": round(float(mean_absolute_error(y_test_min, pred_min)), 2),
            "rmse_min": round(float(np.sqrt(mean_squared_error(y_test_min, pred_min))), 2),
            "mape_pct": round(float(np.mean(np.abs(y_test_min - pred_min) / np.maximum(1.0, y_test_min)) * 100), 1),
            "r2_duration": round(float(r2_score(y_test_min, pred_min)), 3),
            "mae_speed_kmh": round(float(mean_absolute_error(y_test_kmh, pred_kmh)), 2),
        },
        "baseline_timetable": {
            "name": f"Static Timetable ({const_kmh:.1f} km/h constant)",
            "mae_min": round(float(mean_absolute_error(y_test_min, base_const_min)), 2),
            "rmse_min": round(float(np.sqrt(mean_squared_error(y_test_min, base_const_min))), 2),
            "mape_pct": round(float(np.mean(np.abs(y_test_min - base_const_min) / np.maximum(1.0, y_test_min)) * 100), 1),
            "r2_duration": round(float(r2_score(y_test_min, base_const_min)), 3),
        },
        "baseline_city_hour": {
            "name": "City-Wide Hourly Average",
            "mae_min": round(float(mean_absolute_error(y_test_min, base_city_min)), 2),
            "rmse_min": round(float(np.sqrt(mean_squared_error(y_test_min, base_city_min))), 2),
            "mape_pct": round(float(np.mean(np.abs(y_test_min - base_city_min) / np.maximum(1.0, y_test_min)) * 100), 1),
            "r2_duration": round(float(r2_score(y_test_min, base_city_min)), 3),
        },
        "feature_names": [
            "dist_km", "straight_km", "circuity", "start_lat", "start_lng",
            "end_lat", "end_lng", "hour_sin", "hour_cos", "is_weekend",
            "is_morning_peak", "is_evening_peak", "is_night",
            "origin_grid_speed", "dest_grid_speed", "mid_grid_speed",
            "mean_dwell_ratio", "route_hour_speed",
        ],
        "feature_importances": [round(float(x), 4) for x in model.feature_importances_],
    }

    print(f"   ML MAE: {metrics['ml_model']['mae_min']} min (R2={metrics['ml_model']['r2_duration']}) vs Static MAE: {metrics['baseline_timetable']['mae_min']} min in {time.time() - t0:.1f}s")

    model_json = {
        "n_estimators": len(model.estimators_),
        "features": metrics["feature_names"],
        "trees": [export_tree(est) for est in model.estimators_],
    }
    with open(os.path.join(OUT_DIR, "ml_model.json"), "w") as f:
        json.dump(model_json, f)
    with open(os.path.join(OUT_DIR, "model_metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2)
    return metrics


def build_transit_graph():
    print("[4/4] Building Delhi bus route & stop network graph from GPS trajectories...")
    t0 = time.time()
    db_path = os.path.join(DATASET_DIR, DBS[0][0])
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    cur = conn.cursor()

    # Single fast scan of daytime rows (rowid % 5 == 0) to collect one clean trip per route!
    route_trips = defaultdict(list)
    rows = cur.execute("""
        SELECT CAST(route_id AS INTEGER) as rid, trip_id,
               CAST(lat AS REAL), CAST(lng AS REAL), CAST(timestamp AS INTEGER)
        FROM vehicle_feed
        WHERE rowid % 5 = 0
          AND route_id IS NOT NULL AND trip_id IS NOT NULL
          AND time BETWEEN '07:00:00' AND '21:00:00'
          AND CAST(lat AS REAL) BETWEEN ? AND ?
          AND CAST(lng AS REAL) BETWEEN ? AND ?
    """, (LAT_MIN, LAT_MAX, LNG_MIN, LNG_MAX))

    trip_pts = defaultdict(list)
    trip_route = {}
    for rid, trip_id, lat, lng, ts in rows:
        trip_pts[trip_id].append((lat, lng, ts))
        trip_route[trip_id] = rid

    # Pick the longest clean trip per route_id
    best_trip_for_route = {}
    for tid, pts in trip_pts.items():
        if not (25 <= len(pts) <= 600):
            continue
        rid = trip_route[tid]
        if rid not in best_trip_for_route or len(pts) > len(best_trip_for_route[rid][1]):
            best_trip_for_route[rid] = (tid, pts)

    # Keep top 220 routes by trip point count
    top_routes = sorted(best_trip_for_route.items(), key=lambda x: len(x[1][1]), reverse=True)[:220]

    raw_routes = []
    # Stop clustering grid (~280m cells)
    stop_cells = {}  # key -> {id, lat_sum, lng_sum, cnt, routes: set}

    def get_or_create_stop(lat, lng, rid):
        sk = f"{round(lat / 0.0025)}_{round(lng / 0.0025)}"
        if sk not in stop_cells:
            stop_cells[sk] = {
                "id": f"S{len(stop_cells) + 1:04d}",
                "lat_sum": 0.0,
                "lng_sum": 0.0,
                "cnt": 0,
                "routes": set(),
            }
        sc = stop_cells[sk]
        sc["lat_sum"] += lat
        sc["lng_sum"] += lng
        sc["cnt"] += 1
        sc["routes"].add(rid)
        return sc["id"]

    for rid, (tid, pts) in top_routes:
        pts.sort(key=lambda x: x[2])

        # Filter jumps & sample waypoints every ~650m
        clean_pts = []
        for lat, lng, ts in pts:
            if not (LAT_MIN <= lat <= LAT_MAX and LNG_MIN <= lng <= LNG_MAX):
                continue
            if clean_pts:
                dt = ts - clean_pts[-1][2]
                if dt <= 0:
                    continue
                d = haversine_m(clean_pts[-1][0], clean_pts[-1][1], lat, lng)
                if d / dt > 25.0:
                    continue
            clean_pts.append((lat, lng, ts))

        if len(clean_pts) < 8:
            continue

        stop_seq = []
        last_lat, last_lng = clean_pts[0][0], clean_pts[0][1]
        s0 = get_or_create_stop(last_lat, last_lng, rid)
        stop_seq.append((s0, 0.0))

        acc_m = 0.0
        for lat, lng, _ in clean_pts[1:]:
            d = haversine_m(last_lat, last_lng, lat, lng)
            acc_m += d
            last_lat, last_lng = lat, lng
            if acc_m >= 650.0:
                sid = get_or_create_stop(lat, lng, rid)
                if sid != stop_seq[-1][0]:
                    stop_seq.append((sid, round(acc_m / 1000.0, 3)))
                    acc_m = 0.0

        # Ensure last point is included
        end_lat, end_lng, _ = clean_pts[-1]
        s_end = get_or_create_stop(end_lat, end_lng, rid)
        if s_end != stop_seq[-1][0] and acc_m >= 150.0:
            stop_seq.append((s_end, round(acc_m / 1000.0, 3)))

        if len(stop_seq) >= 5:
            raw_routes.append({
                "route_id": str(rid),
                "stops": [x[0] for x in stop_seq],
                "seg_km": [x[1] for x in stop_seq[1:]],
            })

    conn.close()

    # Finalize stops & assign nearest Delhi landmark names
    stops_out = {}
    for sk, sc in stop_cells.items():
        lat = sc["lat_sum"] / sc["cnt"]
        lng = sc["lng_sum"] / sc["cnt"]
        # Find nearest landmark
        best_lm, best_d = None, 1e9
        for name, llat, llng in DELHI_LANDMARKS:
            d = haversine_m(lat, lng, llat, llng)
            if d < best_d:
                best_d = d
                best_lm = name
        if best_d <= 450:
            label = f"{best_lm}"
        elif best_d <= 1500:
            label = f"Near {best_lm}"
        else:
            ns = "N" if lat >= 28.63 else "S"
            ew = "E" if lng >= 77.22 else "W"
            label = f"{best_lm} ({ns}{ew} Corridor)"

        stops_out[sc["id"]] = {
            "id": sc["id"],
            "name": label,
            "lat": round(lat, 5),
            "lng": round(lng, 5),
            "routes": sorted([str(r) for r in sc["routes"]]),
        }

    # Deduplicate/disambiguate stop names slightly by appending stop ID if needed in UI
    landmarks_out = []
    for name, llat, llng in DELHI_LANDMARKS:
        # Find closest stop
        best_sid, best_d = None, 1e9
        for sid, s in stops_out.items():
            d = haversine_m(llat, llng, s["lat"], s["lng"])
            if d < best_d:
                best_d = d
                best_sid = sid
        landmarks_out.append({
            "name": name,
            "lat": llat,
            "lng": llng,
            "nearest_stop_id": best_sid,
            "walk_m": round(best_d),
        })

    graph = {
        "stops": stops_out,
        "routes": raw_routes,
        "landmarks": landmarks_out,
    }
    with open(os.path.join(OUT_DIR, "transit_graph.json"), "w") as f:
        json.dump(graph, f)

    print(f"   Done in {time.time() - t0:.1f}s: {len(stops_out)} stops, {len(raw_routes)} routes, {len(landmarks_out)} landmarks")
    return graph


if __name__ == "__main__":
    grid = build_traffic_grid()
    segs = extract_trip_segments(grid)
    train_and_validate(segs, grid)
    build_transit_graph()
    print("ALL ML ARTIFACTS GENERATED SUCCESSFULLY!")
