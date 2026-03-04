/**
 * Image processing utility for costumes
 * - Resizes images to fit within 950x950 (maintaining aspect ratio)
 * - Converts to WebP format with good compression
 * Note: Canvas is 1024x1024, but we limit imports to 950px to leave room for editing
 */

const MAX_SIZE = 950;
const WEBP_QUALITY = 0.85; // 85% quality - good balance of size and quality

/**
 * Process an image file: resize if needed and convert to WebP
 * @param file - The image file to process
 * @returns Promise resolving to a WebP data URL
 */
export async function processImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      try {
        // Calculate new dimensions (fit within MAX_SIZE x MAX_SIZE)
        let width = img.width;
        let height = img.height;

        if (width > MAX_SIZE || height > MAX_SIZE) {
          const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        // Create canvas and draw resized image
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        // Use high-quality image smoothing for downscaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Draw the image
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to WebP
        const webpDataUrl = canvas.toDataURL('image/webp', WEBP_QUALITY);

        // Check if browser actually supports WebP encoding
        // Some older browsers might fall back to PNG
        if (webpDataUrl.startsWith('data:image/webp')) {
          resolve(webpDataUrl);
        } else {
          // Fallback: browser doesn't support WebP encoding, use PNG
          console.warn('Browser does not support WebP encoding, using PNG');
          resolve(canvas.toDataURL('image/png'));
        }
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };

    // Load the image from file
    const reader = new FileReader();
    reader.onload = () => {
      img.src = reader.result as string;
    };
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Process an image from a data URL: resize if needed and convert to WebP
 * @param dataUrl - The image data URL to process
 * @returns Promise resolving to a WebP data URL
 */
export async function processImageFromDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      try {
        // Calculate new dimensions (fit within MAX_SIZE x MAX_SIZE)
        let width = img.width;
        let height = img.height;

        // If already within size limits, check if we need to re-encode
        const needsResize = width > MAX_SIZE || height > MAX_SIZE;
        const isAlreadyWebP = dataUrl.startsWith('data:image/webp');

        // If no resize needed and already WebP, return as-is
        if (!needsResize && isAlreadyWebP) {
          resolve(dataUrl);
          return;
        }

        if (needsResize) {
          const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        // Create canvas and draw resized image
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Convert to WebP
        const webpDataUrl = canvas.toDataURL('image/webp', WEBP_QUALITY);

        if (webpDataUrl.startsWith('data:image/webp')) {
          resolve(webpDataUrl);
        } else {
          console.warn('Browser does not support WebP encoding, using PNG');
          resolve(canvas.toDataURL('image/png'));
        }
      } catch (error) {
        reject(error);
      }
    };

    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };

    img.src = dataUrl;
  });
}

/**
 * Get image dimensions from a data URL
 */
export async function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}
