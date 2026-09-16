import { detailsService, jsonResult, saveBody } from "@/lib/details/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return jsonResult(async () => detailsService(request.headers.get("x-lifeor-dataset")).read((await context.params).id));
}
export async function PUT(request: Request, context: Context) {
  return jsonResult(async () => {
    const body = await saveBody(request);
    return detailsService(request.headers.get("x-lifeor-dataset")).save((await context.params).id, body.source, body.expectedCommit);
  });
}
