/**
 * S3-compatible storage service (Backblaze B2, Cloudflare R2, AWS S3, etc.).
 * Configure via S3_* variables. BACKBLAZE_/B2_* aliases are supported too.
 */
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const path = require("path");

function env(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return "";
}

function stripTrailingSlash(value) {
  return value ? value.replace(/\/+$/, "") : "";
}

function isBackblazeEndpoint(endpoint) {
  return /backblazeb2\.com/i.test(endpoint || "");
}

// S3 client configuration
function createS3Client() {
  const endpoint = env("S3_ENDPOINT", "B2_ENDPOINT", "BACKBLAZE_ENDPOINT");
  const region = env("S3_REGION", "B2_REGION", "BACKBLAZE_REGION") || "auto";
  const accessKeyId = env("S3_ACCESS_KEY_ID", "B2_KEY_ID", "BACKBLAZE_KEY_ID");
  const secretAccessKey = env("S3_SECRET_ACCESS_KEY", "B2_APPLICATION_KEY", "BACKBLAZE_APPLICATION_KEY");
  const bucket = env("S3_BUCKET", "B2_BUCKET", "BACKBLAZE_BUCKET");

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    console.warn("⚠️ Stockage S3/Backblaze incomplet");
    return null;
  }

  return {
    client: new S3Client({
      region,
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
    bucket,
    endpoint: stripTrailingSlash(endpoint),
    region,
    publicUrl: stripTrailingSlash(env("S3_PUBLIC_URL", "B2_PUBLIC_URL", "BACKBLAZE_PUBLIC_URL")),
    accessKeyId,
    secretAccessKey,
    isBackblaze: isBackblazeEndpoint(endpoint),
  };
}

const s3 = createS3Client();

function pickFolder(mimetype, uploadType) {
  if (uploadType === "avatar") return "avatars";
  if (mimetype.startsWith("image/")) return "images";
  if (mimetype.startsWith("video/")) return "videos";
  if (mimetype.startsWith("audio/")) return "audio";
  return "documents";
}

function getPublicUrl(key) {
  if (!s3) return null;
  if (s3.publicUrl) return `${s3.publicUrl}/${key}`;
  if (s3.endpoint && s3.bucket) return `${s3.endpoint}/${s3.bucket}/${key}`;
  return null;
}

async function parseBackblazeResponse(response, fallbackMessage) {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const message = typeof body === "object" && body?.message
      ? body.message
      : fallbackMessage;
    const err = new Error(message);
    err.statusCode = response.status;
    err.body = body;
    throw err;
  }

  return body;
}

async function authorizeBackblaze() {
  const credentials = Buffer
    .from(`${s3.accessKeyId}:${s3.secretAccessKey}`)
    .toString("base64");

  const response = await fetch("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", {
    headers: { Authorization: `Basic ${credentials}` },
  });

  return parseBackblazeResponse(response, "Autorisation Backblaze impossible");
}

async function findBackblazeBucket(auth) {
  const response = await fetch(`${auth.apiUrl}/b2api/v2/b2_list_buckets`, {
    method: "POST",
    headers: {
      Authorization: auth.authorizationToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accountId: auth.accountId,
      bucketName: s3.bucket,
    }),
  });
  const data = await parseBackblazeResponse(response, "Bucket Backblaze introuvable");
  const bucket = data.buckets?.find((item) => item.bucketName === s3.bucket);
  if (!bucket) {
    const err = new Error(`Bucket Backblaze introuvable: ${s3.bucket}`);
    err.statusCode = 404;
    throw err;
  }
  return bucket;
}

async function getBackblazeUploadUrl(auth, bucketId) {
  const response = await fetch(`${auth.apiUrl}/b2api/v2/b2_get_upload_url`, {
    method: "POST",
    headers: {
      Authorization: auth.authorizationToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ bucketId }),
  });
  return parseBackblazeResponse(response, "URL upload Backblaze impossible");
}

