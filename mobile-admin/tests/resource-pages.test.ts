import { describe, expect, it } from "vitest";
import { hasNextResourcePage, mergeUniqueResourcePage } from "../src/resource-pages";

describe("resource page helpers", () => {
  it("appends unseen records and removes duplicate IDs", () => {
    expect(
      mergeUniqueResourcePage(
        [{ id: "one", value: 1 }],
        [{ id: "one", value: 9 }, { id: "two", value: 2 }, { id: "two", value: 3 }]
      )
    ).toEqual([{ id: "one", value: 1 }, { id: "two", value: 2 }]);
  });

  it("reports whether another server page is available", () => {
    expect(hasNextResourcePage(null)).toBe(false);
    expect(hasNextResourcePage({ page: 1, pageSize: 50, total: 51, totalPages: 2 })).toBe(true);
    expect(hasNextResourcePage({ page: 2, pageSize: 50, total: 51, totalPages: 2 })).toBe(false);
  });
});
