const { env } = require("../config/env");
const { logger } = require("./logger");

const memory = new Map();
const generations = new Map();
const metrics = { hits: 0, misses: 0, writes: 0, errors: 0 };

const pruneMemory = () => {
  const now = Date.now();
  for (const [key, entry] of memory) {
    if (entry.expiresAt <= now) memory.delete(key);
  }
  while (memory.size >= env.CACHE_MAX_ENTRIES) {
    memory.delete(memory.keys().next().value);
  }
};

const upstashCommand = async (...command) => {
  const response = await fetch(env.UPSTASH_REDIS_REST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(env.CACHE_CONNECTION_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Upstash returned HTTP ${response.status}.`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error);
  return payload.result;
};

const namespaced = (key) => `${env.CACHE_KEY_PREFIX}:${key}`;

const getGeneration = async (tag) => {
  if (env.CACHE_DRIVER === "upstash") {
    return (await upstashCommand("GET", namespaced(`generation:${tag}`))) || "0";
  }
  return String(generations.get(tag) || 0);
};

const buildKey = async (key, tags) => {
  const versions = await Promise.all(tags.map(getGeneration));
  return namespaced(`${key}:${tags.map((tag, index) => `${tag}@${versions[index]}`).join("|")}`);
};

const get = async (key, tags = []) => {
  try {
    const resolvedKey = await buildKey(key, tags);
    let value;
    if (env.CACHE_DRIVER === "upstash") {
      value = await upstashCommand("GET", resolvedKey);
    } else {
      const entry = memory.get(resolvedKey);
      if (entry?.expiresAt > Date.now()) value = entry.value;
      else if (entry) memory.delete(resolvedKey);
    }
    if (value === undefined || value === null) {
      metrics.misses += 1;
      return null;
    }
    metrics.hits += 1;
    return typeof value === "string" ? JSON.parse(value) : value;
  } catch (error) {
    metrics.errors += 1;
    logger.warn("Cache read failed; continuing without cache", { error });
    return null;
  }
};

const set = async (key, value, ttlSeconds, tags = []) => {
  try {
    const resolvedKey = await buildKey(key, tags);
    if (env.CACHE_DRIVER === "upstash") {
      await upstashCommand("SET", resolvedKey, JSON.stringify(value), "EX", ttlSeconds);
    } else {
      pruneMemory();
      memory.set(resolvedKey, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    }
    metrics.writes += 1;
  } catch (error) {
    metrics.errors += 1;
    logger.warn("Cache write failed; response was still served", { error });
  }
};

const invalidateTags = async (tags) => {
  await Promise.all(tags.map(async (tag) => {
    try {
      if (env.CACHE_DRIVER === "upstash") {
        await upstashCommand("INCR", namespaced(`generation:${tag}`));
      } else {
        generations.set(tag, (generations.get(tag) || 0) + 1);
      }
    } catch (error) {
      metrics.errors += 1;
      logger.warn("Cache invalidation failed", { tag, error });
    }
  }));
};

const cacheStatus = () => ({
  driver: env.CACHE_DRIVER,
  entries: env.CACHE_DRIVER === "memory" ? memory.size : undefined,
  ...metrics,
  hitRate: metrics.hits + metrics.misses
    ? Number((metrics.hits / (metrics.hits + metrics.misses)).toFixed(4))
    : 0,
});

module.exports = { get, set, invalidateTags, cacheStatus };
