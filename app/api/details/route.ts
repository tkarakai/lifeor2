import { detailsService, jsonResult, parseTarget, saveBody } from "@/lib/details/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return jsonResult(() => {
    const params = new URL(request.url).searchParams;
    return detailsService(request.headers.get("x-lifeor-dataset")).forTarget(parseTarget({ kind: params.get("kind"), id: params.get("id") }));
  });
}
export async function POST(request: Request) {
  return jsonResult(async () => {
    const body = await saveBody(request);
    return detailsService(request.headers.get("x-lifeor-dataset")).saveTarget(parseTarget(body.target), body.source, body.expectedCommit);
  });
}
