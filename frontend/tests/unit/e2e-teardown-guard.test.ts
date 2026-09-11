import { afterEach, describe, expect, it, vi } from "vitest";
import globalTeardown from "../e2e/global-teardown";

type Recorded = { method: string; url: string };

const withRecorded = (unexpectedRequests: Recorded[]) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ success: true, unexpectedRequests }) })),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.PLAYWRIGHT_SKIP_WEBSERVER;
});

describe("e2e mock API guard", () => {
  it("passes when the mock API saw nothing unhandled", async () => {
    withRecorded([]);
    await expect(globalTeardown()).resolves.toBeUndefined();
  });

  it("fails on an endpoint no spec mocks, which is a real gap in coverage", async () => {
    withRecorded([{ method: "GET", url: "/api/v1/secret-thing" }]);
    await expect(globalTeardown()).rejects.toThrow("Unexpected mock API requests: GET /api/v1/secret-thing");
  });

  it("tolerates a veto room request, which a spec routes itself and can release while closing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    withRecorded([{ method: "GET", url: "/api/v1/veto-rooms/ALPHAB" }]);

    await expect(globalTeardown()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("GET /api/v1/veto-rooms/ALPHAB"));
  });

  it("tolerates a support conversation request released during teardown", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    withRecorded([{ method: "GET", url: "/api/v1/support/conversations" }]);

    await expect(globalTeardown()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("GET /api/v1/support/conversations"));
  });

  it("still fails on a real gap even when an escaped request is recorded alongside it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    withRecorded([
      { method: "GET", url: "/api/v1/veto-rooms/ALPHAB" },
      { method: "POST", url: "/api/v1/other" },
    ]);

    await expect(globalTeardown()).rejects.toThrow("Unexpected mock API requests: POST /api/v1/other");
  });

  it("does not treat an unrelated path that merely mentions veto-rooms as escaped", async () => {
    withRecorded([{ method: "GET", url: "/api/v1/admin/veto-rooms" }]);
    await expect(globalTeardown()).rejects.toThrow("Unexpected mock API requests: GET /api/v1/admin/veto-rooms");
  });
});
