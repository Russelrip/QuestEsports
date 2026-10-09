import { headers } from "next/headers";
import {
  CLOUDFLARE_BEACON_SCRIPT_URL,
  readWebAnalyticsToken,
} from "@/lib/web-analytics";

// The site CSP uses a per-request nonce with 'strict-dynamic', so a script
// Cloudflare injects at the edge would be blocked. The beacon is rendered here
// with the request's nonce instead; proxy.ts adds its report origin to
// connect-src under the same token check.
export default async function WebAnalytics() {
  const token = readWebAnalyticsToken();
  if (!token) return null;

  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <script
      defer
      src={CLOUDFLARE_BEACON_SCRIPT_URL}
      data-cf-beacon={JSON.stringify({ token })}
      nonce={nonce}
    />
  );
}
