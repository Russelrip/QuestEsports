import { afterEach, describe, expect, it } from "vitest";
import { resolveImageUrl, resolveMediaUrl } from "../../lib/media";

const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

afterEach(() => {
  if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
});

describe("resolveImageUrl", () => {
  it("rejects empty, whitespace-only, nullish, and non-string values", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";

    expect(resolveImageUrl(null)).toBeNull();
    expect(resolveImageUrl(undefined)).toBeNull();
    expect(resolveImageUrl("")).toBeNull();
    expect(resolveImageUrl("   ")).toBeNull();
    expect(resolveImageUrl({ url: "/uploads/team-logos/a.png" })).toBeNull();
    expect(resolveImageUrl(["/uploads/team-logos/a.png"])).toBeNull();
  });

  it("preserves absolute HTTP, HTTPS, data, and blob URLs", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";

    expect(resolveImageUrl("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
    expect(resolveImageUrl("http://cdn.example.com/a.png")).toBe("http://cdn.example.com/a.png");
    expect(resolveImageUrl("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
    expect(resolveImageUrl("blob:https://example.com/id")).toBe("blob:https://example.com/id");
  });

  it("rejects malformed absolute URL values", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";

    expect(resolveImageUrl("http:")).toBeNull();
    expect(resolveImageUrl("https:")).toBeNull();
    expect(resolveImageUrl("data:")).toBeNull();
    expect(resolveImageUrl("blob:")).toBeNull();
    expect(resolveImageUrl("https://")).toBeNull();
  });

  it("normalizes public upload paths from all supported public forms", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";

    expect(resolveImageUrl("/api/uploads/team-logos/a.png")).toBe(
      "https://api.example.com/api/uploads/team-logos/a.png",
    );
    expect(resolveImageUrl("/uploads/team-logos/a.png")).toBe(
      "https://api.example.com/api/uploads/team-logos/a.png",
    );
    expect(resolveImageUrl("uploads/team-logos/a.png")).toBe(
      "https://api.example.com/api/uploads/team-logos/a.png",
    );
    expect(resolveImageUrl("a.png", { directory: "team-logos" })).toBe(
      "https://api.example.com/api/uploads/team-logos/a.png",
    );
    expect(resolveImageUrl("/srv/quest-esports/uploads/team-logos/a.png")).toBe(
      "https://api.example.com/api/uploads/team-logos/a.png",
    );
  });

  it("collapses duplicate upload slashes and avoids duplicate API separators", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com///";

    expect(resolveImageUrl("//uploads///team-logos//a.png")).toBe(
      "https://api.example.com/api/uploads/team-logos/a.png",
    );
  });

  it("uses one separator for a configured trailing-slash API origin", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com/";

    expect(resolveImageUrl("/api/uploads/team-logos/a.png")).toBe(
      "https://api.example.com/api/uploads/team-logos/a.png",
    );
  });

  it("keeps API paths relative when the configured API value is malformed", () => {
    for (const configuredApiUrl of [
      "https://api.example.com/base",
      "https://api.example.com?query=1",
      "https://api.example.com#fragment",
      "ftp://api.example.com",
    ]) {
      process.env.NEXT_PUBLIC_API_URL = configuredApiUrl;
      expect(resolveImageUrl("/api/images")).toBe("/api/images");
      expect(resolveImageUrl("/uploads/team-logos/a.png")).toBe(
        "/api/uploads/team-logos/a.png",
      );
    }
  });

  it("does not double-prefix API paths or absolute API URLs", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";

    expect(resolveImageUrl("/api/uploads/team-logos/a.png")).not.toContain("/api/api/");
    expect(resolveImageUrl("https://api.example.com/api/uploads/team-logos/a.png")).toBe(
      "https://api.example.com/api/uploads/team-logos/a.png",
    );
  });

  it("rejects malformed, private, unsupported, and contaminated values", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";

    expect(resolveImageUrl("/uploads/private/a.png")).toBeNull();
    expect(resolveImageUrl("/api/uploads/avatars/../a.png")).toBeNull();
    expect(resolveImageUrl("/srv/quest-esports/uploads/private/a.png")).toBeNull();
    expect(resolveImageUrl("/srv/quest-esports/data/a.png")).toBeNull();
    expect(resolveImageUrl("C:\\private\\image.png")).toBeNull();
    expect(resolveImageUrl("/Users/example/image.png")).toBeNull();
    expect(resolveImageUrl("/Volumes/archive/image.png")).toBeNull();
    expect(resolveImageUrl("/Library/image.png")).toBeNull();
    expect(resolveImageUrl("undefined")).toBeNull();
    expect(resolveImageUrl("null")).toBeNull();
    expect(resolveImageUrl("[object Object]")).toBeNull();
    expect(resolveImageUrl("/uploads/team-logos/undefined.png")).toBeNull();
  });

  it("keeps relative public paths relative when API configuration is absent", () => {
    delete process.env.NEXT_PUBLIC_API_URL;

    expect(resolveImageUrl("/images/a.png")).toBe("/images/a.png");
    expect(resolveImageUrl("/api/uploads/team-logos/a.png")).toBe(
      "/api/uploads/team-logos/a.png",
    );
    expect(resolveImageUrl("https://cdn.example.com/a.png")).toBe(
      "https://cdn.example.com/a.png",
    );
  });

  it("preserves static local paths when API configuration is present", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";

    expect(resolveImageUrl("/images/a.png")).toBe("/images/a.png");
    expect(resolveImageUrl("/icons/quest.svg")).toBe("/icons/quest.svg");
    expect(resolveImageUrl("/api/images")).toBe("https://api.example.com/api/images");
  });

  it("keeps the compatibility resolver exported and delegated", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";

    expect(resolveMediaUrl("/uploads/team-logos/a.png")).toBe(
      resolveImageUrl("/uploads/team-logos/a.png"),
    );
  });
});
