import { detailsService, jsonResult } from "@/lib/details/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return jsonResult(async () => detailsService(request.headers.get("x-lifeor-dataset")).history((await context.params).id));
}
