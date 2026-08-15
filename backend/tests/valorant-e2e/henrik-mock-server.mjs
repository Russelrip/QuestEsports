// Fixture-replaying HenrikDev mock for the two-service VALORANT E2E.
// Serves the recorded fixture JSON files from the FastAPI repo
// (HENRIK_MOCK_FIXTURES must point at valorant-platform-backend/tests/fixtures/henrik).
// Routes match app/integrations/henrik/client.py:
//   GET /valorant/v2/account/{name}/{tag}
//   GET /valorant/v4/by-puuid/matches/{affinity}/{platform}/{puuid}?size&start
//   GET /valorant/v4/match/{affinity}/{match_id}
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.env.HENRIK_MOCK_FIXTURES;
if (!root) {
  console.error("HENRIK_MOCK_FIXTURES must point at the FastAPI henrik fixtures directory");
  process.exit(1);
}
const port = Number(process.env.HENRIK_MOCK_PORT || 18000);
const accountFixture =
  process.env.HENRIK_MOCK_ACCOUNT || "account_v2/valid.json";
const historyFixture =
  process.env.HENRIK_MOCK_HISTORY || "history_v4/page1_mixed_modes.json";
const matchDetailFixture =
  process.env.HENRIK_MOCK_MATCH_DETAIL || "match_detail_v4/valid.json";

const sendJson = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  try {
    if (url.pathname.startsWith("/valorant/v2/account/")) {
      const body = JSON.parse(await readFile(path.join(root, accountFixture), "utf8"));
      return sendJson(res, 200, body);
    }
    if (url.pathname.includes("/by-puuid/matches/")) {
      const body = JSON.parse(await readFile(path.join(root, historyFixture), "utf8"));
      return sendJson(res, 200, body);
    }
    if (url.pathname.startsWith("/valorant/v4/match/")) {
      const body = JSON.parse(await readFile(path.join(root, matchDetailFixture), "utf8"));
      return sendJson(res, 200, body);
    }
    sendJson(res, 404, { status: 404, message: `mock: no fixture for ${url.pathname}` });
  } catch (error) {
    console.error("mock server error:", error);
    sendJson(res, 500, { status: 500, message: String(error) });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`henrik mock listening on 127.0.0.1:${port}`);
});
