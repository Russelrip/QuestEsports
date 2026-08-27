import { afterEach, describe, expect, it } from "vitest";
import {
  buildApiUrl,
  fetchWithTimeout,
  parseApiResponse,
  readApiResponse,
  withServerOriginHeader,
} from "../../lib/api";

const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;
const originalInternalApiUrl = process.env.INTERNAL_API_URL;

afterEach(() => {
  if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  if (originalInternalApiUrl === undefined) delete process.env.INTERNAL_API_URL;
  else process.env.INTERNAL_API_URL = originalInternalApiUrl;
});

describe("API helpers", () => {
  it("prefixes relative API paths and preserves absolute resources", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";
    expect(buildApiUrl("/api/health")).toBe("https://api.example.com/api/health");
    expect(buildApiUrl("https://cdn.example.com/image.png")).toBe(
      "https://cdn.example.com/image.png"
    );
  });

  it("normalizes configured trailing slashes with URL parsing", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com///";

    expect(buildApiUrl("/api/health")).toBe("https://api.example.com/api/health");
  });

  it("uses the internal origin for SSR event-album and health requests", () => {
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    try {
      Object.defineProperty(globalThis, "window", { value: undefined, configurable: true });
      process.env.INTERNAL_API_URL = "http://backend:5001";
      delete process.env.NEXT_PUBLIC_API_URL;

      expect(buildApiUrl("/api/event-albums/quest-finals-2026")).toBe(
        "http://backend:5001/api/event-albums/quest-finals-2026"
      );
      expect(buildApiUrl("/api/health/ready")).toBe("http://backend:5001/api/health/ready");
    } finally {
      if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
      else delete (globalThis as { window?: unknown }).window;
    }
  });

  it("does not use malformed configured API values as URL prefixes", () => {
    for (const configuredApiUrl of [
      "https://api.example.com/base",
      "https://api.example.com?query=1",
      "https://api.example.com#fragment",
      "ftp://api.example.com",
    ]) {
      process.env.NEXT_PUBLIC_API_URL = configuredApiUrl;
      expect(buildApiUrl("/api/health")).toBe("/api/health");
    }
  });

  it("does not expose HTML error pages as user-facing messages", async () => {
    const response = new Response("<html>gateway error</html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });
    await expect(readApiResponse(response, "Service unavailable.")).resolves.toMatchObject({
      success: false,
      message: "Service unavailable.",
    });
  });

  it("maps unsuccessful JSON envelopes to typed request errors", async () => {
    const response = new Response(JSON.stringify({ success: false, message: "Denied." }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
    await expect(parseApiResponse(response)).rejects.toMatchObject({
      name: "ApiRequestError",
      status: 403,
      message: "Denied.",
    });
  });

  it("turns request timeouts into a stable API error", async () => {
    const neverCompletes = new Promise<Response>((_resolve, reject) => {
      globalThis.setTimeout(() => reject(new DOMException("aborted", "AbortError")), 25);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => neverCompletes;
    try {
      await expect(fetchWithTimeout("https://api.example.com", {}, 1)).rejects.toEqual(
        expect.objectContaining({ status: 408 })
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("accepts short plain-text errors but rejects unsafe markup", async () => {
    await expect(
      readApiResponse(
        new Response("Temporarily unavailable", {
          status: 503,
          headers: { "content-type": "text/plain" },
        })
      )
    ).resolves.toMatchObject({ message: "Temporarily unavailable" });
    await expect(
      readApiResponse(
        new Response("<script>alert(1)</script>", {
          status: 500,
          headers: { "content-type": "text/plain" },
        }),
        "Safe fallback"
      )
    ).resolves.toMatchObject({ message: "Safe fallback" });
  });

  it("preserves an explicitly supplied server origin header", () => {
    const headers = withServerOriginHeader({ Origin: "https://explicit.example" });
    expect(headers.get("Origin")).toBe("https://explicit.example");
  });
});
