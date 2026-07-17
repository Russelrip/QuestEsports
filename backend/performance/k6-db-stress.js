import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

const baseUrl = __ENV.BASE_URL || "http://localhost:5001";
const errors = new Rate("api_errors");
const non200 = new Counter("non_200_responses");
const responseTime = new Trend("api_response_time", true);

export const options = {
  discardResponseBodies: true,
  scenarios: {
    databaseStress: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 50 },
        { duration: "30s", target: 50 },
        { duration: "20s", target: 100 },
        { duration: "30s", target: 100 },
        { duration: "20s", target: 200 },
        { duration: "45s", target: 200 },
        { duration: "15s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<750", "p(99)<1500"],
    api_errors: ["rate<0.01"],
  },
};

const endpoints = ["/api/tournaments", "/api/game-categories", "/api/products"];

export default function () {
  // Every request gets a unique URL, deliberately forcing a cache miss and database read.
  const endpoint = endpoints[(__VU + __ITER) % endpoints.length];
  const url = `${baseUrl}${endpoint}?stress_vu=${__VU}&stress_iteration=${__ITER}`;
  const response = http.get(url, { tags: { endpoint } });
  const ok = check(response, { "status is 200": (result) => result.status === 200 });

  errors.add(!ok, { endpoint });
  responseTime.add(response.timings.duration, { endpoint });
  if (!ok) {
    non200.add(1, { endpoint, status: String(response.status) });
    console.warn(`Non-200 response: endpoint=${endpoint} status=${response.status}`);
  }
  sleep(0.2);
}
