import { detailsService, jsonResult } from "@/lib/details/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return jsonResult(async () => detailsService().history((await context.params).id));
}
