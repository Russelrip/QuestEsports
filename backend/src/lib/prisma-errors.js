const { Prisma } = require("@prisma/client");
const { HttpError } = require("./http-error");

const mapPrismaError = (error) => {
  if (error instanceof HttpError) {
    return error;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return new HttpError(409, "A record with these details already exists.");
    }

    if (error.code === "P2025") {
      return new HttpError(404, "Requested record was not found.");
    }

    return new HttpError(500, "Database request failed.");
  }

  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return new HttpError(503, "Database connection is unavailable.");
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return new HttpError(400, "Invalid database request.");
  }

  return error;
};

module.exports = { mapPrismaError };
