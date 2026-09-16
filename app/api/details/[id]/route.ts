import { detailsService, jsonResult, saveBody } from "@/lib/details/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  return jsonResult(async () => detailsService().read((await context.params).id));
}
export async function PUT(request: Request, context: Context) {
  return jsonResult(async () => {
    const body = await saveBody(request);
    return detailsService().save((await context.params).id, body.source, body.expectedCommit);
  });
}
