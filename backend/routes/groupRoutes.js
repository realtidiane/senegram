const router = require("express").Router();
const ctrl   = require("../controllers/groupController");
const auth   = require("../middlewares/auth");

router.use(auth);

router.post  ("/",                     ctrl.create);
router.patch ("/:id",                  ctrl.update);
router.post  ("/:id/members",          ctrl.addMembers);
router.delete("/:id/members/:userId",  ctrl.removeMember);
router.patch ("/:id/members/:userId",  ctrl.updateMemberRole);
router.post  ("/:id/leave",            ctrl.leave);
router.delete("/:id",                  ctrl.remove);

module.exports = router;
