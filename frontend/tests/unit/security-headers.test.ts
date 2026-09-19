import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

describe("Permissions-Policy", () => {
  it("lets our own pages ask for the camera, for the admin ticket scanner", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const policies = rules.flatMap((rule) =>
      rule.headers
        .filter((header) => header.key === "Permissions-Policy")
        .map((header) => ({ source: rule.source, value: header.value })),
    );

    // One site-wide value: the policy is fixed when a document loads, so a
    // per-route override would not survive client-side navigation to
    // /admin/tickets. Microphone and location stay off everywhere.
    expect(policies).toEqual([
      { source: "/:path*", value: "camera=(self), microphone=(), geolocation=()" },
    ]);
  });
});
