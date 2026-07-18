import { createServer } from "node:http";

const port = Number.parseInt(process.env.PLAYWRIGHT_MOCK_API_PORT || "5001", 10);
const collections = new Map([
  ["/api/posters", { posters: [] }],
  ["/api/tournaments", { tournaments: [] }],
  ["/api/event-series", { series: [] }],
  ["/api/game-categories", { categories: [] }],
  ["/api/products", { products: [] }],
]);

const server = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Access-Control-Allow-Origin", request.headers.origin || "http://127.0.0.1:3010");
  response.setHeader("Access-Control-Allow-Credentials", "true");

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (request.url === "/api/health/live") {
    response.end(JSON.stringify({ success: true }));
    return;
  }
  if (request.url === "/api/me") {
    response.statusCode = 401;
    response.end(JSON.stringify({ success: false, message: "Not authenticated." }));
    return;
  }

  const payload = collections.get(new URL(request.url || "/", `http://127.0.0.1:${port}`).pathname);
  if (request.method === "GET" && payload) {
    response.end(JSON.stringify({ success: true, ...payload }));
    return;
  }

  response.statusCode = 404;
  response.end(JSON.stringify({ success: false, message: "Unexpected mock API request." }));
});

server.listen(port, "127.0.0.1");

const close = () => server.close(() => process.exit(0));
process.on("SIGINT", close);
process.on("SIGTERM", close);
