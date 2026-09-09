const router = require("express").Router();
const ctrl   = require("../controllers/userController");
const auth   = require("../middlewares/auth");

router.use(auth);

router.get   ("/search",         ctrl.search);
router.get   ("/contacts",       ctrl.listContacts);
router.post  ("/contacts/:id",   ctrl.addContact);
router.patch ("/contacts/:id",   ctrl.updateContact);
router.delete("/contacts/:id",   ctrl.removeContact);
router.patch ("/me",             ctrl.updateMe);
router.post  ("/me/password",    ctrl.changePassword);
router.get   ("/:id",            ctrl.getById);

module.exports = router;
