const { env } = require("../../config/env");
const { HttpError } = require("../../lib/http-error");

const TIMEOUT_MS = 5000;

const getBaseUrl = () => {
  const baseUrl = env.VALORANT_SL_API_URL;
  if (!baseUrl) {
    throw new HttpError(503, "VALORANT leaderboard is not configured.");
  }
  return baseUrl.replace(/\/+$/, "");
};

const get = async (path) => {
  const baseUrl = getBaseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
  } catch {
    throw new HttpError(503, "VALORANT leaderboard is unavailable.");
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) {
    return response.json();
  }
  if (response.status === 404) {
    throw new HttpError(404, "Leaderboard page not found.");
  }
  throw new HttpError(502, "VALORANT leaderboard is unavailable.");
};

const getLeaderboard = async ({ page = 1, perPage = 50 }) => {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("per_page", String(perPage));
  return get(`/api/v1/leaderboard?${params.toString()}`);
};

const searchLeaderboard = async (query) =>
  get(`/api/v1/leaderboard/search/${encodeURIComponent(query)}`);

module.exports = { getLeaderboard, searchLeaderboard };
