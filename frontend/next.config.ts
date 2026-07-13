import type { NextConfig } from "next";

const apiUrl = process.env.NEXT_PUBLIC_API_URL;
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const apiOrigin = apiUrl ? new URL(apiUrl).origin : null;
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

const connectSources = ["'self'"];
if (apiUrl) {
  connectSources.push(apiOrigin || apiUrl);
}

const imageSources = ["'self'", "data:", "blob:", "https://img.youtube.com"];
if (apiOrigin) {
  imageSources.push(apiOrigin);
}

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  `img-src ${imageSources.join(" ")}`,
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  `connect-src ${connectSources.join(" ")}`,
  isProduction
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "form-action 'self' https://sandbox.payhere.lk https://www.payhere.lk",
  ...(isProduction ? ["upgrade-insecure-requests"] : []),
].join("; ");

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
        key: "Content-Security-Policy",
        value: contentSecurityPolicy,
      },
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
