import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    // Keep CI and local unit runs deterministic on constrained hosts.
    maxWorkers: 1,
    coverage: {
      // Measured floors from the full `npm test` unit suite (2026-09-06).
      // Coverage is opt-in (`vitest --coverage`) and uses the V8 provider.
      provider: "v8",
      thresholds: {
        lines: 60,
        functions: 45,
        branches: 45,
        statements: 55,
        // Reliability-critical modules carry their own floors so a regression in
        // cancellation, coalescing, or proxy configuration cannot hide behind the
        // repository-wide average.
        "**/proxy.ts": {
          lines: 100,
          functions: 100,
          branches: 85,
          statements: 100,
        },
        "**/components/match-rooms/MatchRoomView.tsx": {
          lines: 86,
          functions: 34,
          branches: 40,
          statements: 58,
        },
        "**/components/notifications/NotificationBell.tsx": {
          lines: 78,
          functions: 72,
          branches: 52,
          statements: 70,
        },
      },
      reportsDirectory: "./node_modules/.cache/vitest-coverage",
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname),
    },
  },
});
