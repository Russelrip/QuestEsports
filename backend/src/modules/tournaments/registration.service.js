// Public surface; codemap.md lists the files the code lives in.
const { normalizeCoachSubmission } = require("./coach.validation");
const {
  validateConfiguredFields,
  validateGameIdentities,
  normalizeRegistrationSubmission,
} = require("./registration-validation");
const { buildPaymentOrderId, cancelUnpaidRegistration } = require("./registration-payment.service");
const { createConfiguredRegistration } = require("./registration-create.service");

module.exports = {
  createConfiguredRegistration,
  cancelUnpaidRegistration,
  normalizeRegistrationSubmission,
  normalizeCoachSubmission,
  validateConfiguredFields,
  validateGameIdentities,
  buildPaymentOrderId,
};
