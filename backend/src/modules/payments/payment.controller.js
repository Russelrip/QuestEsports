const { asyncHandler } = require("../../lib/async-handler");
const { processPayHereNotification, getPaymentStatus } = require("./payment.service");
const { listPaymentTransactions } = require("./payment.service");

const notifyPayHere = asyncHandler(async (req, res) => {
  await processPayHereNotification(req.body);
  res.status(200).send("OK");
});

const readPaymentStatus = asyncHandler(async (req, res) => {
  const payment = await getPaymentStatus({
    providerOrderId: req.params.orderId,
    userId: req.user?.id,
    publicToken: req.query.token,
  });
  res.status(200).json({ success: true, payment });
});

const getAdminPayments = asyncHandler(async (req, res) => {
  const result = await listPaymentTransactions(req.query);
  res.status(200).json({
    success: true,
    payments: result.items,
    pagination: result.pagination,
  });
});

module.exports = { notifyPayHere, readPaymentStatus, getAdminPayments };
