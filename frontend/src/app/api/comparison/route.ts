
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const backendUrl =
    process.env.DJANGO_API_URL ?? "http://127.0.0.1:8000";

  const url = new URL("/api/comparison/", backendUrl);
  url.search = request.nextUrl.search;

  try {
    const response = await fetch(url, {
      cache: "no-store",
    });

    const data = await response.json();

    return NextResponse.json(data, {
      status: response.status,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not connect to the Django backend." },
      { status: 502 }
    );
  }
}
