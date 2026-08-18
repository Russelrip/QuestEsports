import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("match videos server rendering", () => {
  it("does not pass browser event handlers from the server component", () => {
    const component = readFileSync(
      resolve(process.cwd(), "components/match-videos/MatchVideosContent.tsx"),
      "utf8",
    );

    expect(component).not.toMatch(/<Image[\s\S]*onError=/);
  });
});
