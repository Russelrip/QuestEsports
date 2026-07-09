const test = require("node:test");
const assert = require("node:assert/strict");

const { Prisma } = require("../src/generated/prisma");
const { HttpError } = require("../src/lib/http-error");
const { mapPrismaError } = require("../src/lib/prisma-errors");

const createKnownPrismaError = (code) =>
  new Prisma.PrismaClientKnownRequestError("Prisma request failed.", {
    code,
    clientVersion: "test",
  });

test("mapPrismaError returns a retryable response for busy database errors", () => {
  for (const code of ["P2024", "P2028", "P2037"]) {
    const mapped = mapPrismaError(createKnownPrismaError(code));

    assert.ok(mapped instanceof HttpError);
    assert.equal(mapped.statusCode, 503);
    assert.equal(mapped.message, "Database is busy. Please try again.");
  }
});

test("mapPrismaError returns a conflict response for serializable write conflicts", () => {
  const mapped = mapPrismaError(createKnownPrismaError("P2034"));

  assert.ok(mapped instanceof HttpError);
  assert.equal(mapped.statusCode, 409);
  assert.equal(
    mapped.message,
    "The request conflicted with another update. Please try again."
  );
});
