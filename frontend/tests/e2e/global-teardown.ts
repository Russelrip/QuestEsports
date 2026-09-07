/**
 * Endpoints that a spec mocks with `context.route`, so the mock API server only
 * ever sees them when a request escapes interception — which Playwright allows
 * while a page or context is closing, and which says nothing about the app.
 *
 * A request here is reported and not failed. Every other unhandled endpoint
 * still fails the run, so a genuinely unmocked call cannot slip through: the
 * guard only relaxes for paths a spec has explicitly taken ownership of.
 */
const pageRoutedEndpoints = [/^\/api\/v1\/veto-rooms\//];

export default async function globalTeardown() {
  if (process.env.PLAYWRIGHT_SKIP_WEBSERVER) return;

  const port = process.env.PLAYWRIGHT_MOCK_API_PORT || "5011";
  const response = await fetch(`http://127.0.0.1:${port}/__mock-api/status`);
  if (!response.ok) {
    throw new Error(`Mock API verification failed with HTTP ${response.status}.`);
  }

  const result = (await response.json()) as {
    unexpectedRequests?: Array<{ method?: string; url?: string }>;
  };
  const describe = (entries: Array<{ method?: string; url?: string }>) =>
    entries.map(({ method, url }) => `${method || "UNKNOWN"} ${url || "UNKNOWN"}`).join(", ");

  const recorded = result.unexpectedRequests ?? [];
  const escaped = recorded.filter(({ url }) =>
    pageRoutedEndpoints.some((pattern) => pattern.test(new URL(url || "/", "http://127.0.0.1").pathname)),
  );
  const unexpected = recorded.filter((entry) => !escaped.includes(entry));

  if (escaped.length) {
    console.warn(
      `Mock API saw ${escaped.length} request(s) that a spec routes itself, most likely released during teardown: ${describe(escaped)}`,
    );
  }
  if (unexpected.length) {
    throw new Error(`Unexpected mock API requests: ${describe(unexpected)}`);
  }
}
