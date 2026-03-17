const { logger } = require("./logger");

const suggestedJobBackends = [
  {
    name: "BullMQ",
    useCase: "Redis-backed email, media, and webhook jobs",
  },
  {
    name: "Cloud queue",
    useCase: "Managed background processing in hosted environments",
  },
];

const enqueueJob = async (name, payload = {}) => {
  logger.info("Background job placeholder invoked", {
    jobName: name,
    payload,
  });

  return {
    accepted: false,
    name,
    payload,
    message:
      "No queue backend is configured yet. Wire enqueueJob to BullMQ, SQS, or another queue before using it for production async work.",
  };
};

module.exports = {
  enqueueJob,
  suggestedJobBackends,
};
