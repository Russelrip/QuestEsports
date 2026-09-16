const express = require("express");
const { requireStaffPermission } = require("../permissions/permission.middleware");
const controller = require("./expense.controller");

const router = express.Router();
router.get("/admin/expense-targets", requireStaffPermission("expenses"), controller.getTargets);
router.get("/admin/expenses", requireStaffPermission("expenses"), controller.getExpenses);
router.post("/admin/expenses", requireStaffPermission("expenses"), controller.createExpense);
router.patch("/admin/expenses/:expenseId", requireStaffPermission("expenses"), controller.updateExpense);
router.delete("/admin/expenses/:expenseId", requireStaffPermission("expenses"), controller.deleteExpense);

module.exports = router;
