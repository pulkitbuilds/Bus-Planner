import { NextRequest, NextResponse } from "next/server";
import { getTransitGraph } from "@/lib/data-loader";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim().toLowerCase();
  const graph = getTransitGraph();

  const landmarks = graph.landmarks
    .filter((l) => !q || l.name.toLowerCase().includes(q))
    .slice(0, 20)
    .map((l) => ({
      type: "landmark" as const,
      id: l.nearest_stop_id,
      name: l.name,
      lat: l.lat,
      lng: l.lng,
    }));

  const stops = q
    ? Object.values(graph.stops)
        .filter((s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
        .slice(0, 15)
        .map((s) => ({
          type: "stop" as const,
          id: s.id,
          name: `${s.name} (${s.id})`,
          lat: s.lat,
          lng: s.lng,
          routes: s.routes.slice(0, 6),
        }))
    : [];

  return NextResponse.json({
    results: [...landmarks, ...stops].slice(0, 25),
    total_stops: Object.keys(graph.stops).length,
    total_routes: graph.routes.length,
  });
}
