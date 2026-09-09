const express = require("express");
const router = express.Router();
const auth = require("../middlewares/auth");
const pushController = require("../controllers/pushController");

router.get("/public-key", pushController.publicKey);

/**
 * POST /api/push/subscribe
 * Save push subscription for current user
 */
router.post("/subscribe", auth, pushController.subscribe);

/**
 * POST /api/push/unsubscribe
 * Remove push subscription for current user
 */
router.post("/unsubscribe", auth, pushController.unsubscribe);

/**
 * POST /api/push/test (admin only)
 * Send test push notification to current user
 */
router.post("/test", auth, pushController.testPush);

module.exports = router;
