const path = require("path");
const fs = require("fs");
const { uploadToS3, checkStorage, s3 } = require("../services/s3");

const AUDIO_MIMES = new Set(["audio/webm", "audio/mpeg", "audio/mp3", "audio/ogg", "audio/opus"]);
const MAX_VOICE_SIZE = 10 * 1024 * 1024;
const MAX_VOICE_DURATION = 5 * 60;

function storageErrorDetails(err) {
  return {
    error: err.name || err.code || "StorageError",
    statusCode: err.statusCode || err.$metadata?.httpStatusCode || null,
    message: err.message,
  };
}

function localFallbackAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.ALLOW_LOCAL_UPLOADS === "true";
}

function subfolderFor(file, uploadType) {
  if (uploadType === "avatar") return "avatars";
  if (file.mimetype.startsWith("image/")) return "images";
  if (file.mimetype.startsWith("video/")) return "videos";
  if (file.mimetype.startsWith("audio/")) return "audio";
  return "documents";
}

function saveLocal(file, uploadType) {
  const sub = subfolderFor(file, uploadType);
  const ext = path.extname(file.originalname) || "";
  const safe = `${Date.now()}_${Math.random().toString(36).slice(2, 14)}${ext.toLowerCase()}`;
  const localPath = path.join(__dirname, "..", "uploads", sub, safe);
  const dir = path.dirname(localPath);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(localPath, file.buffer);

  const relative = path
    .relative(path.join(__dirname, ".."), localPath)
    .replace(/\\/g, "/");
  return { url: `/${relative}`, key: null };
}

async function persistUpload(file, uploadType) {
  try {
    if (s3) {
      const result = await uploadToS3(file, uploadType);
      if (result?.url) return result;
      throw new Error("Upload distant sans URL publique");
    }
  } catch (err) {
    console.error(`[Upload] ${uploadType} remote storage failed:`, err);
    if (!localFallbackAllowed()) {
      const error = new Error("Stockage Backblaze indisponible ou mal configuré");
      error.status = 503;
      error.code = "STORAGE_UNAVAILABLE";
      error.details = storageErrorDetails(err);
      throw error;
    }
  }

  if (!localFallbackAllowed()) {
    const error = new Error("Stockage Backblaze non configuré");
    error.status = 503;
    error.code = "STORAGE_NOT_CONFIGURED";
    throw error;
  }

  console.warn("[Upload] Stockage local utilisé. Ne pas utiliser en production Render.");
  return saveLocal(file, uploadType);
}

/**
 * Returns file metadata after S3 upload (used in POST /api/messages/conversation/:id as "attachment").
 */
exports.uploadSingle = async (req, res, next) => {
  if (!req.file) return res.status(400).json({ message: "Aucun fichier reçu" });

  const uploadType = req.uploadType || "message";
  try {
    const result = await persistUpload(req.file, uploadType);
    res.status(201).json({
      file: {
        url: result.url,
        key: result.key,
        file_name: req.file.originalname,
        file_size: req.file.size,
        mime_type: req.file.mimetype,
      },
    });
  } catch (err) { next(err); }
};

exports.uploadAvatar = async (req, res, next) => {
  if (!req.file) return res.status(400).json({ message: "Aucun fichier reçu" });

  try {
    const result = await persistUpload(req.file, "avatar");
    res.status(201).json({ avatar_url: result.url });
  } catch (err) { next(err); }
};

exports.uploadVoice = async (req, res, next) => {
  if (!req.file) return res.status(400).json({ message: "Aucun fichier audio reçu" });

  const duration = Number(req.body.duration || 0);

  if (!AUDIO_MIMES.has(req.file.mimetype)) {
    return res.status(400).json({ message: "Format audio non supporté" });
  }
  if (req.file.size > MAX_VOICE_SIZE) {
    return res.status(400).json({ message: "Note vocale trop lourde (max 10 MB)" });
  }
  if (!duration || duration > MAX_VOICE_DURATION) {
    return res.status(400).json({ message: "Durée audio invalide ou supérieure à 5 minutes" });
  }

  try {
    const result = await persistUpload(req.file, "voice");
    res.status(201).json({
      file: {
        url: result.url,
        key: result.key,
        file_name: req.file.originalname || "note-vocale.webm",
        file_size: req.file.size,
        mime_type: req.file.mimetype,
        duration: Math.round(duration * 1000),
      },
    });
  } catch (err) { next(err); }
};

exports.storageHealth = async (_req, res, next) => {
  try {
    const status = await checkStorage();
    res.status(status.ok ? 200 : 503).json(status);
  } catch (err) { next(err); }
};
