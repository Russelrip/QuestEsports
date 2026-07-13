import type { NextConfig } from "next";

const apiUrl = process.env.NEXT_PUBLIC_API_URL;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const isProduction = process.env.NODE_ENV === "production";
if (isProduction && (!apiUrl || !siteUrl)) {
  throw new Error(
    "NEXT_PUBLIC_API_URL and NEXT_PUBLIC_SITE_URL are required for production builds."
  );
}
const apiUsesLocalNetwork = apiUrl
  ? ["localhost", "127.0.0.1", "::1"].includes(new URL(apiUrl).hostname)
  : false;
const apiRemotePattern = apiUrl
  ? (() => {
      const parsed = new URL(apiUrl);
      return {
        protocol: parsed.protocol.replace(":", "") as "http" | "https",
        hostname: parsed.hostname,
        port: parsed.port,
      };
    })()
  : null;

const nextConfig: NextConfig = {
  images: {
    dangerouslyAllowLocalIP: !isProduction || apiUsesLocalNetwork,
    minimumCacheTTL: 3600,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.youtube.com",
      },
      ...(apiRemotePattern ? [apiRemotePattern] : []),
    ],
  },
  async headers() {
    const securityHeaders = [
      {
        key: "X-Frame-Options",
        value: "DENY",
      },
      {
        key: "Referrer-Policy",
        value: "strict-origin-when-cross-origin",
      },
      {
        key: "X-Content-Type-Options",
        value: "nosniff",
      },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
      ...(isProduction
        ? [
            {
              key: "Strict-Transport-Security",
              value: "max-age=31536000; includeSubDomains",
            },
          ]
        : []),
    ];

    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
