import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveBlob } from "@/lib/download-filename";

describe("saveBlob", () => {
  const createObjectURL = vi.fn(() => "blob:quest/photo");
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom implements neither.
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  it("clicks a link to the blob under the requested name, then removes the link", () => {
    const click = vi.mocked(HTMLAnchorElement.prototype.click);
    saveBlob(new Blob(["x"]), "album-photo.jpg");

    const clicked = click.mock.contexts[0] as HTMLAnchorElement | undefined;
    expect(clicked?.href).toBe("blob:quest/photo");
    expect(clicked?.download).toBe("album-photo.jpg");
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("keeps the blob URL alive while the browser starts the download", () => {
    saveBlob(new Blob(["x"]), "album-photo.jpg");

    // Revoking in the same task can cancel the download in some browsers.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:quest/photo");
  });
});
