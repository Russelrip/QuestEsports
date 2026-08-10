const DEFAULT_TIMEOUT_MS = 3000;
const MAX_QUEUE_SIZE = 1000;
const MAX_IN_FLIGHT = 4;
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 30_000;
const queue = [];
const drainWaiters = new Set();
let inFlight = 0;
let dropped = 0;
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

const postJson = async ({
  url,
  token,
  payload,
  signal,
}) => {
  if (!url) {
    return false;
  }

  const headers = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Observability endpoint responded with ${response.status}.`);
  }

  return true;
};

const notifyDrained = () => {
  if (queue.length || inFlight) return;
  for (const resolve of drainWaiters) resolve(true);
  drainWaiters.clear();
};

const processQueue = () => {
  while (inFlight < MAX_IN_FLIGHT && queue.length) {
    const request = queue.shift();
    inFlight += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    postJson({ ...request, signal: controller.signal })
      .then(() => {
        consecutiveFailures = 0;
      })
      .catch((error) => {
        consecutiveFailures += 1;
        if (consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
          circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
          dropped += queue.length;
          queue.splice(0, queue.length);
        }
        if (typeof request.onError === "function") request.onError(error);
      })
      .finally(() => {
        clearTimeout(timeout);
        inFlight -= 1;
        processQueue();
        notifyDrained();
      });
  }
};

const schedulePostJson = ({ url, token, payload, onError }) => {
  if (!url) {
    return false;
  }

  if (Date.now() < circuitOpenUntil || queue.length >= MAX_QUEUE_SIZE) {
    dropped += 1;
    return false;
  }

  queue.push({ url, token, payload, onError });
  processQueue();

  return true;
};

const flushObservabilityTransport = async ({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  if (!queue.length && !inFlight) return true;
  let timeout;
  let waiter;
  const completed = await Promise.race([
    new Promise((resolve) => {
      waiter = resolve;
      drainWaiters.add(resolve);
    }),
    new Promise((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  if (waiter) drainWaiters.delete(waiter);
  return completed;
};

const getObservabilityTransportStatus = () => ({
  queued: queue.length,
  inFlight,
  dropped,
  circuitOpen: Date.now() < circuitOpenUntil,
});

module.exports = {
  postJson,
  schedulePostJson,
  flushObservabilityTransport,
  getObservabilityTransportStatus,
};
