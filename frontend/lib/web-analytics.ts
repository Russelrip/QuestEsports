// Cloudflare Web Analytics: cookieless page-view counting through Cloudflare's
// beacon. Off unless CLOUDFLARE_WEB_ANALYTICS_TOKEN is set, so local, staging
// and preview builds report nothing.
//
// The token is read at runtime (not NEXT_PUBLIC_), so production can enable it
// from /etc/quest-esports/quest.frontend.env without rebuilding the image. It is
// not a secret -- it ships in every page -- but it is still validated, because
// it is interpolated into a script attribute. A malformed token disables
// analytics rather than throwing: this is read on every request, and a typo in
// an optional counter must not take the site down.

export const CLOUDFLARE_BEACON_SCRIPT_URL =
  "https://static.cloudflareinsights.com/beacon.min.js";
// Where the beacon reports when the script is installed manually rather than
// injected at Cloudflare's edge.
export const CLOUDFLARE_BEACON_REPORT_ORIGIN = "https://cloudflareinsights.com";

type Environment = Record<string, string | undefined>;

let warnedAboutInvalidToken = false;

export function readWebAnalyticsToken(
  environment: Environment = process.env
): string | null {
  const token = String(environment.CLOUDFLARE_WEB_ANALYTICS_TOKEN ?? "").trim();
  if (!token) return null;
  if (!/^[0-9a-f]{32}$/i.test(token)) {
    if (!warnedAboutInvalidToken) {
      warnedAboutInvalidToken = true;
      console.warn(
        "CLOUDFLARE_WEB_ANALYTICS_TOKEN is not the 32-character hex token from the Cloudflare Web Analytics snippet; analytics is disabled."
      );
    }
    return null;
  }
  return token;
}
