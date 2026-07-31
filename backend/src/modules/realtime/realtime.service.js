const { EventEmitter } = require("events");

const eventBus = new EventEmitter();
eventBus.setMaxListeners(0);

let sequence = 0;
let activeConnections = 0;

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

const openRealtimeConnection = () => { activeConnections += 1; };
const closeRealtimeConnection = () => { activeConnections = Math.max(0, activeConnections - 1); };
const getRealtimeStatus = () => ({ activeConnections, publishedEvents: sequence });

module.exports = {
  publishRealtimeEvent,
  subscribeToRealtimeEvents,
  openRealtimeConnection,
  closeRealtimeConnection,
  getRealtimeStatus,
};
