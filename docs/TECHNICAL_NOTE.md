# Technical Note: Delhi Bus Travel-Time Model & Journey Planner

## 1. Data Ingestion & GPS Noise Filtering
The raw telemetry consists of two SQLite databases (`2026-10-30` Friday and `2026-10-31` Saturday) totaling ~57 million GPS pings (`vehicle_id`, `lat`, `lng`, `speed`, `route_id`, `trip_id`, `timestamp`, `date`, `time`).
To handle noisy or irregular GPS reports:
- **Bounding Box Filter**: Coordinates are constrained to Delhi NCR (`lat ∈ [28.40, 28.90]`, `lng ∈ [76.85, 77.40]`).
- **Kinematic Jump Filter**: Consecutive points on the same `trip_id` with implied displacement speed `> 25 m/s` (`90 km/h`) or `dt <= 0` / `dt > 300s` are discarded.
- **Speed Sanity Filter**: Instantaneous feed speeds outside `[0, 25] m/s` are excluded from spatial-temporal priors.

## 2. Linking GPS Points to Routes, Stops & Road Grid
Because static GTFS files are not bundled in the local workspace, the transit network is inferred directly from GPS trajectories:
1. **Route Topology**: For the top 220 active `route_id`s, representative daytime trips with monotonic timestamps are resampled every ~650 meters into ordered stop sequences (`data/transit_graph.json`).
2. **Stop Clustering & Transfer Hubs**: Stop coordinates are snapped to a `0.0025°` (~280m) spatial grid so overlapping routes share unified transfer nodes. Forty major Delhi landmarks (ISBTs, Metro interchanges, commercial hubs) are mapped to their nearest inferred bus stops.
3. **Road Grid Mapping**: GPS pings are aggregated onto a `0.01°` (~1.1 km) fine grid and a `0.03°` (~3.3 km) coarse grid across all 24 hours and both day types (`weekday` vs `weekend`).

## 3. Separating Moving Speed vs. Dwell & Signal Wait
A bus waiting at a bus stop or traffic signal reports `speed ≤ 0.5 m/s`. We track:
- **Dwell Ratio**: Fraction of GPS pings in a `(cell, hour)` with `speed ≤ 0.5 m/s`.
- **Ground-Truth Segment Duration**: When extracting training segments from `trip_id` trajectories (`0.8 km – 22 km`), the regression target is **actual elapsed clock time** (`t_end - t_start`), which inherently includes both moving time and stop/signal dwell time.

## 4. Handling Sparse Roads & Off-Peak Hours
For cells or hours with fewer than 8 observations, `lookupGridPrior` applies a 4-level hierarchical fallback:
1. `(fine_cell_1.1km, hour, is_weekend)`
2. `(fine_cell_1.1km, hour)` (pooled across days)
3. `(coarse_cell_3.3km, hour)` (spatial neighborhood)
4. `(city_wide, hour, is_weekend)` (temporal prior)

## 5. ML Model & Serverless Deployment
A 32-tree `RandomForestRegressor` (`max_depth=10`, `min_samples_leaf=15`) is trained on 18 features (path distance, straight-line distance, circuity, origin/destination coordinates, cyclical hour encoding `sin/cos`, peak/night flags, origin/mid/dest grid speeds, mean dwell ratio, and route-hour speed prior).
The trained forest is exported to `data/ml_model.json` and evaluated in pure TypeScript (`src/lib/ml-predictor.ts`) inside Next.js API routes, enabling sub-millisecond inference on Vercel Serverless Functions without heavy Python ML dependencies.
