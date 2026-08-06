const { enqueueJob } = require("../jobs");
const {
  EMAIL_JOB_NAME,
  EMAIL_TEMPLATE_TYPES,
} = require("./mail-job-definitions");

const sendTicketOrderEmail = async ({
  orderId,
  email,
  firstName,
  eventTitle,
  quantity,
  rawToken,
}) =>
  enqueueJob(
    EMAIL_JOB_NAME,
    {
      type: EMAIL_TEMPLATE_TYPES.ticketOrder,
      email,
      firstName,
      eventTitle,
      quantity,
      rawToken,
    },
    { dedupeKey: `ticket-order-email:${orderId}` },
  );

module.exports = { sendTicketOrderEmail };
