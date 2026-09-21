const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadModuleWithMocks } = require("./helpers/load-module-with-mocks");

const controllerPath = path.join(__dirname, "../src/modules/tickets/ticket.controller.js");
const servicePath = path.join(__dirname, "../src/modules/tickets/ticket.service.js");
const auditPath = path.join(__dirname, "../src/lib/audit.js");

test("ticket CSV export neutralizes formula markers after whitespace and control characters", async () => {
  const { module: controller, restore } = loadModuleWithMocks(controllerPath, {
    [servicePath]: {
      getEventReportRows: async () => ({
        event: { slug: "quest-cup" },
        rows: [{
          ticketNumber: "T-1",
          ticketStatus: "issued",
          buyerName: " \t=SUM(1,1)",
          email: "\u0000+cmd|/C calc!A0",
          phone: "\uFEFF@evil",
          orderStatus: "paid",
          orderTotal: 1000,
          checkedInAt: null,
          checkedInBy: "\u202E-evil",
        }],
      }),
    },
    [auditPath]: { requestAuditContext: () => ({}) },
  });

  try {
    let csv;
    const response = {
      setHeader: () => response,
      status: () => response,
      send: (value) => { csv = value; },
    };
    await controller.exportReport({ params: { eventId: "event-1" } }, response, () => {});

    assert.match(csv, /\uFEFF/);
    assert.match(csv, /"' \t=SUM\(1,1\)"/);
    assert.match(csv, /"'\u0000\+cmd\|\/C calc!A0"/);
    assert.match(csv, /"'\uFEFF@evil"/);
    assert.match(csv, /"'\u202E-evil"/);
  } finally {
    restore();
  }
});
