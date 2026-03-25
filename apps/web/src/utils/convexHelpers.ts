/**
 * Utility functions for working with Convex storage
 */

import { loadImageSource } from '@/lib/assets/imageSourceCache';

/**
 * Convert a data URL to a Blob for upload
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) {
    throw new Error("Invalid data URL");
  }

  const header = dataUrl.slice(0, commaIndex);
  const data = dataUrl.slice(commaIndex + 1);
  const mimeMatch = header.match(/^data:([^;,]+)?/i);
  const mimeType = mimeMatch?.[1] || "application/octet-stream";
  const isBase64 = /;base64/i.test(header);

  if (isBase64) {
    const byteString = atob(data);
    const uint8Array = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) {
      uint8Array[i] = byteString.charCodeAt(i);
    }
    return new Blob([uint8Array], { type: mimeType });
  }

  // Non-base64 data URLs are percent-encoded text payloads (for example SVG).
  return new Blob([decodeURIComponent(data)], { type: mimeType });
}

/**
 * Convert a Blob to a data URL
 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Fetch a URL and convert to data URL
 */
export async function urlToDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();
  return blobToDataUrl(blob);
}

/**
 * Convert a local asset source string into a Blob.
 * Supports data URLs, blob URLs, and regular fetchable URLs.
 */
export async function assetSourceToBlob(source: string): Promise<Blob> {
  if (source.startsWith('data:')) {
    return dataUrlToBlob(source);
  }

  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Failed to read asset source: ${response.statusText}`);
  }
  return await response.blob();
}

/**
 * Upload an asset source to Convex storage.
 * Returns the storage ID, size, and mime type.
 */
export async function uploadDataUrlToStorage(
  dataUrl: string,
  generateUploadUrl: () => Promise<string>
): Promise<{ storageId: string; size: number; mimeType: string }> {
  const blob = await assetSourceToBlob(dataUrl);
  const uploadUrl = await generateUploadUrl();

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": blob.type },
    body: blob,
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.statusText}`);
  }

  const { storageId } = await response.json();
  return {
    storageId,
    size: blob.size,
    mimeType: blob.type,
  };
}

/**
 * Generate a thumbnail from an image data URL
 * Returns a smaller base64 image
 */
export async function generateThumbnail(
  dataUrl: string,
  maxSize: number = 128
): Promise<string> {
  const img = await loadImageSource(dataUrl);
  const canvas = document.createElement("canvas");
  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;

  if (width > height) {
    if (width > maxSize) {
      height = (height * maxSize) / width;
      width = maxSize;
    }
  } else if (height > maxSize) {
    width = (width * maxSize) / height;
    height = maxSize;
  }

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get canvas context");
  }

  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

/**
 * Get mime type from a data URL
 */
export function getMimeTypeFromDataUrl(dataUrl: string): string {
  const match = dataUrl.match(/^data:([^;]+);/);
  return match ? match[1] : "application/octet-stream";
}
