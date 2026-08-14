import { buildApiUrl } from "./api";

type RealtimeHealth = {
  realtime?: { enabled?: boolean };
};

let realtimeCapability: Promise<boolean> | null = null;

const realtimeIsEnabled = () => {
  if (!realtimeCapability) {
    realtimeCapability = fetch(buildApiUrl("/api/health/live"), {
      cache: "no-store",
      credentials: "include",
    })
      .then(async (response) => {
        if (!response.ok) return false;
        const health = await response.json() as RealtimeHealth;
        return health.realtime?.enabled === true;
      })
      .catch(() => false);
  }
  return realtimeCapability;
};

export const subscribeToRealtimeUpdates = (
  topic: string,
  onUpdate: () => void,
) => {
  let closed = false;
  let events: EventSource | null = null;

  void realtimeIsEnabled().then((enabled) => {
    if (!enabled || closed) return;
    events = new EventSource(
      buildApiUrl(`/api/v1/events?topics=${encodeURIComponent(topic)}`),
      { withCredentials: true },
    );
    events.addEventListener("update", onUpdate);
  });

  return () => {
    closed = true;
    events?.close();
  };
};
