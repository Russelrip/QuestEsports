import type { NextConfig } from "next";
import { readSiteMaintenanceConfig } from "./lib/maintenance";

readSiteMaintenanceConfig();

const apiUrl = process.env.NEXT_PUBLIC_API_URL;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const isProduction = process.env.NODE_ENV === "production";
const allowInsecureLoopbackUrls =
  process.env.CI === "true" &&
  !process.env.VERCEL_ENV &&
  process.env.ALLOW_INSECURE_LOOPBACK_URLS === "true";
if (isProduction && (!apiUrl || !siteUrl)) {
  throw new Error(
    "NEXT_PUBLIC_API_URL and NEXT_PUBLIC_SITE_URL are required for production builds."
  );
}
const parsePublicOrigin = (name: string, value?: string) => {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${name} must use HTTP or HTTPS.`);
  }
  if (
    parsed.username ||
    parsed.password ||
    value !== parsed.origin
  ) {
    throw new Error(`${name} must be an origin without credentials, a path, a query, a fragment, or a trailing slash.`);
  }
  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (
    isProduction &&
    parsed.protocol !== "https:" &&
    !(isLoopback && allowInsecureLoopbackUrls)
  ) {
    throw new Error(`${name} must use HTTPS in production.`);
  }
  return parsed;
};
const parsedApiUrl = parsePublicOrigin("NEXT_PUBLIC_API_URL", apiUrl);
parsePublicOrigin("NEXT_PUBLIC_SITE_URL", siteUrl);
const apiUsesLocalNetwork = parsedApiUrl
  ? ["localhost", "127.0.0.1", "::1"].includes(parsedApiUrl.hostname)
  : false;
const apiRemotePattern = parsedApiUrl
  ? {
      protocol: parsedApiUrl.protocol.replace(":", "") as "http" | "https",
      hostname: parsedApiUrl.hostname,
      port: parsedApiUrl.port,
    }
  : null;

const nextConfig: NextConfig = {
  images: {
    dangerouslyAllowLocalIP:
      !isProduction || (allowInsecureLoopbackUrls && apiUsesLocalNetwork),
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
