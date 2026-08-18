import { describe, expect, it } from "vitest";
import { supportComposerSchema } from "../../components/support/SupportComposer";
import { statusLabel, statusTone } from "../../components/support/SupportConversationList";

describe("support inbox UI contracts", () => {
  it("requires a subject when sending a new conversation", () => {
    const result = supportComposerSchema.safeParse({ subject: "", body: "I need help with my registration." });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe("Subject is required.");
  });

  it("renders grounded labels for unread conversation statuses", () => {
    expect(statusLabel.PENDING_STAFF).toBe("With support");
    expect(statusLabel.PENDING_USER).toBe("Your reply");
    expect(statusTone.RESOLVED).toContain("slate");
  });

  it("validates message length and accepts a complete message", () => {
    expect(supportComposerSchema.safeParse({ subject: "Login issue", body: "The details of my issue are here." }).success).toBe(true);
    expect(supportComposerSchema.safeParse({ subject: "Login issue", body: "" }).success).toBe(false);
    expect(supportComposerSchema.safeParse({ subject: "x".repeat(161), body: "Details" }).success).toBe(false);
  });
});
