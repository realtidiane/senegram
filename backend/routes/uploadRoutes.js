const router = require("express").Router();
const auth   = require("../middlewares/auth");
const upload = require("../config/multer");
const ctrl   = require("../controllers/uploadController");

router.get("/storage/health", ctrl.storageHealth);

router.use(auth);

router.use(auth);

// Un fichier quelconque (image, video, audio, document)
router.post("/file", upload.single("file"), ctrl.uploadSingle);

// Note vocale (audio webm/mp3/ogg, max 10 MB et 5 min)
router.post("/voice", upload.single("file"), ctrl.uploadVoice);

// Avatar de profil
router.post(
  "/avatar",
  (req, _res, next) => { req.uploadType = "avatar"; next(); },
  upload.single("file"),
  ctrl.uploadAvatar,
);

module.exports = router;
