"use client";

import { usePathname } from "next/navigation";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

const CAPABILITY_ROUTE_PATTERN = /^\/shop\/order(?:\/|$)/i;

const redactCapabilityUrl = <T extends { url: string }>(event: T): T => ({
  ...event,
  url: event.url.replace(/(\/shop\/order\/)[^/?#]+/i, "$1[REDACTED]"),
});

export default function Telemetry({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();

  // Order status URLs contain a bearer capability. Do not initialize either
  // browser telemetry client on those pages.
  if (!enabled || CAPABILITY_ROUTE_PATTERN.test(pathname)) {
    return null;
  }

  return (
    <>
      <Analytics beforeSend={redactCapabilityUrl} />
      <SpeedInsights />
    </>
  );
}
