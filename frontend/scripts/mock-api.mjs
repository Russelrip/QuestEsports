import { createServer } from "node:http";

const port = Number.parseInt(process.env.PLAYWRIGHT_MOCK_API_PORT || "5011", 10);
const allowedOrigin = new URL(
  process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3010"
).origin;
const unexpectedRequests = [];
const collections = new Map([
  ["/api/posters", { posters: [] }],
  ["/api/tournaments", { tournaments: [] }],
  ["/api/event-series", { series: [] }],
  ["/api/game-categories", { categories: [] }],
  ["/api/products", { products: [] }],
]);

const server = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.headers.origin === allowedOrigin) {
    response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
  }

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }
  if (request.url === "/api/health/live") {
    response.end(JSON.stringify({ success: true }));
    return;
  }
  if (request.url === "/__mock-api/status") {
    response.end(JSON.stringify({ success: true, unexpectedRequests }));
    return;
  }
  if (request.url === "/api/me") {
    response.statusCode = 401;
    response.end(JSON.stringify({ success: false, message: "Not authenticated." }));
    return;
  }
  if (request.method === "GET" && request.url === "/api/admin/dashboard") {
    response.statusCode = 401;
    response.end(JSON.stringify({ success: false, message: "Not authenticated." }));
    return;
  }
  if (request.method === "GET" && request.url === "/api/products/quest-shirt") {
    response.statusCode = 404;
    response.end(JSON.stringify({ success: false, message: "Product not found." }));
    return;
  }

  const payload = collections.get(new URL(request.url || "/", `http://127.0.0.1:${port}`).pathname);
  if (request.method === "GET" && payload) {
    response.end(JSON.stringify({ success: true, ...payload }));
    return;
  }

  unexpectedRequests.push({ method: request.method, url: request.url });
  response.statusCode = 404;
  response.end(JSON.stringify({ success: false, message: "Unexpected mock API request." }));
});

server.listen(port, "127.0.0.1");

const close = () => server.close(() => process.exit(0));
process.on("SIGINT", close);
process.on("SIGTERM", close);
