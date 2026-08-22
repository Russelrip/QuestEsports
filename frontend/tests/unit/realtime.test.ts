import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("realtime subscriptions", () => {
  it("does not create EventSource when production realtime is disabled", async () => {
    const eventSource = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      realtime: { enabled: false },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("EventSource", eventSource);

    const { subscribeToRealtimeUpdates } = await import("../../lib/realtime");
    const close = subscribeToRealtimeUpdates("user:test", vi.fn());
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(eventSource).not.toHaveBeenCalled();
    close();
  });

  it("opens and closes EventSource when realtime is enabled", async () => {
    const close = vi.fn();
    const listeners = new Map<string, () => void>();
    const addEventListener = vi.fn((event: string, listener: EventListener) => {
      listeners.set(event, listener as () => void);
    });
    const eventSource = vi.fn(function MockEventSource() {
      return { addEventListener, close };
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      realtime: { enabled: true },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("EventSource", eventSource);

    const { subscribeToRealtimeUpdates } = await import("../../lib/realtime");
    const onUpdate = vi.fn();
    const unsubscribe = subscribeToRealtimeUpdates("matches", onUpdate);
    await vi.waitFor(() => expect(eventSource).toHaveBeenCalledOnce());
    expect(addEventListener).toHaveBeenCalledWith("ready", onUpdate);
    expect(addEventListener).toHaveBeenCalledWith("update", onUpdate);
    listeners.get("ready")?.();
    listeners.get("update")?.();
    expect(onUpdate).toHaveBeenCalledTimes(2);
    unsubscribe();
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not open EventSource when unsubscribed before the health request resolves", async () => {
    let resolveHealth!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => {
      resolveHealth = resolve;
    })));
    vi.stubGlobal("EventSource", vi.fn());

    const { subscribeToRealtimeUpdates } = await import("../../lib/realtime");
    const unsubscribe = subscribeToRealtimeUpdates("matches", vi.fn());
    unsubscribe();
    resolveHealth(new Response(JSON.stringify({
      success: true,
      realtime: { enabled: true },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await Promise.resolve();
    await Promise.resolve();

    expect(EventSource).not.toHaveBeenCalled();
  });
});
