import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";
import { makeFunctionReference } from "convex/server";
import { detailsService, jsonResult } from "@/lib/details/server";
import { DetailsError, type DetailsTarget } from "@/lib/details/types";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  return jsonResult(async () => {
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== new URL(request.url).origin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      throw new DetailsError(
        "cross_origin",
        "Cross-origin writes are not allowed.",
        403,
      );
    const datasetId = request.headers.get("x-lifeor-dataset");
    if (!datasetId)
      throw new DetailsError("invalid_target", "Choose a sample dataset.");
    const auth = convexBetterAuthNextJs({
      convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL!,
      convexSiteUrl: process.env.NEXT_PUBLIC_CONVEX_SITE_URL!,
    });
    const documents = await auth.fetchAuthQuery(
      makeFunctionReference<
        "query",
        { datasetId: string },
        { target: DetailsTarget; source: string }[]
      >("sampleData:documents"),
      { datasetId },
    );
    const service = detailsService(datasetId);
    let saved = 0;
    for (const document of documents) {
      const existing = await service.forTarget(document.target);
      // Retrying never overwrites an edited sample document.
      if (existing.availability !== "missing") continue;
      await service.saveTarget(
        document.target,
        document.source,
        existing.commit,
      );
      saved++;
    }
    return { saved };
  });
}
