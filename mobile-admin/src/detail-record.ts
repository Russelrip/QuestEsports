const DETAIL_FIELDS = [
  "id", "name", "title", "subject", "description", "slug", "status", "role", "type", "kind",
  "firstName", "lastName", "fullName", "username", "email", "phone", "discord", "discordTag",
  "teamName", "teamTag", "organizationName", "captainName", "applicationType", "game", "playerId",
  "currentRosterSize", "womensLeagueInterest", "isRead", "isPublished", "emailVerified", "memberCount",
  "entryType", "paymentStatus", "verificationStatus", "purpose", "provider", "method", "currency",
  "amount", "subtotal", "deliveryFee", "total", "category", "vendor", "notes", "expenseDate",
  "createdAt", "updatedAt", "lastLoginAt", "expiresAt", "lastSeenAt", "registrationDeadline", "startDate",
  "prizePool", "paymentMethod", "registrationCount", "capacityUsed", "maxTeams", "price", "stockQuantity",
  "tournament", "captain", "customerName", "customerEmail", "orderId", "paymentId", "items", "productName",
  "quantity", "unitPrice", "lineTotal", "selectedSize", "selectedColor", "members", "member", "details",
  "message", "messages", "sender", "openedBy", "createdBy", "user", "team", "participants", "displayName",
  "slot", "ready", "joined", "accentColor", "maps", "mapSlug", "mapName", "artworkUrl", "available",
  "steps", "currentStep", "currentAction", "actions", "sequence", "actor", "actorSlot", "seriesIndex", "side",
  "payload", "toss", "timer", "seconds", "deadline", "callerSlot", "call", "result", "winnerSlot", "teamASlot",
  "format", "code", "controlMode", "teamOrderMethod", "chatLocked", "messageCount", "openSupportCount", "station",
] as const;

export const DETAIL_FIELD_ALLOWLIST: ReadonlySet<string> = new Set(DETAIL_FIELDS);

/**
 * Generic admin details are intentionally allowlisted. This prevents new API
 * fields (especially bearer-like values such as publicToken) from becoming
 * visible merely because the API started returning them.
 */
export function sanitizeDetailRecord(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string> = DETAIL_FIELD_ALLOWLIST,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!allowedFields.has(key) || entry === undefined || entry === null || entry === "") continue;
    if (Array.isArray(entry)) {
      const sanitized = entry.flatMap((item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const child = sanitizeDetailRecord(item as Record<string, unknown>, allowedFields);
          return Object.keys(child).length ? [child] : [];
        }
        return [item];
      });
      if (sanitized.length) result[key] = sanitized;
    } else if (typeof entry === "object") {
      const child = sanitizeDetailRecord(entry as Record<string, unknown>, allowedFields);
      if (Object.keys(child).length) result[key] = child;
    } else {
      result[key] = entry;
    }
  }
  return result;
}
