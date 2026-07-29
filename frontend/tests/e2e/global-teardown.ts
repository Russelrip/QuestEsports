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
  if (result.unexpectedRequests?.length) {
    const requests = result.unexpectedRequests
      .map(({ method, url }) => `${method || "UNKNOWN"} ${url || "UNKNOWN"}`)
      .join(", ");
    throw new Error(`Unexpected mock API requests: ${requests}`);
  }
}
