const { asyncHandler } = require("../../lib/async-handler");
const { recordAudit, requestAuditContext } = require("../../lib/audit");
const service = require("./expense.service");

const getTargets = asyncHandler(async (_req, res) => {
  res.status(200).json({ success: true, targets: await service.listExpenseTargets() });
});

const getExpenses = asyncHandler(async (req, res) => {
  res.status(200).json({ success: true, ...(await service.listExpenses(req.query)) });
});

const createExpense = asyncHandler(async (req, res) => {
  const expense = await service.createExpense({ body: req.body, adminUserId: req.user.id });
  await recordAudit({ ...requestAuditContext(req), action: "expense.create", targetType: "event_expense", targetId: expense.id, afterData: expense });
  res.status(201).json({ success: true, message: "Expense added.", expense });
});

const updateExpense = asyncHandler(async (req, res) => {
  const result = await service.updateExpense({ expenseId: req.params.expenseId, body: req.body });
  await recordAudit({ ...requestAuditContext(req), action: "expense.update", targetType: "event_expense", targetId: result.expense.id, beforeData: result.before, afterData: result.expense });
  res.status(200).json({ success: true, message: "Expense updated.", expense: result.expense });
});

const deleteExpense = asyncHandler(async (req, res) => {
  const expense = await service.deleteExpense(req.params.expenseId);
  await recordAudit({ ...requestAuditContext(req), action: "expense.delete", targetType: "event_expense", targetId: expense.id, beforeData: expense });
  res.status(200).json({ success: true, message: "Expense deleted." });
});

module.exports = { getTargets, getExpenses, createExpense, updateExpense, deleteExpense };
