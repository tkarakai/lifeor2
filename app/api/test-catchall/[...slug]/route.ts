import { NextResponse } from "next/server";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  return NextResponse.json({ message: "Catch-all works", slug });
}
