import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

type WorkerEvent = {
  notification: { data?: { url?: unknown }; close: () => void };
  waitUntil: (promise: Promise<unknown>) => void;
};

type WorkerListener = (event: WorkerEvent) => void;

const source = readFileSync(resolve(process.cwd(), "public/quest-sw.js"), "utf8");

const loadNotificationClickHandler = () => {
  const listeners = new Map<string, WorkerListener>();
  const self = {
    location: { origin: "https://questesports.lk" },
    addEventListener: (type: string, listener: WorkerListener) => listeners.set(type, listener),
  };
  const openWindow = vi.fn();
  const matchAll = vi.fn().mockResolvedValue([]);

  runInNewContext(source, { URL, clients: { matchAll, openWindow }, self });

  return { handler: listeners.get("notificationclick")!, matchAll, openWindow };
};

describe("service-worker notification navigation", () => {
  let handler: WorkerListener;
  let matchAll: ReturnType<typeof vi.fn>;
  let openWindow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ handler, matchAll, openWindow } = loadNotificationClickHandler());
  });

  it.each([
    ["/match-room/abc", "https://questesports.lk/match-room/abc"],
    ["https://attacker.example/steal", null],
    ["//attacker.example/steal", null],
    ["javascript:alert(1)", null],
  ])("only opens a same-origin path for %s", async (notificationUrl, expectedUrl) => {
    const close = vi.fn();
    const waitUntil = vi.fn();
    handler({ notification: { data: { url: notificationUrl }, close }, waitUntil });

    expect(close).toHaveBeenCalledOnce();
    if (expectedUrl) {
      expect(waitUntil).toHaveBeenCalledOnce();
      await waitUntil.mock.calls[0][0];
      expect(matchAll).toHaveBeenCalledOnce();
      expect(openWindow).toHaveBeenCalledWith(expectedUrl);
    } else {
      expect(waitUntil).not.toHaveBeenCalled();
      expect(matchAll).not.toHaveBeenCalled();
      expect(openWindow).not.toHaveBeenCalled();
    }
  });
});
