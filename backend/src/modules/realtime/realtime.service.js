const { EventEmitter } = require("events");

const eventBus = new EventEmitter();

let sequence = 0;
let activeConnections = 0;
const connectionsByClient = new Map();

const publishRealtimeEvent = (topic, payload = {}) => {
  sequence += 1;
  const event = {
    id: `${Date.now()}-${sequence}`,
    topic,
    occurredAt: new Date().toISOString(),
    payload,
  };
  eventBus.emit("event", event);
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
  activeConnections,
  activeClients: connectionsByClient.size,
  publishedEvents: sequence,
});

module.exports = {
  publishRealtimeEvent,
  subscribeToRealtimeEvents,
  openRealtimeConnection,
  closeRealtimeConnection,
  getRealtimeStatus,
};
