import { describe, expect, it } from "vitest";
import { GET } from "../../app/health/route";

describe("GET /health", () => {
  it("returns an OK JSON health response", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
