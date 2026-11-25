import { NextResponse } from "next/server";
import { getModelMetrics, getTrafficGrid, getTransitGraph } from "@/lib/data-loader";

export async function GET() {
  const metrics = getModelMetrics();
  const grid = getTrafficGrid();
  const graph = getTransitGraph();

  return NextResponse.json({
    metrics,
    network: {
      stops: Object.keys(graph.stops).length,
      routes: graph.routes.length,
      landmarks: graph.landmarks.length,
      fine_cells: Object.keys(grid.fine).length,
      route_hour_priors: Object.keys(grid.route_hour).length,
    },
    hourly_profile: grid.hourly_profile,
  });
}
