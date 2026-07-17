import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const errors = new Rate("api_errors");
const responseTime = new Trend("api_response_time", true);
const baseUrl = __ENV.BASE_URL || "http://localhost:5001";

export const options = {
  scenarios: {
    load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 10 },
        { duration: "2m", target: 10 },
        { duration: "30s", target: 50 },
        { duration: "2m", target: 50 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500", "p(99)<1000"],
    api_errors: ["rate<0.01"],
  },
};

export default function () {
  const responses = http.batch([
    ["GET", `${baseUrl}/api/tournaments`],
    ["GET", `${baseUrl}/api/game-categories`],
    ["GET", `${baseUrl}/api/products`],
  ]);
  for (const response of responses) {
    const ok = check(response, { "status is 200": (result) => result.status === 200 });
    errors.add(!ok);
    responseTime.add(response.timings.duration);
  }
  sleep(1);
}
