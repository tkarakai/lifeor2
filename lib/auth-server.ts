import { convexBetterAuthNextJs } from "@convex-dev/better-auth/nextjs";

const convexAuth = convexBetterAuthNextJs({
  convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL!,
  convexSiteUrl: process.env.NEXT_PUBLIC_CONVEX_SITE_URL!,
});

export const GET = convexAuth.handler.GET;
export const POST = convexAuth.handler.POST;
