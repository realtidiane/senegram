const IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const TARGET_SIZE = 1024 * 1024;
const MAX_SIDE = 1920;

export function canCompressImage(file) {
  return file && IMAGE_TYPES.has(file.type);
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
}

export async function compressImage(file) {
  if (!canCompressImage(file)) return { file, stats: null };

  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);
  URL.revokeObjectURL(img.src);

  const type = file.type === "image/png" ? "image/webp" : file.type;
  let quality = 0.85;
  let blob = await canvasToBlob(canvas, type, quality);

  while (blob && blob.size > TARGET_SIZE && quality > 0.75) {
    quality -= 0.04;
    blob = await canvasToBlob(canvas, type, quality);
  }

  if (!blob || blob.size >= file.size) return { file, stats: null };

  const ext = type === "image/webp" ? "webp" : file.name.split(".").pop();
  const name = file.name.replace(/\.[^.]+$/, `.${ext}`);
  const compressed = new File([blob], name, { type, lastModified: Date.now() });

  return {
    file: compressed,
    stats: {
      originalSize: file.size,
      compressedSize: compressed.size,
      reduction: Math.round((1 - compressed.size / file.size) * 100),
    },
  };
}

export function formatBytes(bytes = 0) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
