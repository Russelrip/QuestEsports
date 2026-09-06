/// <reference types="node" />
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
const routerRequire = createRequire(require.resolve("expo-router/package.json"));
const queryPath = routerRequire.resolve("query-string");

describe("Expo Router URI decoder compatibility", () => {
  it("keeps the Expo 57 graph and routes query-string through the fixed decoder", () => {
    const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
    expect(lock.packages["node_modules/expo-router"].version).toMatch(/^57\./);
    expect(lock.packages["node_modules/query-string"].version).toBe("7.1.3");
    const queryRequire = createRequire(queryPath);
    const decoderRequire = createRequire(queryRequire.resolve("decode-uri-component"));
    const upstreamPath = decoderRequire.resolve("decode-uri-component-upstream");
    const upstream = JSON.parse(readFileSync(resolve(upstreamPath, "../package.json"), "utf8"));
    expect(upstream.name).toBe("decode-uri-component");
    expect(upstream.version).toBe("0.5.0");
    for (const [path, value] of Object.entries(lock.packages)) {
      if (/node_modules\/decode-uri-component$/.test(path) && !(value as { link?: boolean }).link) {
        expect((value as { version: string }).version).not.toMatch(/^0\.[0-4]\./);
      }
    }
  });

  it("retains query parsing and stringifying for Router deep links", () => {
    const query = routerRequire("query-string");
    const params = { redirect: "/events/quest?tab=teams", name: "Quest Admin 🎮", tag: ["one", "two"] };
    expect(query.parse(query.stringify(params))).toEqual(params);
    expect(query.parse("empty=&flag&name=Quest+Admin&utf8=%E2%9C%93")).toEqual({
      empty: "", flag: null, name: "Quest Admin", utf8: "✓",
    });
    const malformed = query.parse("q=%FE%FF%41").q;
    expect(typeof malformed).toBe("string");
    expect((malformed as string).length).toBeLessThanOrEqual(5);
  });

  it("decodes hostile malformed input within a bounded child-process budget", () => {
    const result = spawnSync(process.execPath, ["-e", `
      const assert = require('node:assert/strict');
      const query = require(${JSON.stringify(queryPath)});
      const malformed = '%FE%FF'.repeat(4000);
      assert.equal(query.parse('q=' + malformed).q, '��'.repeat(4000));
    `], { timeout: 5000, encoding: "utf8" });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });
});

describe("Android native CI contract", () => {
  it("builds a clean native project with locked dependencies and no signing credentials", () => {
    const { load } = require("js-yaml");
    const workflow = load(readFileSync(resolve(root, "../.github/workflows/ci.yml"), "utf8"));
    const job = workflow.jobs["mobile-admin-android"];
    expect(job).toBeDefined();
    expect(job.needs).toBe("mobile-admin");
    const commands = job.steps.map((step: { run?: string }) => step.run || "").join("\n");
    expect(commands).toContain("npm ci");
    expect(commands).toContain("npm run prebuild:android -- --no-install");
    expect(commands).toContain("expo export --platform android");
    expect(commands).toContain(":app:assembleDebug");
    expect(commands).toContain("--max-workers=1");
    expect(commands).toContain("-PreactNativeArchitectures=arm64-v8a");
    expect(JSON.stringify(job)).not.toContain("secrets.");
  });
});
