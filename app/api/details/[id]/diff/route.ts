import { detailsService, jsonResult } from "@/lib/details/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return jsonResult(async () => {
    const params = new URL(request.url).searchParams;
    return detailsService(request.headers.get("x-lifeor-dataset")).diff((await context.params).id, params.get("from") ?? "", params.get("to") ?? "");
  });
}
