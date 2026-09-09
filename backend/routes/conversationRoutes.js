const router = require("express").Router();
const ctrl   = require("../controllers/conversationController");
const msgCtrl = require("../controllers/messageController");
const auth   = require("../middlewares/auth");

router.use(auth);

router.get ("/",               ctrl.list);
router.post("/private",        ctrl.openPrivate);
router.get ("/:id",            ctrl.getOne);
router.post("/:id/read",       msgCtrl.markRead);

module.exports = router;
