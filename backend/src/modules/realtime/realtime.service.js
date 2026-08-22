const { EventEmitter } = require("events");
const { randomUUID } = require("crypto");
const { env } = require("../../config/env");
const { logger } = require("../../lib/logger");
const { createRealtimeTransport } = require("./realtime.transport");

const eventBus = new EventEmitter();
const REMOTE_ENVELOPE_VERSION = 1;
const TOPIC_PATTERN = /^[a-z0-9:_-]{1,80}$/;
const RECONCILIATION_TOPIC = "reconciliation";
const sharedTransportRequiredByConfig = env.API_PROCESS_COUNT > 1;

let sequence = 0;
let publishedEvents = 0;
let activeConnections = 0;
let sharedTransportRequired = sharedTransportRequiredByConfig;
let sharedTransportConnected = false;
let lastTransportErrorAt = null;
let hasConnectedBefore = false;
let startPromise = null;
let stopPromise = null;
let transportOverride = null;
let realtimeTransport = sharedTransportRequiredByConfig
  ? createRealtimeTransport({ logger })
  : null;
const connectionsByClient = new Map();
const workerId = `${env.REALTIME_WORKER_ID}:${process.pid}:${randomUUID()}`;

const logTransportError = (message, error) => {
  logger.warn(message, { error });
};

const getTransport = () => transportOverride || realtimeTransport;

const nowIso = () => new Date().toISOString();

const createLocalEvent = (topic, payload, countAsPublished) => {
  sequence += 1;
  if (countAsPublished) publishedEvents += 1;
  return {
    id: `${Date.now()}-${sequence}`,
    topic,
    occurredAt: nowIso(),
    payload,
  };
};

const emitLocalEvent = (event) => {
  eventBus.emit("event", event);
  return event;
};

const serializedByteLength = (value) => {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined
      ? null
      : Buffer.byteLength(serialized, "utf8");
  } catch {
    return null;
  }
};

const isValidRemoteEnvelope = (envelope) => {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return false;
  }
  if (envelope.version !== REMOTE_ENVELOPE_VERSION) return false;
  if (
    typeof envelope.eventId !== "string" ||
    envelope.eventId.length === 0 ||
    envelope.eventId.length > 200
  ) {
    return false;
  }
  if (
    typeof envelope.origin !== "string" ||
    envelope.origin.length === 0 ||
    envelope.origin.length > 200
  ) {
    return false;
  }
  if (
    typeof envelope.topic !== "string" ||
    !TOPIC_PATTERN.test(envelope.topic)
  ) {
    return false;
  }
  if (
    typeof envelope.timestamp !== "string" ||
    envelope.timestamp.length > 64 ||
    Number.isNaN(Date.parse(envelope.timestamp))
  ) {
    return false;
  }
  if (!Object.prototype.hasOwnProperty.call(envelope, "payload")) {
    return false;
  }

  const payloadBytes = serializedByteLength(envelope.payload);
  if (payloadBytes === null || payloadBytes > env.REALTIME_PUBSUB_MAX_MESSAGE_BYTES) {
    return false;
  }
  const envelopeBytes = serializedByteLength(envelope);
  return envelopeBytes !== null && envelopeBytes <= env.REALTIME_PUBSUB_MAX_MESSAGE_BYTES;
};

const handleRemoteEnvelope = (envelope) => {
  if (!isValidRemoteEnvelope(envelope) || envelope.origin === workerId) return;
  emitLocalEvent({
    id: envelope.eventId,
    topic: envelope.topic,
    occurredAt: envelope.timestamp,
    payload: envelope.payload,
  });
};

const handleTransportStatus = ({ connected, reason } = {}) => {
  const nextConnected = connected === true;
  const recovered = nextConnected && hasConnectedBefore && !sharedTransportConnected;
  sharedTransportConnected = nextConnected;

  if (!nextConnected && reason !== "stopped") {
    lastTransportErrorAt = nowIso();
  }
  if (nextConnected) {
    hasConnectedBefore = true;
    if (recovered) requestRealtimeReconciliation();
  }
};

