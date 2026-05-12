import type { Costume } from '@/types';
import { calculateVisibleBounds } from '@/utils/imageBounds';
import { processImage } from '@/utils/imageProcessor';
import {
  createBitmapCostumeDocument,
  createStaticCostumeFromDocument,
} from './costumeDocument';

const IMAGE_FILE_EXTENSION_PATTERN = /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i;

export function isImportableImageFile(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_FILE_EXTENSION_PATTERN.test(file.name);
}

export function hasImportableImageDataTransfer(dataTransfer: DataTransfer): boolean {
  if (Array.from(dataTransfer.types).includes('application/x-pocha-costume-ids')) {
    return false;
  }

  const items = Array.from(dataTransfer.items ?? []);
  if (items.length > 0) {
    return items.some((item) => item.kind === 'file' && item.type.startsWith('image/'));
  }

  return Array.from(dataTransfer.files ?? []).some(isImportableImageFile);
}

export async function createBitmapCostumesFromImageFiles(
  files: File[],
  options: {
    onFileError?: (file: File, error: unknown) => void;
  } = {},
): Promise<Costume[]> {
  const importedCostumes: Costume[] = [];

  for (const file of files) {
    if (!isImportableImageFile(file)) {
      continue;
    }

    try {
      const processedDataUrl = await processImage(file);
      const bounds = await calculateVisibleBounds(processedDataUrl);
      const name = file.name.replace(/\.[^/.]+$/, '') || 'Imported image';

      importedCostumes.push(createStaticCostumeFromDocument({
        id: crypto.randomUUID(),
        name,
        assetId: processedDataUrl,
        bounds: bounds || undefined,
        document: createBitmapCostumeDocument(processedDataUrl, name || 'Layer 1'),
      }));
    } catch (error) {
      options.onFileError?.(file, error);
    }
  }

  return importedCostumes;
}
