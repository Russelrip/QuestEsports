import { afterEach, describe, expect, it } from "vitest";
import {
  ApiRequestError,
  buildApiUrl,
  fetchWithTimeout,
  parseApiResponse,
  readApiResponse,
} from "../../lib/api";

const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

afterEach(() => {
  if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
});

describe("API helpers", () => {
  it("prefixes relative API paths and preserves absolute resources", () => {
    process.env.NEXT_PUBLIC_API_URL = "https://api.example.com";
    expect(buildApiUrl("/api/health")).toBe("https://api.example.com/api/health");
    expect(buildApiUrl("https://cdn.example.com/image.png")).toBe(
      "https://cdn.example.com/image.png"
    );
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
        expect.objectContaining<ApiRequestError>({ status: 408 })
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
