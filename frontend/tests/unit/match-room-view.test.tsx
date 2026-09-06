import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MatchRoomView from "../../components/match-rooms/MatchRoomView";

const mocks = vi.hoisted(() => ({ request: vi.fn(), subscribe: vi.fn() }));

vi.mock("@/lib/match-rooms", () => ({ roomRequest: mocks.request }));
vi.mock("@/lib/realtime", () => ({ subscribeToRealtimeUpdates: mocks.subscribe }));
vi.mock("next/image", () => ({ default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <span role="img" aria-label={props.alt || "image"} /> }));
vi.mock("@/components/veto/VetoRoomView", () => ({ default: () => null }));

const room = {
  id: "room-1",
  code: "ROOM1",
  chatLocked: false,
  lastMessageAt: null,
  access: { role: "player", teamSlot: 1, mutedUntil: null },
  match: {
    id: "match-1",
    identifier: "match-1",
    status: "scheduled",
    scheduledAt: null,
    estimatedAt: null,
    station: null,
    tournament: { id: "tournament-1", slug: "cup", title: "Quest Cup", game: "VALORANT" },
    participants: [
      { id: "participant-1", slot: 1, registrationId: null, displayName: "Alpha", score: null, result: null, logoUrl: null },
      { id: "participant-2", slot: 2, registrationId: null, displayName: "Bravo", score: null, result: null, logoUrl: null },
    ],
    veto: null,
  },
  members: [],
};

const responseFor = (path: string) => path.endsWith("/messages") ? { items: [] } : path.endsWith("/support") ? [] : room;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.subscribe.mockReturnValue(vi.fn());
  mocks.request.mockImplementation((path: string) => Promise.resolve(responseFor(path)));
});

afterEach(() => cleanup());

describe("match room refresh reliability", () => {
  it("coalesces realtime refreshes and aborts the active refresh on unmount", async () => {
    let onUpdate!: () => void;
    mocks.subscribe.mockImplementation((_topic: string, callback: () => void) => {
      onUpdate = callback;
      return vi.fn();
    });
    const view = render(<MatchRoomView code="ROOM1" />);
    await screen.findByText("Alpha");
    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalled());
    mocks.request.mockClear();

    let release!: () => void;
    const pending = new Promise<unknown>((resolve) => { release = () => resolve(responseFor("/messages")); });
    mocks.request.mockImplementation((path: string, options?: { signal?: AbortSignal }) => {
      if (options?.signal?.aborted) return Promise.resolve(responseFor(path));
      if (path.endsWith("/messages")) return pending;
      return Promise.resolve(responseFor(path));
    });

    await act(async () => {
      onUpdate();
      onUpdate();
    });
    expect(mocks.request).toHaveBeenCalledTimes(3);
    const signal = mocks.request.mock.calls[0][1].signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    view.unmount();
    expect(signal.aborted).toBe(true);
    release();
  });
});

it("retains coalescing while siblings remain pending after one failure", async () => {
  let onUpdate!: () => void;
  mocks.subscribe.mockImplementation((_topic: string, callback: () => void) => { onUpdate = callback; return vi.fn(); });
  const view = render(<MatchRoomView code="ROOM1" />);
  await screen.findByText("Alpha");
  await waitFor(() => expect(mocks.subscribe).toHaveBeenCalled());
  await act(async () => {});
  mocks.request.mockClear();
  const pending = new Promise<unknown>(() => {});
  mocks.request.mockImplementation((path: string) => path.endsWith("/messages") ? Promise.reject(new Error("messages unavailable")) : pending);
  await act(async () => { onUpdate(); });
  expect(mocks.request).toHaveBeenCalledTimes(3);
  await act(async () => { onUpdate(); });
  view.unmount();
  expect(mocks.request).toHaveBeenCalledTimes(3);
});

describe("match room code changes and visibility recovery", () => {
  it("drops the previous room in the same render when the code changes", async () => {
    const view = render(<MatchRoomView code="ROOM1" />);
    await screen.findByText("Alpha");
    expect(screen.getByText(/Room ROOM1/)).toBeInTheDocument();

    mocks.request.mockImplementation(() => new Promise(() => {}));
    view.rerender(<MatchRoomView code="ROOM2" />);

    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.queryByText(/Room ROOM1/)).not.toBeInTheDocument();
    expect(screen.getByText("Opening secure match room…")).toBeInTheDocument();
  });

  it("keeps a stale error banner out of the newly requested room", async () => {
    mocks.request.mockImplementation(() => Promise.reject(new Error("Room is closed.")));
    const view = render(<MatchRoomView code="ROOM1" />);
    expect(await screen.findByText("Room is closed.")).toBeInTheDocument();

    mocks.request.mockImplementation(() => new Promise(() => {}));
    view.rerender(<MatchRoomView code="ROOM2" />);

    expect(screen.queryByText("Room is closed.")).not.toBeInTheDocument();
    expect(screen.getByText("Opening secure match room…")).toBeInTheDocument();
  });

  it("refreshes as soon as the document becomes visible again", async () => {
    let visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    try {
      render(<MatchRoomView code="ROOM1" />);
      await screen.findByText("Alpha");
      await act(async () => {});
      mocks.request.mockClear();

      visibility = "hidden";
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
      expect(mocks.request).not.toHaveBeenCalled();

      visibility = "visible";
      await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
      expect(mocks.request).toHaveBeenCalledTimes(3);
    } finally {
      delete (document as unknown as Record<string, unknown>).visibilityState;
    }
  });

  it("stops listening for visibility changes after unmount", async () => {
    const view = render(<MatchRoomView code="ROOM1" />);
    await screen.findByText("Alpha");
    await act(async () => {});
    view.unmount();
    mocks.request.mockClear();

    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
