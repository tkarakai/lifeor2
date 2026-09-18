import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    const consentHeaders = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
    ];
    return [
      { source: "/oauth/:path*", headers: consentHeaders },
      { source: "/dashboard/agents", headers: consentHeaders },
    ];
  },
};

export default nextConfig;
