const express = require("express");
const { requireAdmin } = require("../auth/auth.middleware");
const controller = require("./expense.controller");

const router = express.Router();
router.get("/admin/expense-targets", requireAdmin, controller.getTargets);
router.get("/admin/expenses", requireAdmin, controller.getExpenses);
router.post("/admin/expenses", requireAdmin, controller.createExpense);
router.patch("/admin/expenses/:expenseId", requireAdmin, controller.updateExpense);
router.delete("/admin/expenses/:expenseId", requireAdmin, controller.deleteExpense);

module.exports = router;
