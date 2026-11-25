# Delhi Bus Traffic Model & Journey Planner

An ML-powered bus travel-time prediction engine and journey planner for Delhi's DTC & Cluster bus network, trained on real bus GPS telemetry and deployable zero-config on **Vercel**.

## Features
- **ML Travel-Time Model (`RandomForestRegressor`)**: Trained on real observed bus trip segments extracted from 57M+ GPS telemetry records (`bus_movements_2026_10_30.db` & `bus_movements_2026_10_31.db`), capturing hour-of-day, weekday vs. weekend, route circuity, and spatial-temporal road speeds.
- **4-Level Hierarchical Spatial-Temporal Fallback**: Handles sparse roads and off-peak hours gracefully by shrinking from `(1.1km cell, hour, day_type)` → `(1.1km cell, hour)` → `(3.3km coarse cell, hour)` → `(city-wide, hour, day_type)`.
- **Direct & 1-Transfer Journey Planner**: Supports origin/destination by landmark name, Stop ID, `lat,lng` coordinates, or clicking directly on the interactive Delhi map.
- **Quiet-Hour Counterfactual**: Every journey option compares the predicted travel time at the requested departure time against a 23:00 (11:00 PM) quiet-hour baseline.
- **Zero-Dependency Serverless Inference**: The trained scikit-learn Random Forest is exported to `data/ml_model.json` and evaluated in pure TypeScript (`src/lib/ml-predictor.ts`) for sub-millisecond inference on Vercel.

## API Endpoints
- `GET /api/journeys?from=Kashmere%20Gate%20ISBT&to=Nehru%20Place&depart=08:30&day=weekday`
- `GET /api/stops?q=Kashmere`
- `GET /api/traffic?hour=8&is_weekend=0`
- `GET /api/model-metrics`
- `GET /api/health`

## Local Development & Retraining

### 1. Retrain ML Model & Rebuild Transit Graph (Optional)
```bash
python -m venv .venv
.venv\Scripts\activate
pip install numpy pandas scikit-learn
python ml/build_and_train.py
```

### 2. Run Next.js Web App
```bash
npm install
npm run dev
```
Open http://localhost:3000.

## Deploy to Vercel
```bash
npx vercel --prod
```
Or connect the GitHub repository (`pulkitbuilds/Bus-Planner`) in the Vercel dashboard — Next.js App Router + `/api/*` routes + `data/*.json` deploy automatically.
