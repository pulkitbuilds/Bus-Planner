import { NextRequest, NextResponse } from "next/server";
import { getTrafficGrid } from "@/lib/data-loader";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const hour = Math.min(23, Math.max(0, parseInt(searchParams.get("hour") || "8", 10) || 0));
  const isWeekend = searchParams.get("is_weekend") === "1" ? 1 : 0;

  const grid = getTrafficGrid();
  const { lat_min, lng_min } = grid.bounds;
  const cs = grid.cell_size;

  const cells: Array<{ lat: number; lng: number; speed_kmh: number; dwell_ratio: number }> = [];
  for (const [key, val] of Object.entries(grid.fine)) {
    const parts = key.split("|");
    if (parts.length !== 3) continue;
    const [rc, hrStr, wkndStr] = parts;
    if (parseInt(hrStr, 10) !== hour || parseInt(wkndStr, 10) !== isWeekend) continue;
    const [rStr, cStr] = rc.split("_");
    const r = parseInt(rStr, 10);
    const c = parseInt(cStr, 10);
    cells.push({
      lat: Math.round((lat_min + (r + 0.5) * cs) * 10000) / 10000,
      lng: Math.round((lng_min + (c + 0.5) * cs) * 10000) / 10000,
      speed_kmh: val[0],
      dwell_ratio: val[1],
    });
  }

  return NextResponse.json({
    hour,
    is_weekend: isWeekend,
    cell_count: cells.length,
    cells: cells.slice(0, 1200),
    hourly_profile: grid.hourly_profile,
  });
}
