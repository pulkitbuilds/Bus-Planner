import { NextRequest, NextResponse } from "next/server";
import { planJourneys } from "@/lib/journey-planner";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const depart = searchParams.get("depart") || undefined;
  const dayParam = searchParams.get("day");
  const dayOverride =
    dayParam === "weekday" || dayParam === "weekend" ? dayParam : undefined;

  if (!from || !to) {
    return NextResponse.json(
      {
        error: "Missing required query parameters 'from' and 'to'.",
        example: "/api/journeys?from=Kashmere%20Gate%20ISBT&to=Nehru%20Place&depart=08:30&day=weekday",
      },
      { status: 400 }
    );
  }

  try {
    const result = planJourneys(from, to, depart, dayOverride);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }
    return NextResponse.json({
      query: { from, to, depart: depart || "08:30", day: result.departure.dayType },
      ...result,
      model_info: {
        type: "RandomForestRegressor (32 trees) + 4-level hierarchical spatial-temporal GPS prior",
        dataset: "Delhi DTC/Cluster Bus GPS Telemetry (Oct 30-31, 2026)",
      },
    });
  } catch (err) {
    console.error("Journey planning error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
