import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { readSiteMaintenanceConfig } from "./lib/maintenance";

const isProduction = process.env.NODE_ENV === "production";
const allowInsecureLoopbackUrls = process.env.ALLOW_INSECURE_LOOPBACK_URLS === "true";

export function proxy(request: NextRequest) {
  const maintenance = readSiteMaintenanceConfig();
  const nonce = Buffer.from(randomUUID()).toString("base64");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  const apiOrigin = apiUrl ? new URL(apiUrl).origin : null;
  const connectSources = ["'self'", ...(apiOrigin ? [apiOrigin] : [])];
  const imageSources = [
    "'self'",
    "data:",
    "blob:",
    "https://img.youtube.com",
    ...(apiOrigin ? [apiOrigin] : []),
  ];
  const policy = [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "frame-src 'self' https://challonge.com https://*.challonge.com",
    `img-src ${imageSources.join(" ")}`,
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connectSources.join(" ")}`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProduction ? "" : " 'unsafe-eval'"}`,
    "form-action 'self' https://sandbox.payhere.lk https://www.payhere.lk",
    ...(isProduction && !allowInsecureLoopbackUrls ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response =
    maintenance.enabled && request.nextUrl.pathname !== "/maintenance"
      ? NextResponse.rewrite(new URL("/maintenance", request.url), {
          status: 503,
          request: { headers: requestHeaders },
        })
      : NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  if (maintenance.enabled) {
    response.headers.set("Retry-After", String(maintenance.retryAfterSeconds));
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    response.headers.set("X-Maintenance-Mode", "active");
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
