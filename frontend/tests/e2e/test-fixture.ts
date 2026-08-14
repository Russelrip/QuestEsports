import { test as base, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// Browser E2E tests use a short-lived HTTP mock. Stub persistent EventSource
// connections so WebKit does not retain sockets from contexts that Playwright
// has already closed. SSE authentication and delivery are covered by the API
// integration suite; these tests continue to exercise notification loading.
export const test = base.extend({
  page: async ({ page }, providePage) => {
    await page.addInitScript(() => {
      class TestEventSource extends EventTarget {
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        static readonly CLOSED = 2;

        readonly CONNECTING = TestEventSource.CONNECTING;
        readonly OPEN = TestEventSource.OPEN;
        readonly CLOSED = TestEventSource.CLOSED;
        readonly readyState = TestEventSource.CLOSED;
        readonly url: string;
        readonly withCredentials: boolean;
        onerror: ((event: Event) => void) | null = null;
        onmessage: ((event: MessageEvent) => void) | null = null;
        onopen: ((event: Event) => void) | null = null;

        constructor(url: string | URL, init?: EventSourceInit) {
          super();
          this.url = String(url);
          this.withCredentials = Boolean(init?.withCredentials);
        }

        close() {}
      }

      Object.defineProperty(window, "EventSource", {
        configurable: true,
        value: TestEventSource,
        writable: true,
      });
    });

    await providePage(page);
  },
});

export { expect };
export type { Page, Route } from "@playwright/test";

export const openPage = (page: Page, url: string) =>
  page.goto(url, { waitUntil: "domcontentloaded" });
