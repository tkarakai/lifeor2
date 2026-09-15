"use client";

import { ConvexReactClient } from "convex/react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { authClient } from "./auth-client";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  console.warn("NEXT_PUBLIC_CONVEX_URL is not set. Follow QUICKSTART.md to configure the local backend.");
}

const convex = new ConvexReactClient(convexUrl || "https://placeholder.convex.cloud");

export function ConvexClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!convexUrl) {
    return (
      <div style={{ padding: "2rem", fontFamily: "system-ui" }}>
        <h1>Convex Setup Required</h1>
        <p>To use this app, you need to set up Convex:</p>
        <ol>
          <li>Follow <code>QUICKSTART.md</code> to copy your saved database and configure this project</li>
          <li>Run <code>bun run convex:dev</code> in a separate terminal</li>
          <li>Restart your dev server</li>
        </ol>
      </div>
    );
  }

  return (
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      {children}
    </ConvexBetterAuthProvider>
  );
}
