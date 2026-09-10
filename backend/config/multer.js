/**
 * Configuration Multer.
 * - Mode diskStorage (par defaut): chaque type de fichier va dans ./uploads/<type>/
 * - Mode memoryStorage: le fichier est garde en memoire (file.buffer)
 *   Necessaire pour l'upload S3/Backblaze qui prend file.buffer
 *
 * Le mode est choisi selon la presence des credentials S3 :
 *   - Si S3 configure -> memoryStorage (pour uploadToS3)
 *   - Sinon -> diskStorage (fallback local)
 */
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const BASE_DIR = path.join(__dirname, "..", process.env.UPLOAD_DIR || "uploads");

// Detect si S3 est configure
function isS3Configured() {
  return Boolean(
    process.env.S3_ENDPOINT &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY &&
    process.env.S3_BUCKET
  );
}

// S'assure que les sous-dossiers existent (pour fallback local)
["images", "videos", "audio", "documents", "avatars"].forEach((sub) => {
  const p = path.join(BASE_DIR, sub);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

function pickSubfolder(mimetype) {
  if (mimetype.startsWith("image/")) return "images";
  if (mimetype.startsWith("video/")) return "videos";
  if (mimetype.startsWith("audio/")) return "audio";
  return "documents";
}

// === memoryStorage (pour S3) ===
const memoryStorage = multer.memoryStorage();

// === diskStorage (fallback local) ===
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sub = req.uploadType === "avatar" ? "avatars" : pickSubfolder(file.mimetype);
    cb(null, path.join(BASE_DIR, sub));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    const safe = uuidv4().replace(/-/g, "").slice(0, 12);
    cb(null, `${Date.now()}_${safe}${ext.toLowerCase()}`);
  },
});

const storage = isS3Configured() ? memoryStorage : diskStorage;

const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.MAX_UPLOAD_SIZE) || 50 * 1024 * 1024 },
});

module.exports = upload;
