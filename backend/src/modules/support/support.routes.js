const express = require("express");
const { requireAuth, requireAdmin } = require("../auth/auth.middleware");
const {
  createUploadRequestSizeGuard,
  supportScreenshotUpload,
  SUPPORT_SCREENSHOT_MAX_REQUEST_SIZE,
} = require("../../middleware/upload");
const controller = require("./support.controller");

const router = express.Router();
const supportMultipart = [
  createUploadRequestSizeGuard(SUPPORT_SCREENSHOT_MAX_REQUEST_SIZE),
  supportScreenshotUpload.array("screenshots", 3),
];

router.get("/support/unread", requireAuth, controller.unreadSummary);

router.get("/support/conversations", requireAuth, controller.listConversations);
router.post("/support/conversations", requireAuth, ...supportMultipart, controller.createConversation);
router.get("/support/conversations/:conversationId", requireAuth, controller.getConversation);
router.post("/support/conversations/:conversationId/messages", requireAuth, ...supportMultipart, controller.sendMessage);
router.patch("/support/conversations/:conversationId/read", requireAuth, controller.markRead);
router.post("/support/conversations/:conversationId/resolve", requireAuth, controller.resolveConversation);
router.post("/support/conversations/:conversationId/reopen", requireAuth, controller.reopenConversation);

router.get("/admin/support/conversations", requireAuth, requireAdmin, controller.listAdminConversations);
router.get("/admin/support/conversations/:conversationId", requireAuth, requireAdmin, controller.getAdminConversation);
router.patch("/admin/support/conversations/:conversationId/read", requireAuth, requireAdmin, controller.markAdminRead);
router.patch("/admin/support/conversations/:conversationId/assignment", requireAuth, requireAdmin, controller.assignConversation);
router.post("/admin/support/conversations/:conversationId/messages", requireAuth, requireAdmin, ...supportMultipart, controller.sendAdminMessage);
router.patch("/admin/support/conversations/:conversationId/status", requireAuth, requireAdmin, controller.updateAdminStatus);
router.get("/support/attachments/:attachmentId/content", requireAuth, controller.streamAttachment);

module.exports = router;
