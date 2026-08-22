const REQUIRED_VARIABLES = [
  "REALTIME_CLUSTER_WORKER_A_URL",
  "REALTIME_CLUSTER_WORKER_B_URL",
  "REALTIME_CLUSTER_COOKIE",
  "REALTIME_CLUSTER_TOPIC",
  "REALTIME_CLUSTER_MUTATION_URL",
  "REALTIME_CLUSTER_MUTATION_METHOD",
  "REALTIME_CLUSTER_MUTATION_BODY",
];

const TIMEOUT_MS = 30_000;

const requiredEnvironment = () => {
  const missing = REQUIRED_VARIABLES.filter(
    (name) => !String(process.env[name] || "").trim(),
  );
  if (missing.length) {
    throw new Error(
      `Missing required cluster smoke variables: ${missing.join(", ")}`,
    );
  }
  return Object.fromEntries(
    REQUIRED_VARIABLES.map((name) => [name, String(process.env[name]).trim()]),
  );
};

const withApiPath = (baseUrl, path) => {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
  return url;
};

const originHeaderFor = (url) => new URL(url).origin;

const responseText = async (response) => {
  try {
    return await response.text();
  } catch {
    return "<response body unavailable>";
  }
};

class SseClient {
  constructor(label, workerUrl, topic, cookie) {
    this.label = label;
    this.workerUrl = workerUrl;
    this.topic = topic;
    this.cookie = cookie;
    this.controller = null;
    this.reader = null;
    this.readPromise = null;
    this.events = [];
    this.errors = [];
    this.closed = false;
  }

  async connect() {
    this.closed = false;
    this.controller = new AbortController();
    const timeout = setTimeout(() => this.controller.abort(), 10_000);
    let response;
    try {
      const streamUrl = withApiPath(
        this.workerUrl,
        `/api/v1/events?topics=${encodeURIComponent(this.topic)}`,
      );
      response = await fetch(streamUrl, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          Cookie: this.cookie,
          Origin: originHeaderFor(this.workerUrl),
        },
        signal: this.controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(
        `${this.label} SSE returned HTTP ${response.status}: ${await responseText(response)}`,
      );
    }
    if (!response.body || typeof response.body.getReader !== "function") {
      throw new Error(`${this.label} SSE response did not contain a readable body.`);
    }

    this.readPromise = this.readLoop(response.body);
  }

  async readLoop(body) {
    this.reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!this.closed) {
        const result = await this.reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        let separator;
        while ((separator = buffer.search(/\r?\n\r?\n/)) >= 0) {
          const match = buffer.match(/\r?\n\r?\n/);
          this.parseRecord(buffer.slice(0, separator));
          buffer = buffer.slice(separator + match[0].length);
        }
      }
    } catch (error) {
      if (!this.closed) this.errors.push(error);
    } finally {
      this.reader = null;
    }
  }

  parseRecord(record) {
    let eventName = "message";
    const data = [];
    for (const line of record.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (!data.length) return;
    const rawData = data.join("\n");
    let parsedData = rawData;
    try {
      parsedData = JSON.parse(rawData);
    } catch {
      // Keep non-JSON SSE data in diagnostics; update/ready payloads are JSON.
    }
    this.events.push({ name: eventName, data: parsedData });
  }

  async waitForEvent(name, description) {
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.events.some((event) => event.name === name)) return;
      if (this.errors.length) {
        throw new Error(`${this.label} SSE stream failed: ${this.errors[0].message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`${this.label} did not receive ${description || name} within ${TIMEOUT_MS}ms.`);
  }

  async close() {
    this.closed = true;
    this.controller?.abort();
    try {
      await this.reader?.cancel();
    } catch {
      // The abort is the authoritative close; a reader may already be released.
    }
    await this.readPromise?.catch(() => {});
  }
}

const performMutation = async (config) => {
  let body;
  try {
    body = JSON.parse(config.REALTIME_CLUSTER_MUTATION_BODY);
  } catch (error) {
    throw new Error(`REALTIME_CLUSTER_MUTATION_BODY is not valid JSON: ${error.message}`);
  }

  const method = config.REALTIME_CLUSTER_MUTATION_METHOD.toUpperCase();
  if (["GET", "HEAD"].includes(method)) {
    throw new Error("REALTIME_CLUSTER_MUTATION_METHOD must be a JSON mutation method, not GET or HEAD.");
  }

  const response = await fetch(config.REALTIME_CLUSTER_MUTATION_URL, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Cookie: config.REALTIME_CLUSTER_COOKIE,
      Origin: originHeaderFor(config.REALTIME_CLUSTER_MUTATION_URL),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(
      `Configured mutation returned HTTP ${response.status}: ${await responseText(response)}`,
    );
  }
  return response;
};

const assertPrivateTopicIsolation = async (workerUrl, cookie) => {
  const response = await fetch(
    withApiPath(workerUrl, "/api/v1/events?topics=user"),
    {
      headers: {
        Accept: "text/event-stream",
        Cookie: cookie,
        Origin: originHeaderFor(workerUrl),
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (response.status !== 403) {
    throw new Error(
      `Private topic isolation failed: broad user topic returned HTTP ${response.status}; expected 403.`,
    );
  }
};

const main = async () => {
  const config = requiredEnvironment();
  const clients = [
    new SseClient(
      "worker A",
      config.REALTIME_CLUSTER_WORKER_A_URL,
      config.REALTIME_CLUSTER_TOPIC,
      config.REALTIME_CLUSTER_COOKIE,
    ),
    new SseClient(
      "worker B",
      config.REALTIME_CLUSTER_WORKER_B_URL,
      config.REALTIME_CLUSTER_TOPIC,
      config.REALTIME_CLUSTER_COOKIE,
    ),
  ];

  try {
    await Promise.all(clients.map((client) => client.connect()));
    await Promise.all(clients.map((client) => client.waitForEvent("ready", "ready")));
    const updateCounts = clients.map((client) =>
      client.events.filter((event) => event.name === "update").length,
    );

    await performMutation(config);
    const updateDeadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < updateDeadline) {
      if (clients.every((client, index) =>
        client.events.filter((event) => event.name === "update").length > updateCounts[index],
      )) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    for (const [index, client] of clients.entries()) {
      const updates = client.events.filter((event) => event.name === "update").length;
      if (updates <= updateCounts[index]) {
        throw new Error(`${client.label} did not observe a realtime refresh after the configured mutation.`);
      }
    }

    await clients[0].close();
    const reconnected = new SseClient(
      "worker A reconnect",
      config.REALTIME_CLUSTER_WORKER_A_URL,
      config.REALTIME_CLUSTER_TOPIC,
      config.REALTIME_CLUSTER_COOKIE,
    );
    try {
      await reconnected.connect();
      await reconnected.waitForEvent("ready", "ready after reconnect");
    } finally {
      await reconnected.close();
    }

    await assertPrivateTopicIsolation(
      config.REALTIME_CLUSTER_WORKER_A_URL,
      config.REALTIME_CLUSTER_COOKIE,
    );
    await assertPrivateTopicIsolation(
      config.REALTIME_CLUSTER_WORKER_B_URL,
      config.REALTIME_CLUSTER_COOKIE,
    );

    console.log("Realtime cluster smoke: PASS");
    console.log("- both workers emitted ready and observed the configured mutation refresh");
    console.log("- reconnect emitted ready");
    console.log("- broad private user topic returned 403 on both workers");
  } finally {
    await Promise.all(clients.map((client) => client.close()));
  }
};

main().catch((error) => {
  console.error("Realtime cluster smoke: FAIL");
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