async function uploadToBackblazeNative(file, key) {
  const auth = await authorizeBackblaze();
  const bucket = await findBackblazeBucket(auth);
  const upload = await getBackblazeUploadUrl(auth, bucket.bucketId);
  const sha1 = crypto.createHash("sha1").update(file.buffer).digest("hex");
  const encodedName = key.split("/").map(encodeURIComponent).join("/");

  const response = await fetch(upload.uploadUrl, {
    method: "POST",
    headers: {
      Authorization: upload.authorizationToken,
      "X-Bz-File-Name": encodedName,
      "Content-Type": file.mimetype,
      "Content-Length": String(file.size),
      "X-Bz-Content-Sha1": sha1,
    },
    body: file.buffer,
  });
  await parseBackblazeResponse(response, "Upload natif Backblaze impossible");

  const url = getPublicUrl(key);
  if (!url) {
    throw new Error("URL publique Backblaze introuvable. Configure S3_PUBLIC_URL ou B2_PUBLIC_URL.");
  }
  return { key, url, bucket: s3.bucket };
}

async function uploadToS3(file, uploadType = "message") {
  if (!s3) return null; // fallback to local

  const folder = pickFolder(file.mimetype, uploadType);
  const ext = path.extname(file.originalname) || "";
  const safeName = `${Date.now()}_${uuidv4().replace(/-/g, "").slice(0, 12)}${ext.toLowerCase()}`;
  const key = `${folder}/${safeName}`;

  try {
    await s3.client.send(new PutObjectCommand({
      Bucket: s3.bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ContentLength: file.size,
      CacheControl: "public, max-age=31536000", // 1 year
    }));

    const url = getPublicUrl(key);
    if (!url) {
      throw new Error("URL publique du stockage introuvable. Configure S3_PUBLIC_URL ou B2_PUBLIC_URL.");
    }
    return { key, url, bucket: s3.bucket };
  } catch (err) {
    console.error("[S3] Upload error:", err);
    if (s3.isBackblaze) {
      console.warn("[S3] Tentative fallback API native Backblaze B2");
      return uploadToBackblazeNative(file, key);
    }
    throw err;
  }
}

async function deleteFromS3(key) {
  if (!s3) return false;
  try {
    await s3.client.send(new DeleteObjectCommand({
      Bucket: s3.bucket,
      Key: key,
    }));
    return true;
  } catch (err) {
    console.error("[S3] Delete error:", err);
    return false;
  }
}

async function getPresignedUrl(key, expiresIn = 3600) {
  if (!s3) return null;
  try {
    const command = new GetObjectCommand({ Bucket: s3.bucket, Key: key });
    return await getSignedUrl(s3.client, command, { expiresIn });
  } catch (err) {
    console.error("[S3] Presigned URL error:", err);
    return null;
  }
}

async function checkStorage() {
  if (!s3) {
    return {
      ok: false,
      configured: false,
      message: "Stockage S3/Backblaze non configuré",
    };
  }

  try {
    await s3.client.send(new HeadBucketCommand({ Bucket: s3.bucket }));
    return {
      ok: true,
      configured: true,
      bucket: s3.bucket,
      endpoint: s3.endpoint,
      region: s3.region,
      publicUrl: s3.publicUrl || getPublicUrl("test"),
      driver: "s3",
    };
  } catch (err) {
    if (s3.isBackblaze) {
      try {
        const auth = await authorizeBackblaze();
        const bucket = await findBackblazeBucket(auth);
        return {
          ok: true,
          configured: true,
          bucket: bucket.bucketName,
          endpoint: s3.endpoint,
          region: s3.region,
          publicUrl: s3.publicUrl || getPublicUrl("test"),
          driver: "backblaze-native",
          s3HeadBucket: {
            ok: false,
            error: err.name || err.code || "StorageError",
            statusCode: err.$metadata?.httpStatusCode || null,
          },
        };
      } catch (nativeErr) {
        return {
          ok: false,
          configured: true,
          bucket: s3.bucket,
          endpoint: s3.endpoint,
          region: s3.region,
          publicUrl: s3.publicUrl || null,
          driver: "backblaze-native",
          error: nativeErr.name || nativeErr.code || "StorageError",
          statusCode: nativeErr.statusCode || null,
          message: nativeErr.message,
        };
      }
    }
    return {
      ok: false,
      configured: true,
      bucket: s3.bucket,
      endpoint: s3.endpoint,
      region: s3.region,
      publicUrl: s3.publicUrl || null,
      error: err.name || err.code || "StorageError",
      statusCode: err.$metadata?.httpStatusCode || null,
      message: err.message,
    };
  }
}

module.exports = { uploadToS3, deleteFromS3, getPresignedUrl, getPublicUrl, checkStorage, s3 };
