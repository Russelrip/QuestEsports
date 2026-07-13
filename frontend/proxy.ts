import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

const isProduction = process.env.NODE_ENV === "production";

export function proxy(request: NextRequest) {
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
    `img-src ${imageSources.join(" ")}`,
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${connectSources.join(" ")}`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProduction ? "" : " 'unsafe-eval'"}`,
    "form-action 'self' https://sandbox.payhere.lk https://www.payhere.lk",
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
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
