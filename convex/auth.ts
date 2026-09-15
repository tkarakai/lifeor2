import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { components } from "./_generated/api";
import { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { betterAuth } from "better-auth/minimal";
import { magicLink } from "better-auth/plugins";
import authConfig from "./auth.config";

const siteUrl = process.env.SITE_URL!;

// The component client has methods needed for integrating Convex with Better Auth
export const authComponent = createClient<DataModel>(components.betterAuth);

// Mock email sender for local development
async function sendEmail(to: string, subject: string, text: string, html: string) {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📧 MOCK EMAIL SENT (from Convex)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`To: ${to}`);
  console.log(`Subject: ${subject}`);
  console.log("─────────────────────────────────────────────────────");
  console.log("\nText Content:");
  console.log(text);
  if (html) {
    console.log("\nHTML Content:");
    console.log(html);
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

export function createAuth(ctx: GenericCtx<DataModel>) {
  return betterAuth({
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: false, // Disabled in favor of magic link
    },
    plugins: [
      // The Convex plugin is required for Convex compatibility
      convex({ authConfig }),
      magicLink({
        sendMagicLink: async ({ email, url, token }) => {
          await sendEmail(
            email,
            "Your login code for LifeOR2",
            `Your login code is: ${token}\n\nOr click this link to sign in: ${url}\n\nThis code will expire in 10 minutes.`,
            `
              <h1>Sign in to LifeOR2</h1>
              <p>Your login code is:</p>
              <h2 style="font-family: monospace; letter-spacing: 0.2em; font-size: 32px;">${token}</h2>
              <p>Or <a href="${url}">click here to sign in</a></p>
              <p style="color: #666; font-size: 14px;">This code will expire in 10 minutes.</p>
            `
          );
        },
        expiresIn: 600, // 10 minutes
      }),
    ],
  });
}

// Get the current authenticated user
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return authComponent.getAuthUser(ctx);
  },
});
