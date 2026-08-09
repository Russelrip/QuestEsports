import { chromium } from "@playwright/test";

const urls = process.argv.slice(2);
const targets = urls.length > 0
  ? urls
  : ["https://questesports.lk/", "https://questesports.lk/tournaments"];
const runs = Math.max(Number.parseInt(process.env.PERF_RUNS || "3", 10), 1);
const budgets = {
  ttfbMs: Number.parseInt(process.env.PERF_MAX_TTFB_MS || "2000", 10),
  loadMs: Number.parseInt(process.env.PERF_MAX_LOAD_MS || "5000", 10),
  transferKb: Number.parseInt(process.env.PERF_MAX_TRANSFER_KB || "1000", 10),
  resourceCount: Number.parseInt(process.env.PERF_MAX_RESOURCE_COUNT || "150", 10),
};
const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};

const browser = await chromium.launch({ headless: true });
const violations = [];

try {
  for (const url of targets) {
    const samples = [];
    for (let run = 0; run < runs; run += 1) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const startedAt = Date.now();

      await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
      const sample = await page.evaluate(() => {
        const navigation = performance.getEntriesByType("navigation")[0];
        const resources = performance.getEntriesByType("resource");
        return {
          ttfbMs: Math.round(navigation.responseStart),
          domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
          loadMs: Math.round(navigation.loadEventEnd),
          transferKb: Math.round(
            ((navigation.transferSize || 0) +
              resources.reduce((total, resource) => total + (resource.transferSize || 0), 0)) / 1024
          ),
          resourceCount: resources.length,
          routePrefetchCount: resources.filter((resource) =>
            resource.initiatorType === "fetch" && resource.name.includes("?_rsc=")
          ).length,
        };
      });

      samples.push({ ...sample, settledMs: Date.now() - startedAt });
      await context.close();
    }

    const summary = Object.fromEntries(
      Object.keys(samples[0]).map((key) => [key, median(samples.map((sample) => sample[key]))])
    );
    console.log(JSON.stringify({ url, runs, median: summary, samples }, null, 2));
    for (const [metric, maximum] of Object.entries(budgets)) {
      if (!Number.isFinite(maximum) || maximum < 1) {
        throw new Error(`Invalid performance budget for ${metric}: ${maximum}`);
      }
      if (summary[metric] > maximum) {
        violations.push(`${url}: ${metric}=${summary[metric]} exceeds ${maximum}`);
      }
    }
  }
} finally {
  await browser.close();
}

if (violations.length > 0) {
  console.error(`Performance budget failed:\n${violations.join("\n")}`);
  process.exitCode = 1;
}
