import { detailsService, jsonResult } from "@/lib/details/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string; commit: string }> }) {
  return jsonResult(async () => { const { id, commit } = await context.params; return detailsService().read(id, commit); });
}
