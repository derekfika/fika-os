import { NextRequest, NextResponse } from "next/server";
import { hubFetch } from "@/lib/hub";

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const endpoint = "/api/bookings/mnk";
    const response = await hubFetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const bodyText = await response.text();
    try {
      return NextResponse.json(JSON.parse(bodyText), {
        status: response.status,
      });
    } catch {
      return NextResponse.json(
        {
          error: {
            message: `The Canon bridge returned an unexpected response (HTTP ${response.status}). Check that the Integration Hub is running on port 3200 and the bridge token matches.`,
          },
        },
        { status: response.ok ? 502 : response.status },
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: { message: (error as Error).message } },
      { status: 503 },
    );
  }
}
