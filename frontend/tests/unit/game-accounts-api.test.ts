import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiFetchJson: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  apiFetchJson: mocks.apiFetchJson,
  getApiErrorMessage: () => "",
}));

import { linkValorantAccount, resolveValorantAccount } from "../../lib/game-accounts";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.apiFetchJson.mockResolvedValue({
    response: { ok: true },
    data: { data: { game: "valorant", username: "QT Russel", tagline: "Senu" } },
  });
});

describe("game account requests reach the server as JSON", () => {
  // apiFetch only sets Content-Type: application/json when the `json` option is
  // used. Passing a raw `body` sends the bytes but no header, so Express never
  // parses it and the handler sees an empty body — which surfaced as "Invalid
  // Riot ID" for every input, no matter how valid.
  it("resolve sends a json payload, not a raw body", async () => {
    await resolveValorantAccount("QT Russel#Senu");
    const [, options] = mocks.apiFetchJson.mock.calls[0];
    expect(options.json).toEqual({ riotId: "QT Russel#Senu" });
    expect(options.body).toBeUndefined();
  });

  it("link sends a json payload, not a raw body", async () => {
    await linkValorantAccount("QT Russel#Senu");
    const [, options] = mocks.apiFetchJson.mock.calls[0];
    expect(options.json).toEqual({ riotId: "QT Russel#Senu" });
    expect(options.body).toBeUndefined();
  });

  it("posts to the expected endpoints", async () => {
    await resolveValorantAccount("Russel#1234");
    expect(mocks.apiFetchJson.mock.calls[0][0]).toBe("/api/v1/game-accounts/valorant/resolve");
    expect(mocks.apiFetchJson.mock.calls[0][1].method).toBe("POST");

    vi.clearAllMocks();
    mocks.apiFetchJson.mockResolvedValue({ response: { ok: true }, data: { data: { id: "a" } } });
    await linkValorantAccount("Russel#1234");
    expect(mocks.apiFetchJson.mock.calls[0][0]).toBe("/api/v1/game-accounts/valorant/link");
    expect(mocks.apiFetchJson.mock.calls[0][1].method).toBe("POST");
  });

  it("a name containing spaces survives to the request untouched", async () => {
    await resolveValorantAccount("QT Russel#Senu");
    expect(mocks.apiFetchJson.mock.calls[0][1].json.riotId).toBe("QT Russel#Senu");
  });
});