const publishToSharedTransport = (envelope) => {
  const transport = getTransport();
  if (!sharedTransportRequired || !transport || typeof transport.publish !== "function") {
    return;
  }

  try {
    Promise.resolve(transport.publish(envelope)).catch((error) => {
      logTransportError("Realtime shared publication failed", error);
    });
  } catch (error) {
    logTransportError("Realtime shared publication failed", error);
  }
};

const publishRealtimeEvent = (topic, payload = {}) => {
  const event = emitLocalEvent(createLocalEvent(topic, payload, true));
  publishToSharedTransport({
    version: REMOTE_ENVELOPE_VERSION,
    eventId: event.id,
    origin: workerId,
    topic: event.topic,
    timestamp: event.occurredAt,
    payload: event.payload,
  });
  return event;
};

const subscribeToRealtimeEvents = (listener) => {
  eventBus.on("event", listener);
  return () => eventBus.off("event", listener);
};

const openRealtimeConnection = (clientKey, { maxTotal, maxPerClient }) => {
  const clientConnections = connectionsByClient.get(clientKey) || 0;
  if (activeConnections >= maxTotal || clientConnections >= maxPerClient) return false;
  activeConnections += 1;
  connectionsByClient.set(clientKey, clientConnections + 1);
  eventBus.setMaxListeners(Math.max(maxTotal + 10, 20));
  return true;
};

const closeRealtimeConnection = (clientKey) => {
  activeConnections = Math.max(0, activeConnections - 1);
  const remaining = Math.max((connectionsByClient.get(clientKey) || 1) - 1, 0);
  if (remaining) connectionsByClient.set(clientKey, remaining);
  else connectionsByClient.delete(clientKey);
};

const getRealtimeStatus = () => ({
  workerId,
  activeConnections,
  activeClients: connectionsByClient.size,
  publishedEvents,
  sharedTransportRequired,
  sharedTransportConnected: sharedTransportRequired && sharedTransportConnected,
  lastErrorAt: lastTransportErrorAt,
});

const startRealtimeTransport = async () => {
  if (!sharedTransportRequired) return;
  const transport = getTransport();
  if (!transport || typeof transport.start !== "function") {
    lastTransportErrorAt = nowIso();
    return;
  }
  if (startPromise) return startPromise;

  startPromise = (async () => {
    if (stopPromise) await stopPromise;
    try {
      await transport.start(handleRemoteEnvelope, handleTransportStatus);
    } catch (error) {
      sharedTransportConnected = false;
      lastTransportErrorAt = nowIso();
      logTransportError("Realtime transport start failed", error);
    }
  })();
  try {
    await startPromise;
  } finally {
    startPromise = null;
  }
};

const stopRealtimeTransport = async () => {
  if (stopPromise) return stopPromise;
  const transport = getTransport();
  if (!transport || typeof transport.stop !== "function") {
    sharedTransportConnected = false;
    return;
  }

  stopPromise = (async () => {
    try {
      await transport.stop();
    } catch (error) {
      lastTransportErrorAt = nowIso();
      logTransportError("Realtime transport stop failed", error);
    } finally {
      sharedTransportConnected = false;
    }
  })();
  try {
    await stopPromise;
  } finally {
    stopPromise = null;
  }
};

const isRealtimeTransportReady = () =>
  !sharedTransportRequired || sharedTransportConnected;

const requestRealtimeReconciliation = () => {
  emitLocalEvent(
    createLocalEvent(RECONCILIATION_TOPIC, { reconcile: true }, false),
  );
};

const setRealtimeTransportForTests = (transport, { required = false } = {}) => {
  transportOverride = transport;
  if (transport) {
    sharedTransportRequired = required;
    realtimeTransport = transport;
  } else {
    sharedTransportRequired = required;
    realtimeTransport = sharedTransportRequiredByConfig
      ? createRealtimeTransport({ logger })
      : null;
  }
  sharedTransportConnected = false;
  hasConnectedBefore = false;
  lastTransportErrorAt = null;
};

module.exports = {
  publishRealtimeEvent,
  subscribeToRealtimeEvents,
  openRealtimeConnection,
  closeRealtimeConnection,
  getRealtimeStatus,
  startRealtimeTransport,
  stopRealtimeTransport,
  isRealtimeTransportReady,
  requestRealtimeReconciliation,
  setRealtimeTransportForTests,
};
