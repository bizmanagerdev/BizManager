/**
 * Client-side image downscaling so uploads stay fast on mobile connections.
 * Phone photos (5-12MB) shrink to a few hundred KB without hurting the
 * readability of delivery proofs, receipts, or check photos.
 */

const MAX_DIMENSION = 2000;
const JPEG_QUALITY = 0.82;
const SKIP_BELOW_BYTES = 400 * 1024;

function canCompress(file: File) {
  if (!file.type.startsWith("image/")) return false;
  // GIFs (animation) and SVGs (vector) must stay as-is.
  if (file.type === "image/gif" || file.type === "image/svg+xml") return false;
  return file.size > SKIP_BELOW_BYTES;
}

export async function compressImageFile(file: File): Promise<File> {
  if (typeof window === "undefined" || !canCompress(file)) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;

    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );
    if (!blob || blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    // e.g. HEIC on browsers that can't decode it — upload the original instead.
    return file;
  }
}

export async function compressImageFiles(files: File[]): Promise<File[]> {
  return Promise.all(files.map((file) => compressImageFile(file)));
}
