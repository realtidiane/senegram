const router = require("express").Router();
const ctrl   = require("../controllers/messageController");
const auth   = require("../middlewares/auth");
const rateLimit = require("express-rate-limit");

router.use(auth);

const messageLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: { message: "Trop de requêtes, veuillez patienter" },
  standardHeaders: true,
  legacyHeaders: false,
});

router.get   ("/conversation/:id", messageLimiter, ctrl.list);
router.get   ("/conversation/:id/search", messageLimiter, ctrl.search);
router.post  ("/conversation/:id", messageLimiter, ctrl.send);
router.post  ("/conversation/:id/read", messageLimiter, ctrl.markRead);
router.post  ("/:id/pin", messageLimiter, ctrl.pin);
router.delete("/:id/pin", messageLimiter, ctrl.unpin);
router.post  ("/:id/reactions", messageLimiter, ctrl.react);
router.delete("/:id/reactions", messageLimiter, ctrl.removeReaction);
router.patch ("/:id", messageLimiter, ctrl.edit);
router.delete("/:id", messageLimiter, ctrl.remove);

module.exports = router;
