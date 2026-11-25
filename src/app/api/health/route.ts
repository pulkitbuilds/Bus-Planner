import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "delhi-bus-planner",
    timestamp: new Date().toISOString(),
  });
}
